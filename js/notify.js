// Avisos de horário de remédio. Só funcionam com o app aberto/em segundo plano (limite dos navegadores).
import { S, saveSettings, nowMs } from './state.js';
import { unresolved } from './schedule.js';
import { thresholds } from './calc.js';
import { fmtTime, MIN, HOUR } from './time.js';

export function permission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // default | granted | denied
}
export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
async function show(title, body, tag) {
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) return reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', requireInteraction: true, vibrate: [200, 100, 200] });
    new Notification(title, { body, tag });
  } catch { /* ignora */ }
}

export async function checkDue() {
  if (!S.D || permission() !== 'granted' || !S.D.settings.notify) return;
  const now = nowMs(), th = thresholds(S.D.patient), notified = { ...(S.D.settings.notified || {}) };
  let changed = false;
  for (const s of unresolved(S.D.meds.filter((m) => m.active !== false), S.D.doseLogs, now - 3 * HOUR, now + MIN, now, th.lateMin)) {
    const k = s.key + (s.status === 'late' ? ':late' : '');
    if (notified[k]) continue;
    if (s.status === 'late' && notified[s.key] === undefined) { /* só avisa atraso se o aviso da hora também saiu ou passou */ }
    notified[k] = now; changed = true;
    await show(s.status === 'late' ? `⏰ Dose atrasada: ${s.med.name}` : `💊 Hora do remédio: ${s.med.name}`, `${fmtTime(s.at)} · ${s.med.dose}`, k);
  }
  if (changed) {
    for (const k of Object.keys(notified)) if (now - notified[k] > 3 * 24 * HOUR) delete notified[k];
    await saveSettings({ notified });
  }
}
