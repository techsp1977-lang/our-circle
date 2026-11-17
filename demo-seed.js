// Sample data for demo mode only. Real use starts empty and you add your family.
const DAY = 86400000;
const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const shift = (days) => iso(Date.now() + days * DAY);
const mmdd = (days) => shift(days).slice(5); // month-day, any year

function tile(label, a, b) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="450" fill="url(#g)"/><text x="300" y="235" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function seed() {
  const C = 'circles/proctors';
  const now = Date.now();
  const db = {};
  db[C] = { name: 'The Proctors', createdBy: 'u_spencer', createdAt: now - 40 * DAY, theme: 'evergreen' };

  const households = [
    ['h_sj', 'Spencer & Jeana', 0],
    ['h_jsj', 'Jamison, Sophi & Jack', 1],
    ['h_br', 'Braelyn & Romney', 2],
    ['h_colsen', 'Colsen', 3],
    ['h_mckay', 'McKay', 4],
    ['h_leah', 'Leah', 5],
  ];
  households.forEach(([id, name, order]) => (db[`${C}/households/${id}`] = { name, order }));

  const people = [
    ['spencer', 'Spencer', 'h_sj', 'admin'],
    ['jeana', 'Jeana', 'h_sj', 'member'],
    ['jamison', 'Jamison', 'h_jsj', 'member'],
    ['sophi', 'Sophi', 'h_jsj', 'member'],
    ['jack', 'Jack', 'h_jsj', null],
    ['braelyn', 'Braelyn', 'h_br', 'member'],
    ['romney', 'Romney', 'h_br', 'member'],
    ['colsen', 'Colsen', 'h_colsen', 'member'],
    ['mckay', 'McKay', 'h_mckay', 'member'],
    ['leah', 'Leah', 'h_leah', 'member'],
  ];
  people.forEach(([k, name, hid, role], i) => {
    const hasAccount = !!role;
    db[`${C}/members/m_${k}`] = {
      name, householdId: hid, order: i, photo: null,
      uid: hasAccount ? 'u_' + k : null, claimed: hasAccount,
      managedBy: k === 'jack' ? ['m_jamison', 'm_sophi'] : [],
      createdAt: now - 40 * DAY,
    };
    if (hasAccount) {
      db[`${C}/access/u_${k}`] = { memberId: 'm_' + k, role };
      db[`users/u_${k}`] = { circles: ['proctors'], current: 'proctors', prefs: { checkinDays: 7 } };
    }
  });

  const ev = (id, o) => (db[`${C}/events/${id}`] = { shared: true, createdAt: now, note: '', endDate: null, ...o });
  ev('e_trip', { title: 'Family trip · Cancún', type: 'trip', date: '2027-07-09', endDate: '2027-07-25', recurring: false, memberIds: [], createdBy: 'm_spencer', note: 'Everyone' });
  ev('e_grad', { title: "Romney's graduation", type: 'graduation', date: shift(0), recurring: false, memberIds: ['m_romney'], createdBy: 'm_romney' });
  ev('e_anniv_js', { title: 'Jamison & Sophi · anniversary', type: 'anniversary', date: '2023-' + mmdd(12), recurring: true, memberIds: ['m_jamison', 'm_sophi'], createdBy: 'm_jamison' });
  ev('e_bday_jack', { title: "Jack's birthday", type: 'birthday', date: '2026-' + mmdd(24), recurring: true, memberIds: ['m_jack'], createdBy: 'm_jamison' });
  ev('e_bday_leah', { title: "Leah's birthday", type: 'birthday', date: '2008-' + mmdd(50), recurring: true, memberIds: ['m_leah'], createdBy: 'm_leah' });

  // Conversations
  const all = people.map(([k]) => 'm_' + k);
  db[`${C}/chats/everyone`] = { kind: 'everyone', name: 'Everyone', memberIds: all, lastText: 'Who is bringing rolls Sunday?', lastAt: now - 3 * 3600e3, lastBy: 'm_jeana', reads: {}, sent: { m_jeana: now - 3 * 3600e3, m_spencer: now - 20 * 3600e3 } };
  db[`${C}/chats/everyone/messages/a1`] = { by: 'm_spencer', text: 'Dinner at our place Sunday at 5. Everyone welcome!', media: [], at: now - 20 * 3600e3 };
  db[`${C}/chats/everyone/messages/a2`] = { by: 'm_leah', text: 'I will be there 🙌', media: [], at: now - 8 * 3600e3 };
  db[`${C}/chats/everyone/messages/a3`] = { by: 'm_jeana', text: 'Who is bringing rolls Sunday?', media: [], at: now - 3 * 3600e3 };

  const jsjId = 'p_' + ['m_jack', 'm_jamison', 'm_sophi', 'm_spencer'].sort().join('_');
  db[`${C}/chats/${jsjId}`] = { kind: 'household', name: 'Jamison, Sophi & Jack', householdId: 'h_jsj', memberIds: ['m_jack', 'm_jamison', 'm_sophi', 'm_spencer'].sort(), lastText: 'Jack took his first steps!', lastAt: now - 2 * DAY, lastBy: 'm_sophi', reads: { m_spencer: now - DAY }, sent: { m_spencer: now - 2.2 * DAY, m_sophi: now - 2 * DAY } };
  db[`${C}/chats/${jsjId}/messages/b1`] = { by: 'm_spencer', text: 'How is the little guy doing?', media: [], at: now - 2.2 * DAY };
  db[`${C}/chats/${jsjId}/messages/b2`] = { by: 'm_sophi', text: 'Jack took his first steps!', media: [], at: now - 2 * DAY };

  const brId = 'p_' + ['m_braelyn', 'm_romney', 'm_spencer'].sort().join('_');
  db[`${C}/chats/${brId}`] = { kind: 'household', name: 'Braelyn & Romney', householdId: 'h_br', memberIds: ['m_braelyn', 'm_romney', 'm_spencer'].sort(), lastText: 'Aloha from Kauaʻi!', lastAt: now - 9 * DAY, lastBy: 'm_braelyn', reads: { m_spencer: now - 9 * DAY }, sent: { m_spencer: now - 10 * DAY, m_braelyn: now - 9 * DAY } };
  db[`${C}/chats/${brId}/messages/c1`] = { by: 'm_spencer', text: 'How was the week?', media: [], at: now - 10 * DAY };
  db[`${C}/chats/${brId}/messages/c2`] = { by: 'm_braelyn', text: 'Aloha from Kauaʻi!', media: [], at: now - 9 * DAY };

  db[`${C}/album/p1`] = {
    title: "Leah's birthday party", caption: 'Sample photos for the demo', by: 'm_jeana', at: now - 5 * DAY,
    media: [
      { url: tile('Cake time', '#2F5D4A', '#8FB3A0'), type: 'image/svg+xml', name: 'cake.svg', size: 1200 },
      { url: tile('Presents', '#B5651D', '#F1C27D'), type: 'image/svg+xml', name: 'presents.svg', size: 1200 },
      { url: tile('The whole crew', '#1E5763', '#8CC6D1'), type: 'image/svg+xml', name: 'crew.svg', size: 1200 },
    ],
  };

  db['journals/u_spencer/entries/' + shift(-1)] = {
    date: shift(-1), template: 'daily', updatedAt: now - DAY,
    sections: [
      { title: 'How my day went', text: 'Sample entry: a long shift, then dinner with Jeana. Grateful for quiet evenings.' },
      { title: "Three things I'm grateful for", list: ['Jeana', 'Healthy kids', 'A good night of sleep'] },
    ],
  };
  // sample goals (private to Spencer)
  const done = (n, step) => Object.fromEntries(Array.from({ length: n }, (_, i) => [shift(-i * step - 1), true]));
  db['journals/u_spencer/goals/g1'] = { title: 'Read scriptures', freq: 'daily', done: done(5, 1), archived: false, createdAt: now - 30 * DAY };
  db['journals/u_spencer/goals/g2'] = { title: 'Date night with Jeana', freq: 'weekly', done: {}, archived: false, createdAt: now - 29 * DAY };
  db['journals/u_spencer/goals/g3'] = { title: 'Golf with the boys', freq: 'monthly', done: {}, archived: false, createdAt: now - 28 * DAY };
  return db;
}
