// Security rules tests for Our Circle. From this folder: npm install, then npm test.
// Runs the real Firebase rules engine on this computer (needs Java); nothing touches your live project.
// "attack" tests pass only when the rules BLOCK the attack; "app" tests pass only when real app actions still work.
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const DIR = process.env.RULES_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..');
let env;
const C = 'circles/c1';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-oc',
    firestore: { rules: fs.readFileSync(path.join(DIR, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: fs.readFileSync(path.join(DIR, 'storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const s = (p, d) => setDoc(doc(db, p), d);
    await s(C, { name: 'Test family', createdBy: 'uA', createdAt: 1 });
    await s(`${C}/access/uA`, { memberId: 'mA', role: 'admin' });
    await s(`${C}/access/uB`, { memberId: 'mB', role: 'member', invite: 'old1' });
    await s(`${C}/access/uC`, { memberId: 'mC', role: 'member', invite: 'old2' });
    await s(`${C}/households/h1`, { name: 'A house', order: 0 });
    await s(`${C}/households/h2`, { name: 'B house', order: 1 });
    await s(`${C}/households/h3`, { name: 'C house', order: 2 });
    const mem = (id, d) => s(`${C}/members/${id}`, { photo: null, order: 0, createdAt: 1, managedBy: [], claimed: !!d.uid, uid: null, ...d });
    await mem('mA', { name: 'A', householdId: 'h1', uid: 'uA' });
    await mem('mB', { name: 'B', householdId: 'h2', uid: 'uB' });
    await mem('mC', { name: 'C', householdId: 'h3', uid: 'uC' });
    await mem('mD', { name: 'D', householdId: 'h2' });
    await mem('mK', { name: 'Kid', householdId: 'h1', managedBy: ['mA'] });
    await s(`${C}/invites/inv1`, { memberId: 'mD', memberName: 'D', circleName: 'Test family', used: false, createdBy: 'mA', createdAt: 1 });
    await s(`${C}/chats/everyone`, { kind: 'everyone', name: 'Everyone', memberIds: [], lastText: '', lastAt: 1, lastBy: null, reads: {}, sent: {} });
    await s(`${C}/chats/p_mA_mB_mC`, { kind: 'group', name: 'Trip', memberIds: ['mA', 'mB', 'mC'], householdId: null, lastText: '', lastAt: 1, lastBy: null, reads: {}, sent: {} });
    await s(`${C}/album/p1`, { title: 'Party', caption: '', by: 'mA', at: 1, media: [{ url: 'https://x/1', type: 'image/jpeg', name: '1.jpg', size: 1 }] });
    await s(`${C}/events/e1`, { type: 'birthday', title: "A's birthday", date: '2000-01-02', endDate: null, recurring: true, memberIds: ['mA'], note: '', shared: true, createdBy: 'mA', createdAt: 1 });
    await s('journals/uA/entries/2026-01-01', { date: '2026-01-01', sections: [] });
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'circles/c1/media/existing.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const st = (uid) => env.authenticatedContext(uid).storage();
const chatBase = { lastText: '', lastAt: 1, lastBy: null, reads: {}, sent: {} };

// ───────── attacks (must be blocked) ─────────
test('attack: member plants an "everyone"-kind chat at a future DM id to read it', async () => {
  await assertFails(setDoc(doc(as('uC'), `${C}/chats/p_mA_mB`), { kind: 'everyone', name: '', memberIds: ['mA', 'mB'], householdId: null, ...chatBase }));
});
test('attack chain: a chat planted before the fix can\'t be used to read the DM', async () => {
  // Simulates a booby-trapped chat that already exists (planted earlier); A then messages B in it.
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `${C}/chats/p_mA_mB`), { kind: 'everyone', name: '', memberIds: ['mA', 'mB'], householdId: null, ...chatBase }));
  await env.withSecurityRulesDisabled((ctx) => addDoc(collection(ctx.firestore(), `${C}/chats/p_mA_mB/messages`), { by: 'mA', text: 'private', media: [], at: 2 }));
  await assertFails(getDocs(collection(as('uC'), `${C}/chats/p_mA_mB/messages`)));
  await assertFails(getDoc(doc(as('uC'), `${C}/chats/p_mA_mB`)));
});
test('attack: member plants a future DM id with themself hidden inside', async () => {
  await assertFails(setDoc(doc(as('uC'), `${C}/chats/p_mA_mB`), { kind: 'group', name: 'B', memberIds: ['mA', 'mB', 'mC'], householdId: null, ...chatBase }));
});
test('attack: member creates a profile whose id carries HTML (stored XSS)', async () => {
  await assertFails(setDoc(doc(as('uC'), `${C}/members/x" autofocus onfocus="alert(1)`), { name: 'x', householdId: 'h3', order: 0, photo: null, uid: null, claimed: false, managedBy: ['mC'], createdAt: 1 }));
});
test('attack: member creates an album post whose id carries HTML', async () => {
  await assertFails(setDoc(doc(as('uC'), `${C}/album/a"><img src=x onerror=alert(1)>`), { title: 't', caption: '', by: 'mC', at: 1, media: [] }));
});
test('attack: one invite code lets several accounts join (never marked used)', async () => {
  await assertFails(setDoc(doc(as('uE'), `${C}/access/uE`), { memberId: 'mD', role: 'member', invite: 'inv1' }));
});
test('attack: organizer re-points their own login at another member (reads their DMs)', async () => {
  await assertFails(updateDoc(doc(as('uA'), `${C}/access/uA`), { memberId: 'mB' }));
});
test('attack: organizer makes an invite for a member who already has a login', async () => {
  await assertFails(setDoc(doc(as('uA'), `${C}/invites/evil`), { memberId: 'mB', memberName: 'B', circleName: '', used: false, createdBy: 'mA', createdAt: 1 }));
});
test('attack: member moves themself into another household / sets managedBy', async () => {
  await assertFails(updateDoc(doc(as('uC'), `${C}/members/mC`), { householdId: 'h1' }));
  await assertFails(updateDoc(doc(as('uC'), `${C}/members/mC`), { managedBy: ['mC'] }));
});
test('attack: member renames another household', async () => {
  await assertFails(updateDoc(doc(as('uC'), `${C}/households/h1`), { name: 'hacked' }));
});
test('attack: member wipes the photos from someone else\'s album', async () => {
  await assertFails(updateDoc(doc(as('uC'), `${C}/album/p1`), { media: [] }));
});
test('attack: member fakes another person\'s read/sent times in a chat', async () => {
  await assertFails(updateDoc(doc(as('uC'), `${C}/chats/p_mA_mB_mC`), { 'reads.mA': 9e12 }));
  await assertFails(updateDoc(doc(as('uC'), `${C}/chats/p_mA_mB_mC`), { lastBy: 'mA', lastText: 'fake', lastAt: 5 }));
});
test('attack: member changes who created an event', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `${C}/events/e1`), { memberIds: ['mA', 'mC'] }));
  await assertFails(updateDoc(doc(as('uC'), `${C}/events/e1`), { createdBy: 'mC' }));
});
test('attack: member deletes family photo files in storage', async () => {
  await assertFails(deleteObject(ref(st('uC'), 'circles/c1/media/existing.jpg')));
});
test('attack: signed-out and outsider reads are refused', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, C)));
  await assertFails(getDoc(doc(as('uX'), `${C}/members/mA`)));
  await assertFails(getDoc(doc(as('uB'), 'journals/uA/entries/2026-01-01')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'circles/c1/media/existing.jpg')));
  await assertFails(getBytes(ref(st('uX'), 'circles/c1/media/existing.jpg')));
});

