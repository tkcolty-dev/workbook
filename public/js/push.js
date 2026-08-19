// Reminders: register the service worker and manage the push subscription.
import { api, toast } from './core.js';

const urlB64ToU8 = (b64) => { const pad = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export async function registerSW() { if (!('serviceWorker' in navigator)) return null; try { return await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('sw failed', e); return null; } }

export async function pushStatus() {
  if (!pushSupported()) return { supported: false, enabled: false, permission: 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, enabled: !!sub && Notification.permission === 'granted', permission: Notification.permission, endpoint: sub?.endpoint || null };
}
export async function enablePush() {
  if (!pushSupported()) { if (isIOS() && !isStandalone()) throw new Error('On iPhone/iPad: tap Share → “Add to Home Screen”, open WorkBook from the home screen, then turn reminders on.'); throw new Error('This browser does not support notifications.'); }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them in your browser settings and try again.');
  const reg = (await navigator.serviceWorker.getRegistration()) || await registerSW();
  await navigator.serviceWorker.ready;
  const { key } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) });
  await api('/push/subscribe', { body: { subscription: sub.toJSON(), tz: new Date().getTimezoneOffset() } });
  return sub;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
}
export async function testPush() { const r = await api('/push/test', { body: {} }); if (!r.sent) toast('No device is subscribed yet', 'err'); else toast('Sent! Check your notifications.', 'ok'); }
