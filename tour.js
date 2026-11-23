// Quick tour page: tap a step to jump the video there; the step being shown is highlighted.
const v = document.getElementById('v');
const items = [...document.querySelectorAll('#steps li')];
const times = items.map((li) => Number(li.querySelector('button').dataset.t));
document.getElementById('steps').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-t]');
  if (!b) return;
  v.currentTime = Number(b.dataset.t);
  v.play().catch(() => {});
  if (window.matchMedia('(max-width: 639px)').matches) v.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
v.addEventListener('timeupdate', () => {
  let cur = -1;
  times.forEach((t, i) => { if (v.currentTime >= t - 0.25) cur = i; });
  items.forEach((li, i) => li.classList.toggle('on', i === cur));
});
