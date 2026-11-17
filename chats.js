// Chats list and a single conversation.
import * as S from './store.js';
import { esc, icon, face, toast, fmtSize, listJoin, names, safeUrl, mediaKind } from './ui.js';
import { ago } from './dates.js';

export function chatTitle(app, c) {
  if (c.kind === 'everyone') return 'Everyone';
  const others = (c.memberIds || []).filter((id) => id !== app.state.me).map((id) => app.member(id)?.name).filter(Boolean);
  if (c.kind === 'direct') return others[0] || 'Chat';
  return c.name || listJoin(others);
}

export function mount(root, app, key, args) {
  return key === 'chat' && args[0] ? conversation(root, app, args[0]) : list(root, app);
}

function list(root, app) {
  const st = app.state;
  const render = () => {
    const rows = app.chatList();
    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">Chats</h1></div></header>
      <section class="block"><div class="card list">
        ${rows.map((c) => {
          const unread = c.lastBy && c.lastBy !== st.me && (c.lastAt || 0) > (c.reads?.[st.me] || 0);
          const others = (c.memberIds || []).filter((id) => id !== st.me);
          const lead = c.kind === 'everyone' ? `<span class="face sq-ic">${icon('users', 20)}</span>` : face(app.member(others[0]) || { name: chatTitle(app, c) });
          const who = c.lastBy ? (c.lastBy === st.me ? 'You: ' : (app.member(c.lastBy)?.name || '') + ': ') : '';
          return `<a class="li chat-row" href="#/chat/${encodeURIComponent(c.id)}">
            ${lead}
            <span class="li-main"><span class="li-title">${names(chatTitle(app, c))}${c.kind === 'household' || c.kind === 'group' ? `<small class="muted"> · ${(c.memberIds || []).length} people</small>` : ''}</span>
            <span class="li-sub ${unread ? 'strong' : ''}">${c.lastText ? esc(who + c.lastText) : 'No messages yet'}</span></span>
            <span class="li-when">${c.lastText ? ago(c.lastAt) : ''}${unread ? '<i class="unread" aria-label="unread"></i>' : ''}</span>
          </a>`;
        }).join('')}
      </div></section>
      <p class="hint center">Start a household or one-on-one chat from the Family tab.</p>`;
  };
  const off = app.on(render);
  render();
  return { destroy: off };
}

function conversation(root, app, chatId) {
  const st = app.state;
  let msgs = [];
  let files = [];
  let lastMarked = 0;

  root.innerHTML = `
    <div class="convo">
      <header class="convo-head">
        <a class="icon-btn" href="#/chats" aria-label="Back to chats">${icon('back')}</a>
        <div class="convo-title"><b id="ct"></b><small id="cs"></small></div>
      </header>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <div class="pending" id="pending" hidden></div>
      <form class="composer" id="composer">
        <label class="icon-btn" for="att" aria-label="Add photos or videos">${icon('image')}</label>
        <input id="att" type="file" accept="image/*,video/*" multiple hidden>
        <label for="msg" class="sr">Message</label>
        <textarea id="msg" rows="1" placeholder="Message"></textarea>
        <button class="icon-btn send" type="submit" aria-label="Send">${icon('send')}</button>
      </form>
    </div>`;
  const box = root.querySelector('#msgs');
  const ta = root.querySelector('#msg');
  const pending = root.querySelector('#pending');
  try { const d = sessionStorage.getItem('oc-draft-' + chatId); if (d) { ta.value = d; sessionStorage.removeItem('oc-draft-' + chatId); } } catch (e) {}

  const head = () => {
    const c = st.chats[chatId];
    if (!c) { root.querySelector('#ct').textContent = 'Chat'; return; }
    root.querySelector('#ct').textContent = chatTitle(app, c);
    const names = c.kind === 'everyone' ? 'The whole family' : listJoin((c.memberIds || []).map((id) => (id === st.me ? 'You' : app.member(id)?.name)).filter(Boolean));
    root.querySelector('#cs').textContent = names;
  };

  const media = (m) => (m.media || []).map((f) => {
    const kind = mediaKind(f), isImg = kind === 'image', isVid = kind === 'video';
    const url = safeUrl(f.url);
    return `<div class="media">
      ${isImg ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(f.name)}" loading="lazy"></a>` : ''}
      ${isVid ? `<video src="${esc(url)}" controls playsinline preload="metadata"></video>` : ''}
      ${!isImg && !isVid ? `<span class="file">${esc(f.name)}</span>` : ''}
      <a class="dl" href="${esc(url)}" download="${esc(f.name)}" target="_blank" rel="noopener">${icon('download', 14)} Original · ${fmtSize(f.size)}</a>
    </div>`;
  }).join('');

  const renderMsgs = () => {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    let prev = null;
    box.innerHTML = msgs.length ? msgs.map((m) => {
      const mine = m.by === st.me;
      const who = app.member(m.by);
      const showWho = !mine && (prev?.by !== m.by || m.at - prev.at > 600000);
      const gap = !prev || m.at - prev.at > 3600000;
      prev = m;
      return `${gap ? `<div class="stamp">${new Date(m.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>` : ''}
      <div class="msg ${mine ? 'mine' : ''}">
        ${!mine ? (showWho ? face(who || { name: '?' }, 'sm') : '<span class="face-gap"></span>') : ''}
        <div class="bubble-wrap">${showWho ? `<small class="who">${esc(who?.name || '')}</small>` : ''}
          <div class="bubble">${m.text ? `<p>${esc(m.text)}</p>` : ''}${media(m)}</div></div>
      </div>`;
    }).join('') : '<p class="hint center pad">Say hello. Messages stay here for the family.</p>';
    if (nearBottom || !box.dataset.init) { box.scrollTop = box.scrollHeight; box.dataset.init = '1'; }
  };

  const markRead = () => {
    const c = st.chats[chatId];
    if (!c || !c.lastAt || (c.reads?.[st.me] || 0) >= c.lastAt || lastMarked >= c.lastAt) return;
    lastMarked = c.lastAt;
    S.update(app.path('chats/' + chatId), { ['reads.' + st.me]: Date.now() }).catch(() => {});
  };

  const showPending = () => {
    pending.hidden = !files.length;
    pending.innerHTML = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} ready to send · ${fmtSize(files.reduce((a, f) => a + f.size, 0))} <button type="button" class="linkish" id="clear">Remove</button>` : '';
    pending.querySelector('#clear')?.addEventListener('click', () => { files = []; showPending(); });
  };

  root.querySelector('#att').onchange = (e) => { files = [...e.target.files]; e.target.value = ''; showPending(); };
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); root.querySelector('#composer').requestSubmit(); } });
  root.querySelector('#composer').onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text && !files.length) return;
    const sending = files;
    ta.value = ''; ta.style.height = 'auto'; files = []; showPending();
    if (sending.length) { pending.hidden = false; pending.textContent = 'Uploading originals… 0%'; }
    try {
      await app.send(chatId, text, sending, (p) => { pending.textContent = `Uploading originals… ${Math.round(p * 100)}%`; });
    } catch (err) {
      console.error(err); ta.value = text; toast('Message did not send. Check your connection and try again.');
    }
    pending.hidden = true;
  };

  const unsub = S.watchColl(app.path(`chats/${chatId}/messages`), { orderBy: ['at', 'desc'], limit: 300 }, (rows) => {
    msgs = rows.reverse(); renderMsgs(); markRead();
  });
  const off = app.on(() => { head(); markRead(); });
  head();
  return { destroy: () => { unsub(); off(); } };
}
