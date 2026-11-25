// Chats list and a single conversation.
import * as S from './store.js';
import { esc, icon, face, toast, fmtSize, listJoin, names, safeUrl, mediaKind, hhColor, hhInk, hhEdge, sheet, why } from './ui.js';
import { ago } from './dates.js';
import { pausedText } from './plans.js';

// Reactions on a message: one per person (tap another to change it, the same one again to remove it).
// The security rules accept only these, so keep the two lists the same.
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

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
        <a class="icon-btn" href="#/chats" data-back="#/chats" aria-label="Back">${icon('back')}</a>
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
    // A household or one-on-one chat wears that household's shade of the circle color; the family-wide chat keeps the main color.
    const hids = [...new Set((c.memberIds || []).filter((id) => id !== st.me).map((id) => app.member(id)?.householdId).filter(Boolean))];
    const hh = c.kind === 'everyone' ? null : app.household(c.householdId) || (hids.length === 1 ? app.household(hids[0]) : null);
    const convo = root.querySelector('.convo');
    if (hh) { convo.style.setProperty('--chat', hhColor(hh)); convo.style.setProperty('--chat-ink', hhInk(hh)); convo.style.setProperty('--chat-edge', hhEdge(hh)); } else { convo.style.removeProperty('--chat'); convo.style.removeProperty('--chat-ink'); convo.style.removeProperty('--chat-edge'); }
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

  // The little reaction badge under a message: each reaction with its count. Tap it to see who.
  const reacts = (m) => {
    const all = Object.values(m.reactions || {}).filter((v) => REACTIONS.includes(v));
    if (!all.length) return '';
    const counts = REACTIONS.map((e) => [e, all.filter((v) => v === e).length]).filter(([, n]) => n);
    const label = counts.map(([e, n]) => `${e} ${n}`).join(', ');
    return `<button type="button" class="reacts ${m.reactions?.[st.me] ? 'has-mine' : ''}" data-reacts="${esc(m.id)}" aria-label="Reactions: ${esc(label)}. Tap to see who.">${counts.map(([e, n]) => `<span>${e}${n > 1 ? `<b>${n}</b>` : ''}</span>`).join('')}</button>`;
  };

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
      <div class="msg ${mine ? 'mine' : ''}" data-mid="${esc(m.id)}">
        ${!mine ? (showWho ? face(who || { name: '?' }, 'sm') : '<span class="face-gap"></span>') : ''}
        <div class="bubble-wrap">${showWho ? `<small class="who">${esc(who?.name || '')}</small>` : ''}
          <div class="bubble">${m.text ? `<p>${esc(m.text)}</p>` : ''}${media(m)}</div>${reacts(m)}</div>
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

  root.querySelector('#att').onchange = (e) => {
    if (st.circle?.paused) { e.target.value = ''; toast(pausedText(st.circle, app.isAdmin()), 9000); return; }
    files = [...e.target.files]; e.target.value = ''; showPending();
  };
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

  // ───────── reactions: long-press (or right-click) a message for the bar; double-tap for a quick ❤️ ─────────
  const msgPath = (id) => app.path(`chats/${chatId}/messages/${id}`);
  const react = async (id, emoji) => {
    const m = msgs.find((x) => x.id === id);
    if (!m) return;
    const same = m.reactions?.[st.me] === emoji;
    // Show it right away; the database confirms a moment later.
    m.reactions = { ...(m.reactions || {}) }; if (same) delete m.reactions[st.me]; else m.reactions[st.me] = emoji; renderMsgs();
    try { same ? await S.removeField(msgPath(id), 'reactions.' + st.me) : await S.update(msgPath(id), { ['reactions.' + st.me]: emoji }); }
    catch (e) { toast(why("That reaction didn't save.", e), 6000); }
  };
  const closeBar = () => document.querySelectorAll('.react-wrap').forEach((w) => w.remove());
  const openBar = (id, bubble) => {
    closeBar();
    const m = msgs.find((x) => x.id === id);
    if (!m) return;
    try { navigator.vibrate?.(8); } catch (e) {}
    const wrap = document.createElement('div');
    wrap.className = 'react-wrap';
    wrap.innerHTML = `<div class="react-bar" role="menu" aria-label="React to this message">
      ${REACTIONS.map((e) => `<button type="button" role="menuitem" data-emo="${e}" class="${m.reactions?.[st.me] === e ? 'on' : ''}" aria-label="React ${e}">${e}</button>`).join('')}
      ${m.text ? `<button type="button" role="menuitem" class="copy" data-copy aria-label="Copy text">${icon('copy', 18)}</button>` : ''}
    </div>`;
    document.body.appendChild(wrap);
    const bar = wrap.firstElementChild, r = bubble.getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
    const top = r.top - bh - 8 > 60 ? r.top - bh - 8 : Math.min(r.bottom + 8, innerHeight - bh - 90);
    const left = Math.max(8, Math.min(innerWidth - bw - 8, (bubble.closest('.msg.mine') ? r.right - bw : r.left)));
    bar.style.top = top + 'px'; bar.style.left = left + 'px';
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.emo) react(id, b.dataset.emo);
      if (b?.hasAttribute('data-copy')) { try { await navigator.clipboard.writeText(m.text); toast('Copied.'); } catch (er) { toast("Couldn't copy on this phone."); } }
      closeBar();
    });
    bar.querySelector('button')?.focus({ preventScroll: true });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBar(); });
  };
  let press = null, lastTap = { id: null, at: 0 };
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.bubble');
    if (!b || e.button > 0 || e.target.closest('video, .dl')) return;
    const id = b.closest('[data-mid]')?.dataset.mid;
    press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; openBar(id, b); }, 430) };
  });
  box.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => box.addEventListener(t, cancelPress));
  box.addEventListener('scroll', cancelPress, { passive: true });
  box.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.bubble');
    if (!b) return;
    e.preventDefault(); cancelPress(); openBar(b.closest('[data-mid]')?.dataset.mid, b);
  });
  box.addEventListener('click', (e) => {
    const who = e.target.closest('[data-reacts]');
    if (who) { showWho(who.dataset.reacts); return; }
    const b = e.target.closest('.bubble');
    if (!b || e.target.closest('.media')) return;
    const id = b.closest('[data-mid]')?.dataset.mid, now = Date.now();
    if (lastTap.id === id && now - lastTap.at < 320) { lastTap = { id: null, at: 0 }; react(id, '❤️'); }
    else lastTap = { id, at: now };
  });
  const showWho = (id) => {
    const m = msgs.find((x) => x.id === id);
    const rows = REACTIONS.map((e) => [e, Object.entries(m?.reactions || {}).filter(([, v]) => v === e).map(([mid]) => (mid === st.me ? 'You' : app.member(mid)?.name || 'Someone'))]).filter(([, w]) => w.length);
    sheet({ title: 'Reactions', submit: 'Done', body: `<div class="card list">${rows.map(([e, w]) => `<div class="li"><span class="react-big" aria-hidden="true">${e}</span><span class="li-main"><span class="li-title">${esc(listJoin(w))}</span></span></div>`).join('')}</div>`, fields: [] });
  };

  const unsub = S.watchColl(app.path(`chats/${chatId}/messages`), { orderBy: ['at', 'desc'], limit: 300 }, (rows) => {
    msgs = rows.reverse(); renderMsgs(); markRead();
  });
  const off = app.on(() => { head(); markRead(); });
  head();
  return { destroy: () => { unsub(); off(); closeBar(); } };
}
