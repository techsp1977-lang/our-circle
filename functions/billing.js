// Plans and payments (Stripe), storage use, and the owner's Admin numbers.
//
//   Family       $49/yr   50 GB of photos and videos
//   Family Plus  $99/yr  200 GB
//   New circles get a 30-day trial. The owner can give any circle a free plan (gift).
//
// circles/{cid}.billing  { plan: 'family'|'plus'|'gift', status, until (ms, null = no end), customer, sub, by }
// circles/{cid}.usage    { bytes }   kept up to date by the storage triggers below
// payments/{invoice}     { cid, plan, amount (cents), currency, paidAt, refunded }   server-only
// _server/billing        { enforce: true|false }   nothing is limited until the owner turns this on
// circles/{cid}.paused   'plan' | 'storage' | absent. Set only here. The storage rules read just this one field
//                        (they can afford only a couple of lookups per upload), so new photo and video uploads
//                        pause when a plan ends or storage is full. Everything else keeps working.
//
// The same pattern as Yardage Book's api.py: Stripe's REST API with no SDK, Stripe Checkout for paying,
// Stripe's billing portal for changing cards or cancelling, and a signed webhook that updates the plan.
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onObjectFinalized, onObjectDeleted } from 'firebase-functions/v2/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHmac, timingSafeEqual } from 'node:crypto';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const APP = EMULATOR ? 'http://localhost:5055' : 'https://our-circle-3da6a.web.app';
const BUCKET = EMULATOR ? 'demo-oc.appspot.com' : 'our-circle-3da6a.firebasestorage.app';
const SA = EMULATOR ? undefined : 'billing-fn@our-circle-3da6a.iam.gserviceaccount.com';
const DAY = 864e5, GB = 1024 ** 3;
export const TRIAL_DAYS = 30;
export const PLANS = {
  family: { name: 'Family', price: 4900, limit: 50 * GB },
  plus: { name: 'Family Plus', price: 9900, limit: 200 * GB },
  gift: { name: 'Gift', price: 0, limit: 200 * GB },
};

const STRIPE_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK = defineSecret('STRIPE_WEBHOOK_SECRET');
const PRICE_FAMILY = defineString('STRIPE_PRICE_FAMILY', { description: 'Stripe price ID for Family ($49/yr), starts with price_' });
const PRICE_PLUS = defineString('STRIPE_PRICE_PLUS', { description: 'Stripe price ID for Family Plus ($99/yr), starts with price_' });
const OWNERS = defineString('OWNER_EMAILS', { description: 'Email(s) that can open Admin, comma-separated' });
const STRIPE_API = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1'; // a stand-in is used only in tests

const fail = (code, msg) => { throw new HttpsError(code, msg); };
const db = () => getFirestore();

// ───────── Stripe (no SDK) ─────────
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(path, params, method = 'POST') {
  const key = STRIPE_KEY.value();
  if (!key) fail('failed-precondition', 'Payments are not set up yet.');
  const res = await fetch(STRIPE_API + path, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? form(params || {}) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.warn('stripe error', res.status, j?.error?.message); fail('unavailable', "The payment service didn't answer. Try again."); }
  return j;
}
const planForPrice = (pid) => (pid && pid === PRICE_PLUS.value() ? 'plus' : pid && pid === PRICE_FAMILY.value() ? 'family' : null);

// ───────── who may do what ─────────
async function circleAdmin(req, cid) {
  const uid = req.auth?.uid || fail('unauthenticated', 'Sign in first.');
  if (typeof cid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cid)) fail('invalid-argument', 'Missing circle.');
  const a = (await db().doc(`circles/${cid}/access/${uid}`).get()).data();
  if (a?.role !== 'admin') fail('permission-denied', 'Only family organizers can change the plan.');
  return uid;
}
const isOwner = (req) => {
  const email = String(req.auth?.token?.email || '').toLowerCase();
  const list = OWNERS.value().toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!(req.auth?.token?.email_verified && email && list.includes(email));
};

