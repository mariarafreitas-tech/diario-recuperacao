// Regras de alerta. Nunca sugerem tratamento: só orientam a procurar/avisar o veterinário.
import { HOUR, MIN, fmtTime } from './time.js';
import { thresholds, within, mean, isRest, rpmCounts, waterStatus, eatenFraction, currentWeight } from './calc.js';
import { slotsBetween, slotStatus, treatmentState, stockInfo } from './schedule.js';

const VET = 'Converse com o veterinário.';
const EMERG = 'Procure atendimento de emergência agora.';
export const RED_GUMS = ['palida', 'branca', 'azulada'];

const mk = (code, level, title, text, at, ref, extra = {}) => ({ id: `${code}:${ref}`, code, level, title, text, at, ...extra });
const byAtDesc = (a, b) => b.at - a.at;

function gumAbnormalNear(signs, at) {
  const s = (signs || []).filter((x) => x.gum && x.at <= at + 10 * MIN && at - x.at <= 2 * HOUR).sort(byAtDesc)[0];
  return !!s && RED_GUMS.includes(s.gum);
}

export const RESP_CHECKLIST_CODES = new Set(['resp_effort', 'resp_mouth', 'resp_gum', 'resp_noisy']);

/** Alertas de UMA medida respiratória (usa só medidas confirmadas). prior = todas as medidas. */
export function respAlertsFor(rec, prior, th, signs = []) {
  const out = [];
  const rest = isRest(rec.state);
  const ok = rpmCounts(rec);
  const gumAb = !!rec.gumAbnormal || gumAbnormalNear(signs, rec.at);
  const noisy = !!rec.noisy || (rec.soundTypes || []).length > 0;
  let rpmRed = false;
  if (rest && ok) {
    const rpm = Number(rec.rpm);
    if (rpm > th.rrRed) {
      rpmRed = true;
      out.push(mk('resp_rpm_red', 'red', `Respiração muito acelerada em repouso: ${rpm} rpm`, `Acima de ${th.rrRed} rpm. ${EMERG}`, rec.at, rec.id));
    } else {
      if (rpm > th.rrYellow) out.push(mk('resp_rpm_yellow', 'yellow', `Respiração acelerada em repouso: ${rpm} rpm`, `Acima de ${th.rrYellow} rpm. ${VET}`, rec.at, rec.id));
      const base = prior.filter((p) => p.id !== rec.id && isRest(p.state) && rpmCounts(p) && p.at < rec.at && rec.at - p.at <= 24 * HOUR).map((p) => Number(p.rpm));
      if (base.length >= 2) {
        const m = mean(base);
        if (rpm >= m * (1 + th.rrRisePct / 100) && rpm > m + 1) {
          out.push(mk('resp_rise', 'yellow', `Respiração ${Math.round(((rpm / m) - 1) * 100)}% acima da média de 24h`, `${rpm} rpm contra média de ${m.toFixed(0)} rpm. ${VET}`, rec.at, rec.id));
        }
      }
    }
  }
  if (rec.effort) out.push(mk('resp_effort', 'red', 'Respiração com esforço abdominal', EMERG, rec.at, rec.id));
  if (rec.mouthOpen && rest) out.push(mk('resp_mouth', 'red', 'Boca aberta em repouso', EMERG, rec.at, rec.id));
  if (rec.gumAbnormal) out.push(mk('resp_gum', 'red', 'Gengiva pálida/branca/azulada', EMERG, rec.at, rec.id));
  if (noisy) {
    const red = rec.effort || gumAb || rpmRed;
    out.push(mk('resp_noisy', red ? 'red' : 'yellow', 'Respiração barulhenta após trauma',
      red ? `Barulho ao respirar junto de outro sinal de gravidade. ${EMERG}` : `Respiração barulhenta após trauma: comunique o veterinário.`, rec.at, rec.id));
  }
  return out;
}

