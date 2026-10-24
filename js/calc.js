// Cálculos de água, comida e respiração.
import { HOUR, dayStart, addDays, fmtShort } from './time.js';

export const DEFAULT_THRESHOLDS = {
  rrYellow: 30,       // rpm em repouso/sono acima disto → amarelo
  rrRed: 40,          // rpm em repouso acima disto → vermelho
  rrRisePct: 20,      // aumento % vs média das últimas 24h → amarelo
  lateMin: 30,        // minutos para considerar dose atrasada
  noUrineH: 24,
  noEatH: 24,
  refuseMeals: 2,
  waterRefMin: 50,    // mL/kg/dia (referência geral, editável pelo vet)
  waterRefMax: 60,
  waterLowPct: 50,    // % do limite inferior da referência
  waterHighMlKg: 100, // mL/kg/dia: "muito acima"
  crtMaxS: 2,
  tempMin: 37.5,
  tempMax: 39.2,
  painYellow: 3,
  stockDays: 2,
  endDays: 2,
};
export const thresholds = (patient) => ({ ...DEFAULT_THRESHOLDS, ...((patient && patient.thresholds) || {}) });

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const within = (list, now, hours) => list.filter((r) => r.at <= now && now - r.at <= hours * HOUR);

export function currentWeight(patient, weights = []) {
  const last = [...weights].sort((a, b) => b.at - a.at)[0];
  return last ? Number(last.kg) : Number(patient && patient.weightKg) || 0;
}

// ---- Água ----
export const waterDrunk = (r) => {
  const o = Number(r.offeredMl) || 0, l = Number(r.leftMl) || 0;
  return Math.max(0, o - l);
};
export const waterRef = (kg, th) => ({ min: kg * th.waterRefMin, max: kg * th.waterRefMax });
export function waterTotal(water, now, hours = 24) {
  return within(water, now, hours).reduce((s, r) => s + waterDrunk(r), 0);
}
/** 'none' (sem dados suficientes) | 'low' | 'ok' | 'high' */
export function waterStatus(water, kg, th, now) {
  if (!water.length || !(kg > 0)) return { status: 'none', total: 0 };
  const total = waterTotal(water, now, 24);
  const first = Math.min(...water.map((r) => r.at));
  const full24 = now - first >= 24 * HOUR;
  const ref = waterRef(kg, th);
  let status = 'ok';
  if (!full24) status = 'partial';
  else if (total < (th.waterLowPct / 100) * ref.min) status = 'low';
  else if (total > th.waterHighMlKg * kg) status = 'high';
  return { status, total, ref, full24 };
}

// ---- Comida ----
export const PORTIONS = { tudo: 1, '3/4': 0.75, '1/2': 0.5, '1/4': 0.25, recusou: 0 };
export function eatenFraction(r) {
  if (r.portion && r.portion in PORTIONS) return PORTIONS[r.portion];
  const o = Number(r.offeredG), l = Number(r.leftG) || 0;
  if (o > 0) return Math.min(1, Math.max(0, (o - l) / o));
  return null;
}

// ---- Respiração ----
export const isRest = (state) => state === 'dormindo' || state === 'repouso';
/** Medida automática de baixa confiança, não corrigida, nunca conta (nem dispara nem descarta alerta). */
export const rpmCounts = (r) => Number.isFinite(Number(r.rpm)) && r.rpm !== null && r.rpm !== ''
  && !(r.method === 'auto' && r.confidence === 'baixa');
export const restingSeries = (resps, from = -Infinity, to = Infinity) =>
  resps.filter((r) => isRest(r.state) && rpmCounts(r) && r.at >= from && r.at <= to).sort((a, b) => a.at - b.at);

/** Soma por dia (America/Sao_Paulo) dos últimos n dias, incluindo hoje. */
export function dayBuckets(list, valueFn, n, now) {
  const today = dayStart(now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = addDays(today, -i), e = addDays(today, -i + 1);
    const items = list.filter((r) => r.at >= s && r.at < e);
    out.push({ start: s, label: fmtShort(s), count: items.length, v: items.reduce((t, r) => t + (valueFn(r) || 0), 0) });
  }
  return out;
}
