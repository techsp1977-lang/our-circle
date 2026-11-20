// Phone notifications for new chat messages (standard Web Push: iPhone home-screen app, Android, computers).
//
// After sending a message, the sender's app calls notify({ action: 'send', cid, chatId, msgId }).
// This checks the caller really wrote that message, in that family, within the last few minutes, and that it
// hasn't been announced already, then notifies everyone else in that chat on each phone where they turned
// notifications on (users/{uid}.pushSubs, which only they and this function can read).
//
// The VAPID key pair (which proves to Apple/Google/Mozilla that pushes come from Our Circle) is made the
// first time it's needed and kept in _server/vapid, which the security rules close to every app user.
// Runs as its own service account, "notify-fn", whose only role is Cloud Datastore User.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import webpush from 'web-push';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ORIGIN = EMULATOR ? 'http://localhost:5055' : 'https://our-circle-3da6a.web.app';
const FRESH_MS = 5 * 60 * 1000;
// Who the pushes come from, as push services see it (must be an https: address).
const SUBJECT = 'https://our-circle-3da6a.web.app';

const fail = (code, msg) => { throw new HttpsError(code, msg); };
const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,1500}$/.test(v);

let vapid = null;
async function vapidKeys(db) {
  if (vapid) return vapid;
  const ref = db.doc('_server/vapid');
  vapid = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists) return s.data();
    const k = webpush.generateVAPIDKeys();
    const v = { publicKey: k.publicKey, privateKey: k.privateKey, createdAt: Date.now() };
    t.set(ref, v);
    return v;
  });
  return vapid;
}

function preview(msg) {
  const text = (msg.text || '').trim();
  if (text) return text.length > 140 ? text.slice(0, 137) + '…' : text;
  const m = msg.media || [];
  if (!m.length) return 'New message';
  if (String(m[0].type || '').startsWith('video')) return 'Sent a video';
  return m.length > 1 ? `Sent ${m.length} photos` : 'Sent a photo';
}

export const notify = onCall({
  region: 'us-central1',
  cors: EMULATOR ? true : [ORIGIN],
  maxInstances: 5,
  memory: '256MiB',
  timeoutSeconds: 60,
  serviceAccount: EMULATOR ? undefined : 'notify-fn@our-circle-3da6a.iam.gserviceaccount.com',
}, async (req) => {
  const db = getFirestore();
  const uid = req.auth?.uid || fail('unauthenticated', 'Sign in first.');
  const data = req.data || {};

  if (data.action === 'publicKey') return { publicKey: (await vapidKeys(db)).publicKey };
  if (data.action !== 'send') fail('invalid-argument', 'Unknown action.');

  const { cid, chatId, msgId } = data;
  if (![cid, chatId, msgId].every(okId)) fail('invalid-argument', 'Missing message.');
  const circle = db.doc(`circles/${cid}`);
  const access = (await circle.collection('access').doc(uid).get()).data();
  if (!access) fail('permission-denied', 'Not in this family.');
  const me = access.memberId;

  // Announce each message once, only by its author, only while it's new.
  const msgRef = circle.collection('chats').doc(chatId).collection('messages').doc(msgId);
  const msg = await db.runTransaction(async (t) => {
    const s = await t.get(msgRef);
    if (!s.exists) return null;
    const m = s.data();
    if (m.by !== me || m.notified || Date.now() - (m.at || 0) > FRESH_MS) return null;
    t.update(msgRef, { notified: true });
    return m;
  });
  if (!msg) return { sent: 0 };

  const chat = (await circle.collection('chats').doc(chatId).get()).data();
  if (!chat) return { sent: 0 };
  const members = Object.fromEntries((await circle.collection('members').get()).docs.map((d) => [d.id, d.data()]));
  const to = (chat.kind === 'everyone' ? Object.keys(members) : chat.memberIds || []).filter((id) => id !== me && members[id]?.uid);
  if (!to.length) return { sent: 0 };

  const sender = members[me]?.name || 'Someone';
  const where = chat.kind === 'everyone' ? 'Everyone' : chat.kind === 'direct' ? '' : (chat.name || '');
  const payload = JSON.stringify({
    title: where ? `${sender} · ${where}` : sender,
    body: preview(msg),
    tag: `chat-${chatId}`,
    url: `#/chat/${encodeURIComponent(chatId)}`,
  });

  const keys = await vapidKeys(db);
  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
  let sent = 0;
  await Promise.all(to.map(async (mid) => {
    const userRef = db.doc(`users/${members[mid].uid}`);
    const subs = (await userRef.get()).data()?.pushSubs || {};
    await Promise.all(Object.entries(subs).map(async ([subId, sub]) => {
      if (!sub?.endpoint || !sub?.keys) return;
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 24 * 3600, urgency: 'high', topic: `c${chatId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
        sent++;
      } catch (e) {
        // The phone turned notifications off, or the app was deleted: forget that phone.
        if (e.statusCode === 404 || e.statusCode === 410) await userRef.update({ [`pushSubs.${subId}`]: FieldValue.delete() }).catch(() => {});
        else console.warn('push failed', e.statusCode || e.message);
      }
    }));
  }));
  return { sent };
});
