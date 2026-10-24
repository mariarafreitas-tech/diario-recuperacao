// Agenda de medicamentos. O app só registra o que o veterinário prescreveu: não calcula doses.
import { endOfDayMs, dayStart, addDays, MIN, HOUR } from './time.js';

export const slotKey = (medId, at) => `${medId}|${at}`;

/** Fim (exclusivo) do tratamento, considerando data de término e suspensão. */
export function treatmentEnd(med) {
  const a = med.endDate ? endOfDayMs(med.endDate) : Infinity;
  const b = med.stoppedAt != null ? med.stoppedAt : Infinity;
  return Math.min(a, b);
}

/** Horários programados no intervalo [from, to). Âncora fixa na 1ª dose: atravessa a meia-noite sem problema. */
export function slotsBetween(med, from, to) {
  const step = Number(med.intervalH) * HOUR;
  if (!(step > 0) || !Number.isFinite(med.firstDoseAt)) return [];
  const end = Math.min(to, treatmentEnd(med));
  const out = [];
  for (let k = Math.max(0, Math.ceil((from - med.firstDoseAt) / step)); ; k++) {
    const t = med.firstDoseAt + k * step;
    if (t >= end) break;
    out.push(t);
  }
  return out;
}

export function logsForSlot(logs, medId, at) {
  return logs.filter((l) => l.medId === medId && l.scheduledAt === at).sort((a, b) => a.at - b.at);
}

/**
 * status: 'pending' | 'given' | 'late' | 'skipped' | 'vomited'
 * Vale o último registro da dose. 'duplicate' = 2+ registros "dada" no mesmo horário.
 */
export function slotStatus(med, at, logs, now, lateMin = 30) {
  const ls = logsForSlot(logs, med.id, at);
  const last = ls[ls.length - 1] || null;
  const givenCount = ls.filter((l) => l.status === 'given').length;
  let status;
  if (!last) status = now - at > lateMin * MIN ? 'late' : 'pending';
  else status = last.status === 'given' ? 'given' : last.status === 'vomited' ? 'vomited' : 'skipped';
  const administered = last && (last.status === 'given' || last.status === 'vomited');
  return {
    med, at, key: slotKey(med.id, at), status, log: last, logs: ls,
    due: now >= at,
    duplicate: givenCount >= 2,
    givenLate: !!(administered && last.at - at > lateMin * MIN),
  };
}

export function agenda(meds, logs, dayStartMs, now, lateMin = 30) {
  const next = addDays(dayStartMs, 1);
  const items = [];
  for (const med of meds) for (const at of slotsBetween(med, dayStartMs, next)) items.push(slotStatus(med, at, logs, now, lateMin));
  return items.sort((a, b) => a.at - b.at || a.med.name.localeCompare(b.med.name));
}

export function unresolved(meds, logs, from, to, now, lateMin = 30) {
  const out = [];
  for (const med of meds) for (const at of slotsBetween(med, from, to)) {
    const s = slotStatus(med, at, logs, now, lateMin);
    if (s.status === 'pending' || s.status === 'late') out.push(s);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** { late: doses atrasadas (últimas 12h), next: próxima dose pendente } */
export function nextDose(meds, logs, now, lateMin = 30) {
  const list = unresolved(meds, logs, now - 12 * HOUR, now + 48 * HOUR, now, lateMin);
  return { late: list.filter((s) => s.status === 'late'), next: list.find((s) => s.status === 'pending') || null };
}

export function treatmentState(med, now, endDays = 2) {
  const end = treatmentEnd(med);
  if (med.active === false) return { state: 'stopped' };
  if (!Number.isFinite(end)) return { state: 'ongoing' };
  if (end <= now) return { state: 'finished' };
  const left = end - now;
  return { state: left <= endDays * 24 * HOUR ? 'ending' : 'ongoing', msLeft: left };
}

/** Estoque restante = quantidade informada − unidades por dose × doses dadas desde stockAt. */
export function stockInfo(med, logs, now, stockDays = 2) {
  if (med.stockQty == null || med.stockQty === '') return null;
  const per = Number(med.unitsPerDose);
  const used = per > 0
    ? logs.filter((l) => l.medId === med.id && (l.status === 'given' || l.status === 'vomited') && l.at >= (med.stockAt || 0)).length * per
    : 0;
  const remaining = Math.max(0, Number(med.stockQty) - used);
  if (!(per > 0)) return { remaining, dosesLeft: null, low: false, short: false };
  const dosesLeft = Math.floor(remaining / per + 1e-9);
  const stepH = Number(med.intervalH) || 24;
  const end = treatmentEnd(med);
  const needed = Number.isFinite(end) ? slotsBetween(med, now, end).length : null;
  const low = dosesLeft <= Math.ceil((stockDays * 24) / stepH);
  const short = needed != null && dosesLeft < needed;
  return { remaining, dosesLeft, needed, low: low && (needed == null || needed > 0), short: short && low };
}

/** Resumo por medicamento no período, para o relatório. */
export function doseStats(meds, logs, from, to, now, lateMin = 30) {
  return meds.map((med) => {
    const c = { med, scheduled: 0, given: 0, givenLate: 0, skipped: 0, vomited: 0, missed: 0, upcoming: 0 };
    for (const at of slotsBetween(med, from, to)) {
      const s = slotStatus(med, at, logs, now, lateMin);
      c.scheduled++;
      if (s.status === 'given') c.given++;
      else if (s.status === 'vomited') c.vomited++;
      else if (s.status === 'skipped') c.skipped++;
      else if (s.status === 'late') c.missed++;
      else c.upcoming++;
      if (s.givenLate) c.givenLate++;
    }
    return c;
  }).filter((c) => c.scheduled > 0);
}
