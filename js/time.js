// Fuso e formatação. Tudo é guardado como epoch ms; exibido em America/Sao_Paulo.
export const TZ = 'America/Sao_Paulo';
export const MIN = 60e3;
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function tzOffsetMs(ts) {
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(ts))) p[type] = value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(ts / 1000) * 1000;
}

export function localToMs(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - tzOffsetMs(guess);
  ts = guess - tzOffsetMs(ts);
  return ts;
}

export function parts(ts) {
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(ts))) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export function dayStart(ts) { const p = parts(ts); return localToMs(p.y, p.mo, p.d); }
export function addDays(dayStartMs, n) { const p = parts(dayStartMs + 12 * HOUR); return localToMs(p.y, p.mo, p.d + n); }
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(ts) { const p = parts(ts); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; }
/** Fim (exclusivo) do dia 'YYYY-MM-DD': 00:00 do dia seguinte. */
export function endOfDayMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localToMs(y, m, d + 1);
}
export function startOfDateStr(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return localToMs(y, m, d); }

const fTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fDate = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fShort = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fWeek = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
export const fmtTime = (ts) => fTime.format(ts);
export const fmtDate = (ts) => fDate.format(ts);
export const fmtShort = (ts) => fShort.format(ts);
export const fmtWeek = (ts) => fWeek.format(ts).replace('.', '');
export const fmtDateTime = (ts) => `${fShort.format(ts)} ${fTime.format(ts)}`;

/** Para <input type="datetime-local">. */
export function toInputValue(ts) {
  const p = parts(ts);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}
export function fromInputValue(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || '');
  if (!m) return NaN;
  return localToMs(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

export function fmtAgo(ts, now) {
  const diff = Math.max(0, now - ts);
  const m = Math.round(diff / MIN);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `há ${h} h ${r} min` : `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}
export function fmtIn(ts, now) {
  const m = Math.round((ts - now) / MIN);
  if (m <= 0) return 'agora';
  if (m < 60) return `em ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `em ${h} h ${r} min` : `em ${h} h`;
}