// ───────── what the app calls ─────────
export const billing = onCall({ region: 'us-central1', cors: EMULATOR ? true : [APP], maxInstances: 3, memory: '256MiB', serviceAccount: SA, secrets: [STRIPE_KEY] }, async (req) => {
  const d = req.data || {};
  switch (d.action) {
    case 'checkout': {
      const uid = await circleAdmin(req, d.cid);
      if (!['family', 'plus'].includes(d.plan)) fail('invalid-argument', 'Pick Family or Family Plus.');
      const price = d.plan === 'plus' ? PRICE_PLUS.value() : PRICE_FAMILY.value();
      if (!price) fail('failed-precondition', 'Payments are not set up yet.');
      const c = (await db().doc(`circles/${d.cid}`).get()).data() || {};
      const meta = { cid: d.cid, uid, plan: d.plan };
      const p = {
        mode: 'subscription', client_reference_id: d.cid, allow_promotion_codes: 'true',
        line_items: { 0: { price, quantity: 1 } }, metadata: meta, subscription_data: { metadata: meta },
        success_url: `${APP}/?paid=1#/manage`, cancel_url: `${APP}/?paid=0#/manage`,
        ...(c.billing?.customer ? { customer: c.billing.customer } : req.auth.token.email ? { customer_email: req.auth.token.email } : {}),
      };
      // Buyers tick "I agree to the Terms" when Stripe has a Terms link on file; without one Stripe refuses it, so try once more.
      let s;
      try { s = await stripe('/checkout/sessions', { ...p, consent_collection: { terms_of_service: 'required' } }); }
      catch (e) { s = await stripe('/checkout/sessions', p); }
      return { url: s.url };
    }
    case 'portal': {
      await circleAdmin(req, d.cid);
      const c = (await db().doc(`circles/${d.cid}`).get()).data() || {};
      if (!c.billing?.customer) fail('not-found', "There's no card on file for this family yet.");
      const s = await stripe('/billing_portal/sessions', { customer: c.billing.customer, return_url: `${APP}/#/manage` });
      return { url: s.url };
    }
    default: fail('invalid-argument', 'Unknown action.');
  }
});