/** Regras dos sinais gerais: cada uma olha UM campo e decide pelo último registro que o tem. */
export const SIGN_RULES = [
  { code: 'gum', has: (r) => !!r.gum, eval: (r) => (RED_GUMS.includes(r.gum)
    ? { level: 'red', title: `Gengiva ${{ palida: 'pálida', branca: 'branca', azulada: 'azulada' }[r.gum]}`, text: EMERG }
    : r.gum === 'amarelada' ? { level: 'yellow', title: 'Gengiva amarelada', text: VET } : null) },
  { code: 'crt', has: (r) => r.crt !== undefined && r.crt !== null && r.crt !== '', eval: (r, th) => (Number(r.crt) > th.crtMaxS
    ? { level: 'yellow', title: `Preenchimento capilar lento: ${r.crt} s`, text: `Referência: até ${th.crtMaxS} s. ${VET}` } : null) },
  { code: 'belly', has: (r) => !!r.belly, eval: (r) => (r.belly !== 'normal'
    ? { level: 'red', title: `Barriga ${{ inchada: 'inchada', dura: 'dura', inchada_dura: 'inchada e dura' }[r.belly] || 'alterada'}`, text: EMERG } : null) },
  { code: 'pain', has: (r) => r.pain !== undefined && r.pain !== null && r.pain !== '', eval: (r, th) => (Number(r.pain) >= th.painYellow
    ? { level: 'yellow', title: `Dor ${r.pain}/4`, text: VET } : null) },
  { code: 'temp', has: (r) => r.temp !== undefined && r.temp !== null && r.temp !== '', eval: (r, th) => {
    const t = Number(r.temp);
    return t < th.tempMin || t > th.tempMax
      ? { level: 'yellow', title: `Temperatura ${t.toFixed(1)} °C fora de ${th.tempMin}–${th.tempMax}`, text: VET } : null;
  } },
  { code: 'wound', has: (r) => r.woundDischarge !== undefined || r.woundSmell !== undefined || r.woundSwelling !== undefined,
    eval: (r) => (r.woundDischarge || r.woundSmell || r.woundSwelling
      ? { level: 'yellow', title: 'Ferida/curativo com alteração', text: `${[r.woundDischarge && 'secreção', r.woundSmell && 'cheiro', r.woundSwelling && 'inchaço'].filter(Boolean).join(', ')}. ${VET}` } : null) },
  { code: 'seizure', event: true, has: (r) => !!r.seizure, eval: () => ({ level: 'red', title: 'Convulsão', text: EMERG }) },
  { code: 'collapse', event: true, has: (r) => !!r.collapse, eval: () => ({ level: 'red', title: 'Desmaio / fraqueza súbita', text: EMERG }) },
];

/** Alertas atuais (janela de 24h). */
export function computeAlerts(d, now) {
  const th = thresholds(d.patient);
  const out = [];
  const w24 = (list) => within(list || [], now, 24);

  // Respiração
  const respAll = [...(d.resps || [])].sort((a, b) => a.at - b.at);
  const recent = w24(respAll);
  const latest = recent[recent.length - 1];
  if (latest) respAlertsFor(latest, respAll, th, d.signs).filter((a) => RESP_CHECKLIST_CODES.has(a.code)).forEach((a) => out.push(a));
  const latestRpm = [...recent].reverse().find((r) => isRest(r.state) && rpmCounts(r));
  if (latestRpm) respAlertsFor(latestRpm, respAll, th, d.signs).filter((a) => !RESP_CHECKLIST_CODES.has(a.code)).forEach((a) => out.push(a));

  // Sinais gerais
  const signs = w24(d.signs).sort(byAtDesc);
  for (const rule of SIGN_RULES) {
    const recs = rule.event ? signs.filter(rule.has) : [signs.find(rule.has)].filter(Boolean);
    for (const r of recs) {
      const a = rule.eval(r, th);
      if (a) out.push(mk(`sign_${rule.code}`, a.level, a.title, a.text, r.at, r.id));
    }
  }

  // Xixi / cocô
  const elims = [...(d.elims || [])].sort(byAtDesc);
  const lastUrine = elims.find((e) => e.kind === 'urina' && e.amount !== 'nada');
  const anyAt = [...(d.water || []), ...(d.food || []), ...(d.elims || []), ...(d.resps || []), ...(d.signs || [])].map((r) => r.at);
  const firstAny = anyAt.length ? Math.min(...anyAt) : null;
  if (lastUrine && now - lastUrine.at > th.noUrineH * HOUR) {
    out.push(mk('nourine', 'red', `Mais de ${th.noUrineH} h sem urinar`, EMERG, lastUrine.at, lastUrine.at));
  } else if (!lastUrine && firstAny != null && now - firstAny > th.noUrineH * HOUR) {
    out.push(mk('nourine', 'red', `Nenhum xixi registrado (${th.noUrineH} h ou mais de uso)`, `Se não houve xixi, ${EMERG.toLowerCase()} Se houve, registre.`, firstAny, 'never'));
  }
  const blood = w24(elims).find((e) => e.blood);
  if (blood) out.push(mk('elim_blood', 'yellow', `Sangue no ${blood.kind === 'urina' ? 'xixi' : 'cocô'}`, VET, blood.at, blood.id));

  // Vômito
  const vomBlood = w24(d.vomits).find((v) => v.blood);
  if (vomBlood) out.push(mk('vomit_blood', 'red', 'Vômito/regurgitação com sangue', EMERG, vomBlood.at, vomBlood.id));

  // Comida
  const food = [...(d.food || [])].sort(byAtDesc);
  if (food.length) {
    const lastN = food.slice(0, th.refuseMeals);
    if (lastN.length >= th.refuseMeals && lastN.every((f) => eatenFraction(f) === 0) && now - lastN[0].at <= 24 * HOUR) {
      out.push(mk('refuse', 'yellow', `Recusou as últimas ${th.refuseMeals} refeições`, VET, lastN[0].at, lastN[0].id));
    }
    const lastEat = food.find((f) => (eatenFraction(f) || 0) > 0);
    const ref = lastEat ? lastEat.at : food[food.length - 1].at;
    if (now - ref > th.noEatH * HOUR) out.push(mk('noeat', 'yellow', `Mais de ${th.noEatH} h sem comer`, VET, ref, ref));
  }

  // Água
  const kg = currentWeight(d.patient, d.weights);
  const ws = waterStatus(d.water || [], kg, th, now);
  if (ws.status === 'low') out.push(mk('water_low', 'yellow', `Bebeu pouco: ${Math.round(ws.total)} mL em 24 h`,
    `Menos de ${th.waterLowPct}% da referência (${Math.round(ws.ref.min)}–${Math.round(ws.ref.max)} mL). Confira se todos os potes foram registrados. ${VET}`, now, Math.floor(now / (6 * HOUR))));
  if (ws.status === 'high') out.push(mk('water_high', 'yellow', `Bebeu muito: ${Math.round(ws.total)} mL em 24 h`,
    `Acima de ${th.waterHighMlKg} mL/kg/dia (sede excessiva). ${VET}`, now, Math.floor(now / (6 * HOUR))));

  // Medicamentos
  const meds = (d.meds || []);
  for (const med of meds) {
    for (const at of slotsBetween(med, now - 24 * HOUR, now + 1)) {
      const s = slotStatus(med, at, d.doseLogs || [], now, th.lateMin);
      const label = `${med.name} das ${fmtTime(at)}`;
      if (s.status === 'late') out.push(mk('dose_late', 'yellow', `Dose atrasada: ${label}`, `Passou de ${th.lateMin} min. Dê/registre se for o caso ou avise o veterinário.`, at, s.key));
      if (s.duplicate) out.push(mk('dose_dup', 'yellow', `Dose marcada 2x: ${label}`, 'Confira se não foi dada duas vezes. Não repita sem falar com o veterinário.', at, s.key));
      if (s.status === 'vomited') out.push(mk('dose_vomit', 'yellow', `Vomitou após a dose: ${label}`, 'Não repita a dose por conta própria. Converse com o veterinário.', s.log.at, s.key));
    }
    const ts = treatmentState(med, now, th.endDays);
    if (ts.state === 'ending') out.push(mk('med_ending', 'info', `Tratamento chegando ao fim: ${med.name}`, `Término em ${med.endDate.split('-').reverse().join('/')}. Pergunte ao veterinário se há reavaliação.`, now, `${med.id}:${med.endDate}`));
    if (ts.state !== 'finished' && ts.state !== 'stopped') {
      const st = stockInfo(med, d.doseLogs || [], now, th.stockDays);
      if (st && st.low) out.push(mk('med_stock', 'yellow', `Estoque acabando: ${med.name}`,
        `Restam cerca de ${st.dosesLeft} dose(s)${st.short ? ' (não chega até o fim do tratamento)' : ''}. Providencie mais.`, now, `${med.id}:${Math.floor(now / (12 * HOUR))}`));
    }
  }

  const acks = (d.settings && d.settings.acks) || {};
  const rank = { red: 0, yellow: 1, info: 2 };
  const seen = new Set();
  return out.filter((a) => (seen.has(a.id) ? false : seen.add(a.id)))
    .map((a) => ({ ...a, acked: !!acks[a.id] }))
    .sort((a, b) => rank[a.level] - rank[b.level] || b.at - a.at);
}

