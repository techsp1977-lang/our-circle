// Plans, as the app shows them. The server (functions/billing.js) has the same numbers and is what counts.
const DAY = 864e5, GB = 1024 ** 3;
export const TRIAL_DAYS = 30;
export const PLANS = {
  family: { name: 'Family', price: '$49/year', limit: 50 * GB, blurb: 'Everything in Our Circle for the whole family, with 50 GB for photos and videos (about 15,000 photos).' },
  plus: { name: 'Family Plus', price: '$99/year', limit: 200 * GB, blurb: 'The same, with 200 GB (about 60,000 photos, or lots of video).' },
  gift: { name: 'Gift', price: 'Free', limit: 200 * GB, blurb: 'A free plan from the Our Circle team.' },
};

// Where this circle stands: { plan, name, active, until, limit, used, daysLeft }
export function planState(c = {}, now = Date.now()) {
  const b = c.billing || {}, used = c.usage?.bytes || 0;
  if (b.plan && (b.until == null || b.until > now)) {
    return { plan: b.plan, name: PLANS[b.plan]?.name || 'Plan', active: true, until: b.until ?? null, limit: PLANS[b.plan]?.limit || PLANS.family.limit, used, status: b.status, paid: b.plan !== 'gift' };
  }
  const trialEnd = (c.createdAt || now) + TRIAL_DAYS * DAY;
  if (!b.plan && trialEnd > now) return { plan: 'trial', name: 'Free trial', active: true, until: trialEnd, limit: PLANS.family.limit, used, daysLeft: Math.ceil((trialEnd - now) / DAY) };
  return { plan: 'ended', name: b.plan ? `${PLANS[b.plan]?.name || 'Plan'} (ended)` : 'Trial ended', active: false, until: b.until ?? trialEnd, limit: PLANS[b.plan]?.limit || PLANS.family.limit, used, paid: !!b.plan };
}

export const fmtGB = (b) => (b >= GB ? (b / GB).toFixed(b >= 10 * GB ? 0 : 1) + ' GB' : Math.max(0, Math.round(b / 1024 ** 2)) + ' MB');
export const money = (cents) => '$' + (Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// isOrganizer: the person reading can fix it themselves (in Family settings).
export const pausedText = (c, isOrganizer) => (c?.paused === 'storage'
  ? `Photo and video uploads are paused because this family's storage is full. ${isOrganizer ? 'You can move to a bigger plan in Family settings.' : 'A circle owner can move to a bigger plan.'}`
  : `Photo and video uploads are paused until ${isOrganizer ? 'you choose' : 'a circle owner chooses'} a plan${isOrganizer ? ' in Family settings' : ''}. Everything else still works.`);
