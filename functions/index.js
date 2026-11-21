// Face ID sign-in (passkeys) for Our Circle.
//
// One callable function, "passkey", with four steps:
//   registerOptions / registerVerify  (signed in)  save a passkey for your account on this phone
//   signInOptions   / signInVerify    (signed out) prove you hold a saved passkey; returns a one-time sign-in token
// plus "remove" (signed in) to delete one of your passkeys.
//
// Passkeys and challenges live in Firestore collections that the security rules close to every app user;
// only this function reads or writes them. It runs as its own service account, "passkey-fn", with just two
// roles: Cloud Datastore User (these collections) and Service Account Token Creator on itself (to sign the
// one-time sign-in token). See SETUP.md, "Face ID sign-in".
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { randomBytes } from 'node:crypto';

initializeApp();
const db = getFirestore();

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const RP_ID = EMULATOR ? 'localhost' : 'our-circle-3da6a.web.app';
const ORIGIN = EMULATOR ? 'http://localhost:5055' : 'https://our-circle-3da6a.web.app';
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;

const passkeys = db.collection('passkeys');
const challenges = db.collection('passkeyChallenges');

const fail = (code, msg) => { throw new HttpsError(code, msg); };
const ticketId = () => randomBytes(18).toString('base64url');
const str = (v, max = 4096) => (typeof v === 'string' && v.length <= max ? v : null);

async function saveChallenge(kind, challenge, uid = null) {
  const id = ticketId();
  await challenges.doc(id).set({ kind, challenge, uid, expiresAt: Date.now() + CHALLENGE_MS });
  // Tidy a few expired ones each time so unused challenges don't pile up.
  challenges.where('expiresAt', '<', Date.now()).limit(20).get()
    .then((s) => Promise.all(s.docs.map((d) => d.ref.delete()))).catch(() => {});
  return id;
}

// Each challenge works once, for one purpose, for five minutes.
async function takeChallenge(ticket, kind, uid = null) {
  if (!str(ticket, 64)) fail('invalid-argument', 'Missing ticket.');
  const ref = challenges.doc(ticket);
  const c = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) return null;
    t.delete(ref);
    return s.data();
  });
  if (!c || c.kind !== kind || c.expiresAt < Date.now() || (uid && c.uid !== uid)) {
    fail('failed-precondition', 'That Face ID request expired. Try again.');
  }
  return c.challenge;
}

const needUser = (req) => req.auth?.uid || fail('unauthenticated', 'Sign in first.');

export const passkey = onCall({
  region: 'us-central1',
  cors: EMULATOR ? true : [ORIGIN],
  maxInstances: 3,
  memory: '256MiB',
  timeoutSeconds: 30,
  serviceAccount: EMULATOR ? undefined : 'passkey-fn@our-circle-3da6a.iam.gserviceaccount.com',
}, async (req) => {
  const data = req.data || {};
  switch (data.action) {
    case 'registerOptions': {
      const uid = needUser(req);
      const mine = await passkeys.where('uid', '==', uid).get();
      if (mine.size >= MAX_PASSKEYS) fail('resource-exhausted', 'Too many Face ID devices saved. Remove one first.');
      // Name shown in the phone's passwords list; from the sign-in token, so no access to the user list is needed.
      const email = req.auth.token?.email || '';
      const options = await generateRegistrationOptions({
        rpName: 'Our Circle',
        rpID: RP_ID,
        userName: email || 'Our Circle',
        userDisplayName: email ? `Our Circle · ${email}` : 'Our Circle',
        userID: new TextEncoder().encode(uid),
        attestationType: 'none',
        excludeCredentials: mine.docs.map((d) => ({ id: d.id, transports: d.data().transports || [] })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        preferredAuthenticatorType: 'localDevice',
      });
      return { options, ticket: await saveChallenge('register', options.challenge, uid) };
    }

    case 'registerVerify': {
      const uid = needUser(req);
      const expected = await takeChallenge(data.ticket, 'register', uid);
      let v;
      try {
        v = await verifyRegistrationResponse({
          response: data.response, expectedChallenge: expected,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
        });
      } catch (e) { fail('invalid-argument', 'Face ID setup could not be checked: ' + e.message); }
      if (!v.verified) fail('permission-denied', 'Face ID setup was not accepted.');
      const { credential } = v.registrationInfo;
      await passkeys.doc(credential.id).set({
        uid,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || [],
        label: str(data.label, 120) || '',
        createdAt: FieldValue.serverTimestamp(),
        lastUsedAt: null,
      });
      return { credentialId: credential.id };
    }

    case 'signInOptions': {
      const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: [] });
      return { options, ticket: await saveChallenge('signin', options.challenge) };
    }

    case 'signInVerify': {
      const expected = await takeChallenge(data.ticket, 'signin');
      const id = str(data.response?.id, 1024) || fail('invalid-argument', 'Missing passkey.');
      const snap = await passkeys.doc(id).get();
      if (!snap.exists) fail('not-found', 'This Face ID isn\'t set up for Our Circle. Sign in with your password, then turn on Face ID sign-in on My page.');
      const pk = snap.data();
      let v;
      try {
        v = await verifyAuthenticationResponse({
          response: data.response, expectedChallenge: expected,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
          credential: { id, publicKey: isoBase64URL.toBuffer(pk.publicKey), counter: pk.counter || 0, transports: pk.transports || [] },
        });
      } catch (e) { fail('permission-denied', 'Face ID sign-in was not accepted.'); }
      if (!v.verified) fail('permission-denied', 'Face ID sign-in was not accepted.');
      // The passkey must belong to the account it was saved for.
      const handle = data.response?.response?.userHandle;
      if (handle && new TextDecoder().decode(isoBase64URL.toBuffer(handle)) !== pk.uid) fail('permission-denied', 'Face ID sign-in was not accepted.');
      await snap.ref.update({ counter: v.authenticationInfo.newCounter, lastUsedAt: FieldValue.serverTimestamp() });
      return { token: await getAuth().createCustomToken(pk.uid) };
    }

    case 'remove': {
      const uid = needUser(req);
      const id = str(data.credentialId, 1024) || fail('invalid-argument', 'Missing passkey.');
      const ref = passkeys.doc(id);
      const s = await ref.get();
      if (s.exists && s.data().uid === uid) await ref.delete();
      return { removed: s.exists && s.data().uid === uid };
    }

    default:
      fail('invalid-argument', 'Unknown action.');
  }
});

export { notify } from './notify.js';
export { billing, stripeWebhook, usageAdd, usageRemove, billingDaily, admin } from './billing.js';
