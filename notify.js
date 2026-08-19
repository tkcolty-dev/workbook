// Reminders: Web Push (works on laptop browsers and on phones when the site is added to the home screen).
// VAPID keys are generated once and kept in the store (doc 'vapid') so they survive restarts/redeploys.
const webpush = require('web-push');
const store = require('./store');

let vapid = null;
async function init() {
  vapid = await store.getDoc('vapid');
  if (!vapid || !vapid.publicKey) { vapid = webpush.generateVAPIDKeys(); await store.setDoc('vapid', vapid); console.log('Generated new VAPID keys'); }
  webpush.setVapidDetails('mailto:tkcolty@gmail.com', vapid.publicKey, vapid.privateKey);
  setInterval(tick, 5 * 60 * 1000);
  setTimeout(tick, 15 * 1000);
}
const publicKey = () => vapid?.publicKey;

async function send(user, payload) {
  const subs = user.push || [];
  let ok = 0;
  for (const sub of subs.slice()) {
    try { await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 3600 * 12 }); ok++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { user.push = (user.push || []).filter(s => s !== sub); store.users.update(user, {}); }
      else console.error('push error', e.statusCode, e.body || e.message);
    }
  }
  return ok;
}

// local date helpers using the user's timezone offset (minutes, as reported by the browser)
function localParts(ts, tzOffsetMin) {
  const d = new Date(ts - (tzOffsetMin || 0) * 60000); // shift so UTC fields == local fields
  return { iso: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
function daysBetween(isoA, isoB) { return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000); }

// Reminder plan per event (days before → hour of day). Sent at or after that hour, once.
const DEFAULT_PLAN = { d3: { days: 3, hour: 16 }, d1: { days: 1, hour: 18 }, d0: { days: 0, hour: 7 } };

async function tick() {
  try {
    for (const user of store.users.all()) {
      if (!user.push?.length) continue;
      const prefs = user.settings?.reminders || {};
      if (prefs.enabled === false) continue;
      const tz = user.push[0].tz ?? 0;
      const now = localParts(Date.now(), tz);
      const d = store.db(user.id);
      let changed = false;
      for (const ev of d.events) {
        if (ev.done || !ev.date || ev.date < now.iso) continue;
        const isTest = ev.type === 'test' || ev.type === 'quiz';
        const diff = daysBetween(now.iso, ev.date);
        ev.notified ||= {};
        for (const [key, plan] of Object.entries(DEFAULT_PLAN)) {
          if (prefs[key] === false) continue;
          if (key !== 'd1' && key !== 'd0' && !isTest) continue; // homework/projects: day-before + day-of only
          if (diff !== plan.days || now.hour < plan.hour || ev.notified[key]) continue;
          const when = diff === 0 ? 'is TODAY' : diff === 1 ? 'is TOMORROW' : `is in ${diff} days`;
          const studyUrl = ev.studyId ? `/#/study/${ev.studyId}` : (isTest ? `/#/study?new=1&event=${ev.id}` : '/#/planner');
          const body = isTest ? (diff === 0 ? `Good luck! Quick review: open your study set.` : `Time to study — open your study sheet, flashcards or a practice test.`) : (diff === 0 ? 'Due today — is it done?' : 'Due tomorrow — finish it tonight.');
          const sent = await send(user, { title: `${isTest ? '📚' : '📝'} ${ev.title} ${when}`, body, url: studyUrl, tag: 'ev-' + ev.id + '-' + key });
          if (sent) { ev.notified[key] = Date.now(); changed = true; }
        }
      }
      if (changed) store.save(user.id);
    }
  } catch (e) { console.error('reminder tick failed', e.message); }
}

module.exports = { init, publicKey, send, tick };