/** Todos os alertas "disparados" por registros dentro de [from, to], para o relatório. */
export function historyAlerts(d, from, to) {
  const th = thresholds(d.patient);
  const out = [];
  const inRange = (r) => r.at >= from && r.at <= to;
  const respAll = [...(d.resps || [])].sort((a, b) => a.at - b.at);
  for (const r of respAll.filter(inRange)) out.push(...respAlertsFor(r, respAll, th, d.signs));
  for (const r of (d.signs || []).filter(inRange)) for (const rule of SIGN_RULES) {
    if (!rule.has(r)) continue;
    const a = rule.eval(r, th);
    if (a) out.push(mk(`sign_${rule.code}`, a.level, a.title, a.text, r.at, r.id));
  }
  for (const v of (d.vomits || []).filter(inRange)) if (v.blood) out.push(mk('vomit_blood', 'red', 'Vômito/regurgitação com sangue', EMERG, v.at, v.id));
  for (const e of (d.elims || []).filter(inRange)) if (e.blood) out.push(mk('elim_blood', 'yellow', `Sangue no ${e.kind === 'urina' ? 'xixi' : 'cocô'}`, VET, e.at, e.id));
  for (const med of d.meds || []) for (const at of slotsBetween(med, from, to)) {
    if (at > to) continue;
    const s = slotStatus(med, at, d.doseLogs || [], to, th.lateMin);
    const label = `${med.name} das ${fmtTime(at)}`;
    if (s.status === 'late' || s.givenLate) out.push(mk('dose_late', 'yellow', `Dose atrasada: ${label}`, '', at, s.key));
    if (s.duplicate) out.push(mk('dose_dup', 'yellow', `Dose marcada 2x: ${label}`, '', at, s.key));
    if (s.status === 'vomited') out.push(mk('dose_vomit', 'yellow', `Vomitou após a dose: ${label}`, '', at, s.key));
  }
  return out.sort((a, b) => a.at - b.at);
}
