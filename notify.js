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

// ---- SMS (Twilio REST, no SDK). Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM to enable. ----
const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
async function sms(to, body) {
  if (!smsConfigured()) throw new Error('SMS not configured');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('Twilio ' + r.status + ': ' + t.slice(0, 160)); }
  return true;
}
async function notifyUser(user, payload) {
  let n = await send(user, payload);
  const smsCfg = user.settings?.sms;
  if (smsConfigured() && smsCfg?.verified && smsCfg.enabled !== false && smsCfg.phone) {
    try { await sms(smsCfg.phone, `${payload.title}\n${payload.body}${payload.url ? '\n' + (process.env.PUBLIC_URL || 'https://workbook.apps.tas-ndc.kuhn-labs.com') + payload.url : ''}`); n++; } catch (e) { console.error('sms failed', e.message); }
  }
  return n;
}

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
      const hasSms = smsConfigured() && user.settings?.sms?.verified && user.settings.sms.enabled !== false;
      if (!user.push?.length && !hasSms) continue;
      const prefs = user.settings?.reminders || {};
      if (prefs.enabled === false) continue;
      const tz = user.push?.[0]?.tz ?? user.settings?.tz ?? 0;
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
          const sent = await notifyUser(user, { title: `${isTest ? '📚' : '📝'} ${ev.title} ${when}`, body, url: studyUrl, tag: 'ev-' + ev.id + '-' + key });
          if (sent) { ev.notified[key] = Date.now(); changed = true; }
        }
      }
      if (changed) store.save(user.id);
      // weekly digest on Sunday evening
      const dow = new Date(Date.now() - tz * 60000).getUTCDay();
      const weekKey = 'w' + now.iso.slice(0, 4) + '-' + Math.floor((Date.parse(now.iso) / 86400000 + 4) / 7);
      user.digests ||= {};
      if (dow === 0 && now.hour >= 18 && !user.digests[weekKey] && prefs.weekly !== false) {
        const since = Date.now() - 7 * 86400000;
        const pages = d.pages.filter(p => p.createdAt > since).length;
        const att = []; for (const st of d.study) for (const t of st.tests || []) for (const a of t.attempts || []) if (a.at > since) att.push(a.percent);
        const avg = att.length ? Math.round(att.reduce((a, b) => a + b, 0) / att.length) : null;
        const up = d.events.filter(e => !e.done && e.date >= now.iso).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
        const body = `This week: ${pages} page${pages === 1 ? '' : 's'} scanned, ${att.length} test${att.length === 1 ? '' : 's'}${avg !== null ? ' (avg ' + avg + '%)' : ''}. ${up.length ? 'Coming up: ' + up.map(e => e.title + ' ' + e.date.slice(5)).join(', ') + '.' : 'Nothing scheduled — add your next test!'}`;
        const sent = await notifyUser(user, { title: '📊 Your WorkBook week', body, url: '/#/progress', tag: 'weekly' });
        if (sent) { user.digests[weekKey] = Date.now(); store.users.update(user, {}); }
      }
    }
  } catch (e) { console.error('reminder tick failed', e.message); }
}

module.exports = { init, publicKey, send, tick, sms, smsConfigured, notifyUser };