// ───────── real app actions (must still work) ─────────
test('app: start a new family circle (two batches, then users doc)', async () => {
  const db = as('uN');
  const b1 = writeBatch(db);
  b1.set(doc(db, 'circles/c2'), { name: 'New', createdBy: 'uN', createdAt: 1, theme: 'evergreen' });
  b1.set(doc(db, 'circles/c2/access/uN'), { memberId: 'mN', role: 'admin' });
  await assertSucceeds(b1.commit());
  const b2 = writeBatch(db);
  b2.set(doc(db, 'circles/c2/households/hN'), { name: 'N house', order: 0 });
  b2.set(doc(db, 'circles/c2/members/mN'), { name: 'N', householdId: 'hN', order: 0, photo: null, uid: 'uN', claimed: true, managedBy: [], createdAt: 1 });
  await assertSucceeds(b2.commit());
  await assertSucceeds(setDoc(doc(db, 'users/uN'), { circles: ['c2'], current: 'c2', prefs: { checkinDays: 7 } }, { merge: true }));
});
test('app: join with an invite link (one batch), and the link then stops working', async () => {
  const db = as('uD');
  await assertSucceeds(getDoc(doc(db, `${C}/invites/inv1`)));
  const b = writeBatch(db);
  b.set(doc(db, `${C}/access/uD`), { memberId: 'mD', role: 'member', invite: 'inv1' });
  b.update(doc(db, `${C}/invites/inv1`), { used: true, usedBy: 'uD' });
  b.update(doc(db, `${C}/members/mD`), { uid: 'uD', claimed: true });
  await assertSucceeds(b.commit());
  const db2 = as('uZ');
  const b2 = writeBatch(db2);
  b2.set(doc(db2, `${C}/access/uZ`), { memberId: 'mD', role: 'member', invite: 'inv1' });
  b2.update(doc(db2, `${C}/invites/inv1`), { used: true, usedBy: 'uZ' });
  await assertFails(b2.commit());
});
test('app: direct, household and group chats; everyone chat', async () => {
  const db = as('uB');
  await assertSucceeds(setDoc(doc(db, `${C}/chats/p_mA_mB`), { kind: 'direct', name: '', memberIds: ['mA', 'mB'], householdId: null, ...chatBase }));
  await assertSucceeds(setDoc(doc(db, `${C}/chats/p_mB_mD`), { kind: 'household', name: 'B house', memberIds: ['mB', 'mD'], householdId: 'h2', ...chatBase }));
  await assertSucceeds(setDoc(doc(db, `${C}/chats/p_mA_mB_mK`), { kind: 'group', name: 'Kids', memberIds: ['mA', 'mB', 'mK'], householdId: null, ...chatBase }));
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), `${C}/chats/everyone`)));
  await assertSucceeds(setDoc(doc(db, `${C}/chats/everyone`), { kind: 'everyone', name: 'Everyone', memberIds: [], ...chatBase }));
  await assertSucceeds(getDoc(doc(as('uA'), `${C}/chats/p_mA_mB`)));
  await assertFails(getDoc(doc(as('uC'), `${C}/chats/p_mA_mB`)));
  await assertSucceeds(getDocs(query(collection(db, `${C}/chats`), where('memberIds', 'array-contains', 'mB'))));
});
test('app: send a message, update the chat preview, mark as read', async () => {
  const db = as('uB');
  await assertSucceeds(addDoc(collection(db, `${C}/chats/p_mA_mB_mC/messages`), { by: 'mB', text: 'hi', media: [], at: 2 }));
  await assertSucceeds(updateDoc(doc(db, `${C}/chats/p_mA_mB_mC`), { lastText: 'hi', lastAt: 2, lastBy: 'mB', 'sent.mB': 2, 'reads.mB': 2 }));
  await assertSucceeds(updateDoc(doc(as('uA'), `${C}/chats/p_mA_mB_mC`), { 'reads.mA': 3 }));
  await assertSucceeds(addDoc(collection(db, `${C}/chats/everyone/messages`), { by: 'mB', text: 'all', media: [], at: 2 }));
  await assertSucceeds(updateDoc(doc(db, `${C}/chats/everyone`), { lastText: 'all', lastAt: 2, lastBy: 'mB', 'sent.mB': 2, 'reads.mB': 2 }));
  await assertSucceeds(getDocs(collection(as('uC'), `${C}/chats/p_mA_mB_mC/messages`)));
});
test('app: edit my own name and photo', async () => {
  await assertSucceeds(updateDoc(doc(as('uC'), `${C}/members/mC`), { name: 'Cee' }));
  await assertSucceeds(updateDoc(doc(as('uC'), `${C}/members/mC`), { photo: 'https://x/p.jpg' }));
});
test('app: parent adds, edits, invites and removes a child profile', async () => {
  const db = as('uA');
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `${C}/access/uA`), { role: 'member' }));
  await assertSucceeds(setDoc(doc(db, `${C}/members/mK2`), { name: 'Kid2', householdId: 'h1', order: 6, photo: null, uid: null, claimed: false, managedBy: ['mA'], createdAt: 1 }));
  await assertSucceeds(updateDoc(doc(db, `${C}/members/mK2`), { name: 'Kiddo', photo: 'https://x/k.jpg' }));
  await assertSucceeds(addDoc(collection(db, `${C}/events`), { type: 'birthday', title: "Kid2's birthday", date: '2020-05-05', endDate: null, recurring: true, memberIds: ['mK2'], note: '', shared: true, createdBy: 'mA', createdAt: 1 }));
  await assertSucceeds(setDoc(doc(db, `${C}/invites/kidinv`), { memberId: 'mK2', memberName: 'Kiddo', circleName: 'Test family', used: false, createdBy: 'mA', createdAt: 1 }));
  await assertSucceeds(deleteDoc(doc(db, `${C}/members/mK2`)));
});
test('app: organizer manages households, people, roles and removals', async () => {
  const db = as('uA');
  await assertSucceeds(addDoc(collection(db, `${C}/households`), { name: 'New house', order: 3 }));
  await assertSucceeds(updateDoc(doc(db, `${C}/households/h2`), { name: 'B home', order: 0, color: 'sage' }));
  await assertSucceeds(setDoc(doc(db, `${C}/members/mE`), { name: 'E', householdId: 'h3', order: 5, photo: null, uid: null, claimed: false, managedBy: [], createdAt: 1 }));
  await assertSucceeds(updateDoc(doc(db, `${C}/members/mB`), { name: 'Bee', householdId: 'h3' }));
  await assertSucceeds(updateDoc(doc(db, `${C}/members/mB`), { photo: 'https://x/b.jpg' }));
  await assertSucceeds(updateDoc(doc(db, `${C}/access/uB`), { role: 'admin' }));
  await assertSucceeds(setDoc(doc(db, `${C}/invites/ok1`), { memberId: 'mE', memberName: 'E', circleName: 'Test family', used: false, createdBy: 'mA', createdAt: 1 }));
  await assertSucceeds(getDocs(collection(db, `${C}/access`)));
  await assertSucceeds(updateDoc(doc(db, C), { name: 'Renamed' }));
  await assertSucceeds(deleteDoc(doc(db, `${C}/access/uC`)));
  await assertSucceeds(deleteDoc(doc(db, `${C}/members/mC`)));
  await assertSucceeds(deleteDoc(doc(db, `${C}/households/h3`)));
});
test('app: events: add, edit, delete my own', async () => {
  const db = as('uC');
  const r = await assertSucceeds(addDoc(collection(db, `${C}/events`), { type: 'trip', title: 'Trip', date: '2026-12-01', endDate: '2026-12-05', recurring: false, memberIds: [], note: '', shared: true, createdBy: 'mC', createdAt: 1 }));
  await assertSucceeds(updateDoc(r, { type: 'trip', title: 'Trip 2', date: '2026-12-01', endDate: null, recurring: false, memberIds: ['mC'], note: 'x', shared: true }));
  await assertSucceeds(deleteDoc(r));
  await assertSucceeds(updateDoc(doc(as('uA'), `${C}/events/e1`), { title: 'A bday', date: '2000-01-02' }));
});
test('app: album: share, others add photos, owner edits and deletes', async () => {
  const db = as('uC');
  const r = await assertSucceeds(addDoc(collection(db, `${C}/album`), { title: 'Trip', caption: '', by: 'mC', at: 1, media: [{ url: 'https://x/2', type: 'image/jpeg', name: '2.jpg', size: 2 }] }));
  await assertSucceeds(updateDoc(doc(as('uB'), `${C}/album/${r.id}`), { media: [{ url: 'https://x/2', type: 'image/jpeg', name: '2.jpg', size: 2 }, { url: 'https://x/3', type: 'video/mp4', name: '3.mp4', size: 3 }] }));
  await assertSucceeds(updateDoc(r, { title: 'Trip!', caption: 'fun' }));
  await assertSucceeds(deleteDoc(r));
  await assertSucceeds(updateDoc(doc(as('uA'), `${C}/album/p1`), { title: 'Admin edit', caption: '' }));
});
test('app: journal, goals and personal settings stay private to me', async () => {
  const db = as('uB');
  await assertSucceeds(setDoc(doc(db, 'journals/uB'), { defaultTemplate: 'daily' }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, 'journals/uB/entries/2026-11-17'), { date: '2026-11-17', sections: [], saved: true }));
  await assertSucceeds(addDoc(collection(db, 'journals/uB/goals'), { title: 'Read', freq: 'daily', done: {}, archived: false, createdAt: 1 }));
  await assertSucceeds(getDocs(collection(db, 'journals/uB/entries')));
  await assertSucceeds(setDoc(doc(db, 'users/uB'), { prefs: { checkinDays: 14 } }, { merge: true }));
  await assertFails(getDoc(doc(as('uA'), 'journals/uB/entries/2026-11-17')));
  await assertFails(getDoc(doc(as('uA'), 'users/uB')));
});
test('app: storage: members upload and view originals; organizer can delete', async () => {
  await assertSucceeds(uploadBytes(ref(st('uC'), 'circles/c1/media/abc_photo.jpg'), new Uint8Array([1]), { contentType: 'image/jpeg' }));
  await assertSucceeds(getBytes(ref(st('uB'), 'circles/c1/media/existing.jpg')));
  await assertSucceeds(deleteObject(ref(st('uA'), 'circles/c1/media/existing.jpg')));
});
test('app: a member can leave (delete their own access)', async () => {
  await assertSucceeds(deleteDoc(doc(as('uC'), `${C}/access/uC`)));
});
