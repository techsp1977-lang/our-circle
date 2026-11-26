// Adds a family-sized test circle to the local emulators (never the live project): 40 people, 12 households,
// 80 dates, 25 chats (600 messages in the family chat), 40 albums of 30 photos. Sign in as spencer@test.dev / password1.
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url)); // uses functions/node_modules
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Set FIRESTORE_EMULATOR_HOST: this only writes to the local emulators.'); process.exit(1); }
const { initializeApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore'), { getAuth } = require('firebase-admin/auth');
initializeApp({ projectId: 'demo-oc' });
const db = getFirestore(), auth = getAuth();
const u = await auth.createUser({ email: 'spencer@test.dev', password: 'password1' }).catch(() => auth.getUserByEmail('spencer@test.dev'));
const uid = u.uid, C = 'circles/fam', now = Date.now(), w = db.bulkWriter();
w.set(db.doc(C), { name: 'The Proctors', createdBy: uid, createdAt: 1, theme: 'evergreen', motto: 'Love one another' });
w.set(db.doc(`${C}/access/${uid}`), { memberId: 'm0', role: 'admin' });
w.set(db.doc(`users/${uid}`), { circles: ['fam'], current: 'fam', prefs: { checkinDays: 14 } });
for (let h = 0; h < 12; h++) w.set(db.doc(`${C}/households/h${h}`), { name: `Family ${h} & Co`, order: h, parentId: h ? 'h0' : null });
for (let m = 0; m < 40; m++) w.set(db.doc(`${C}/members/m${m}`), { name: `Person${m} Name`, householdId: `h${m % 12}`, order: m, photo: null, uid: m === 0 ? uid : (m < 20 ? 'u' + m : null), claimed: m < 20, managedBy: [], createdAt: 1 });
for (let e = 0; e < 80; e++) w.set(db.doc(`${C}/events/e${e}`), { type: e % 3 ? 'birthday' : 'anniversary', title: `Event ${e}`, date: `19${50 + (e % 49)}-${String(1 + (e % 12)).padStart(2, '0')}-${String(1 + (e % 27)).padStart(2, '0')}`, recurring: true, memberIds: [`m${e % 40}`], note: '', shared: true, createdBy: 'm0', createdAt: 1 });
const chats = [['everyone', { kind: 'everyone', name: 'Everyone', memberIds: [] }]];
for (let c = 1; c < 25; c++) chats.push([`p_c${c}`, { kind: 'group', name: `Group ${c}`, memberIds: ['m0', `m${c}`, `m${c + 1}`] }]);
for (const [id, d] of chats) {
  w.set(db.doc(`${C}/chats/${id}`), { ...d, householdId: null, lastText: 'hello', lastAt: now - 1000, lastBy: 'm1', reads: { m0: now - 5000 }, sent: { m0: now - 864e5 } });
  const n = id === 'everyone' ? 600 : 120;
  for (let i = 0; i < n; i++) w.set(db.doc(`${C}/chats/${id}/messages/x${i}`), { by: `m${i % 5}`, text: `Message number ${i} with a little bit of text to read, like a normal family text.`, media: [], at: now - (n - i) * 60000 });
}
const url = (a, i, k) => `https://firebasestorage.googleapis.com/v0/b/x/o/circles%2Ffam%2Fmedia%2Fa${a}_${i}${k}.jpg?alt=media&token=0123456789abcdef0123456789abcdef`;
for (let a = 0; a < 40; a++) w.set(db.doc(`${C}/album/a${a}`), { title: `Album ${a}`, caption: '', by: 'm0', at: now - a * 7 * 864e5,
  media: Array.from({ length: 30 }, (_, i) => ({ url: url(a, i, ''), display: url(a, i, '_d'), thumb: url(a, i, '_t'), type: 'image/jpeg', name: `IMG_${i}.jpg`, size: 2400000, by: 'm0', path: `circles/fam/media/a${a}_${i}.jpg` })) });
await w.close();
console.log('Test family added. Sign in as spencer@test.dev / password1');
process.exit(0);