// ───────── Stripe tells us about payments ─────────
function verified(raw, header, secret) {
  const parts = String(header || '').split(',').map((x) => x.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!secret || !t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const good = Buffer.from(createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex'));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === good.length && timingSafeEqual(b, good); });
}

async function applySubscription(sub, cidHint) {
  const md = sub.metadata || {};
  const cid = md.cid || cidHint;
  if (!cid) return;
  const item = sub.items?.data?.[0] || {};
  const plan = planForPrice(item.price?.id) || (PLANS[md.plan] ? md.plan : 'family');
  const end = (sub.current_period_end || item.current_period_end || 0) * 1000;
  const alive = ['active', 'trialing', 'past_due'].includes(sub.status);
  await db().doc(`circles/${cid}`).set({ billing: {
    plan, status: sub.status, until: alive ? (end || Date.now() + 365 * DAY) + 3 * DAY : Date.now() - 1,
    customer: sub.customer || null, sub: sub.id, by: md.uid || null, at: Date.now(),
  } }, { merge: true });
  await recompute(cid);
}

export const stripeWebhook = onRequest({ region: 'us-central1', maxInstances: 3, memory: '256MiB', serviceAccount: SA, secrets: [STRIPE_KEY, STRIPE_WEBHOOK] }, async (req, res) => {
  if (req.method !== 'POST' || !verified(req.rawBody, req.get('stripe-signature'), STRIPE_WEBHOOK.value())) { res.status(400).send('bad signature'); return; }
  const ev = JSON.parse(req.rawBody.toString());
  const o = ev.data?.object || {};
  try {
    if (ev.type === 'checkout.session.completed' && o.subscription) {
      await applySubscription(await stripe(`/subscriptions/${o.subscription}`, null, 'GET'), o.client_reference_id);
    } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(ev.type)) {
      await applySubscription(o);
    } else if (ev.type === 'invoice.paid') {
      const sid = o.subscription || o.parent?.subscription_details?.subscription;
      const sub = sid ? await stripe(`/subscriptions/${sid}`, null, 'GET') : null;
      if (sub) await applySubscription(sub);
      const md = sub?.metadata || o.subscription_details?.metadata || {};
      await db().doc(`payments/${o.id}`).set({
        cid: md.cid || null, plan: planForPrice(o.lines?.data?.[0]?.price?.id || sub?.items?.data?.[0]?.price?.id) || md.plan || null,
        amount: o.amount_paid || 0, currency: o.currency || 'usd', paidAt: (o.status_transitions?.paid_at || o.created || Date.now() / 1000) * 1000,
        customer: o.customer || null, refunded: 0,
      }, { merge: true });
    } else if (ev.type === 'charge.refunded' && o.invoice) {
      await db().doc(`payments/${o.invoice}`).set({ refunded: o.amount_refunded || 0 }, { merge: true });
    }
    res.json({ ok: true });
  } catch (e) { console.error('webhook failed', ev.type, e.message); res.status(500).send('try again'); }
});

// ───────── storage use per circle ─────────
const circleOf = (name) => (String(name).match(/^circles\/([A-Za-z0-9_-]{1,64})\//) || [])[1];
export const usageAdd = onObjectFinalized({ region: 'us-central1', bucket: BUCKET, serviceAccount: SA, maxInstances: 5 }, async (e) => {
  const cid = circleOf(e.data.name);
  if (!cid) return;
  await db().doc(`circles/${cid}`).set({ usage: { bytes: FieldValue.increment(Number(e.data.size) || 0) } }, { merge: true });
  await recompute(cid);
});
export const usageRemove = onObjectDeleted({ region: 'us-central1', bucket: BUCKET, serviceAccount: SA, maxInstances: 5 }, async (e) => {
  const cid = circleOf(e.data.name);
  if (!cid) return;
  await db().doc(`circles/${cid}`).set({ usage: { bytes: FieldValue.increment(-(Number(e.data.size) || 0)) } }, { merge: true });
  await recompute(cid);
});

// ───────── Admin (the owner only) ─────────
export function planState(c, now = Date.now()) {
  const b = c.billing || {};
  if (b.plan && (b.until == null || b.until > now)) return { plan: b.plan, active: true, limit: PLANS[b.plan]?.limit ?? PLANS.family.limit, until: b.until ?? null };
  const trialEnd = (c.createdAt || now) + TRIAL_DAYS * DAY;
  if (!b.plan && trialEnd > now) return { plan: 'trial', active: true, limit: PLANS.family.limit, until: trialEnd };
  return { plan: b.plan ? 'lapsed' : 'trial-over', active: false, limit: PLANS[b.plan]?.limit ?? PLANS.family.limit, until: b.until ?? trialEnd };
}

async function enforcing() { return !!(await db().doc('_server/billing').get()).data()?.enforce; }
// Work out whether this circle's uploads should pause, and store it if it changed.
export async function recompute(cid, enforce) {
  const ref = db().doc(`circles/${cid}`);
  const s = await ref.get();
  if (!s.exists) return null;
  const c = s.data(); const st = planState(c);
  const on = enforce ?? (await enforcing());
  const paused = !on ? null : !st.active ? 'plan' : (c.usage?.bytes || 0) >= st.limit ? 'storage' : null;
  if ((c.paused || null) !== paused) await ref.set({ paused: paused || FieldValue.delete() }, { merge: true });
  return paused;
}
// Once a day: trials and plans that ended since yesterday.
export const billingDaily = onSchedule({ schedule: 'every day 03:17', timeZone: 'America/Denver', region: 'us-central1', serviceAccount: SA }, async () => {
  const on = await enforcing();
  const all = await db().collection('circles').get();
  for (const s of all.docs) await recompute(s.id, on);
});

export const admin = onCall({ region: 'us-central1', cors: EMULATOR ? true : [APP], maxInstances: 2, memory: '512MiB', serviceAccount: SA }, async (req) => {
  if (!isOwner(req)) fail('permission-denied', 'Only the app owner can see this.');
  const d = req.data || {};
  if (d.action === 'gift' || d.action === 'ungift') {
    if (typeof d.cid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(d.cid)) fail('invalid-argument', 'Missing circle.');
    const ref = db().doc(`circles/${d.cid}`);
    if (!(await ref.get()).exists) fail('not-found', 'No circle with that ID.');
    await ref.set({ billing: d.action === 'gift' ? { plan: 'gift', status: 'gift', until: null, at: Date.now() } : FieldValue.delete() }, { merge: true });
    await recompute(d.cid);
    return { ok: true };
  }
  if (d.action === 'recount') {
    // Add up every stored file per circle (storage use is counted as files come and go; this catches up the past).
    const [files] = await getStorage().bucket(BUCKET).getFiles({ prefix: 'circles/' });
    const sums = {};
    for (const f of files) { const cid = circleOf(f.name); if (cid) sums[cid] = (sums[cid] || 0) + Number(f.metadata?.size || 0); }
    const all = await db().collection('circles').get();
    for (const s of all.docs) { await s.ref.set({ usage: { bytes: sums[s.id] || 0, countedAt: Date.now() } }, { merge: true }); await recompute(s.id); }
    return { circles: all.size, files: files.length };
  }
  if (d.action === 'enforce') {
    await db().doc('_server/billing').set({ enforce: !!d.on, at: Date.now() }, { merge: true });
    await db().doc('config/billing').set({ on: !!d.on }, { merge: true });
    const all = await db().collection('circles').get();
    for (const s of all.docs) await recompute(s.id, !!d.on);
    return { enforce: !!d.on };
  }
  const now = Date.now();
  const year = new Date(new Date().getFullYear(), 0, 1).getTime();
  const [circles, pays, cfg] = await Promise.all([db().collection('circles').get(), db().collection('payments').get(), db().doc('_server/billing').get()]);
  const counts = { total: 0, family: 0, plus: 0, gift: 0, trial: 0, lapsed: 0 };
  const rows = [];
  const names = {};
  circles.forEach((s) => {
    const c = s.data(); const st = planState(c, now);
    names[s.id] = c.name || s.id;
    counts.total++;
    const k = st.plan === 'trial-over' ? 'lapsed' : st.plan;
    counts[k] = (counts[k] || 0) + 1;
    rows.push({ cid: s.id, name: c.name || '', plan: st.plan, until: st.until, bytes: c.usage?.bytes || 0, limit: st.limit, createdAt: c.createdAt || 0 });
  });
  const payments = pays.docs.map((p) => ({ id: p.id, ...p.data() }));
  const net = (p) => (p.amount || 0) - (p.refunded || 0);
  const ytd = payments.filter((p) => p.paidAt >= year).reduce((a, p) => a + net(p), 0);
  const last30 = payments.filter((p) => p.paidAt >= now - 30 * DAY).reduce((a, p) => a + net(p), 0);
  const paidCirclesYtd = new Set(payments.filter((p) => p.paidAt >= year && net(p) > 0).map((p) => p.cid)).size;
  rows.sort((a, b) => b.bytes - a.bytes);
  return {
    at: now, enforce: !!cfg.data()?.enforce, counts, ytdCents: ytd, last30Cents: last30, paidCirclesYtd,
    arrCents: counts.family * PLANS.family.price + counts.plus * PLANS.plus.price,
    storageBytes: rows.reduce((a, r) => a + r.bytes, 0),
    circles: rows,
    payments: payments.sort((a, b) => b.paidAt - a.paidAt).slice(0, 50).map((p) => ({ ...p, circle: names[p.cid] || p.cid })),
  };
});
