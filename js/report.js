// Relatório para o veterinário (texto para WhatsApp e HTML para imprimir/PDF) e exportação CSV.
import { HOUR, DAY, fmtDateTime, fmtDate, fmtTime, fmtShort, dayStart, addDays } from './time.js';
import { thresholds, currentWeight, waterRef, waterDrunk, eatenFraction, restingSeries, mean, dayBuckets, isRest, rpmCounts } from './calc.js';
import { doseStats } from './schedule.js';
import { historyAlerts } from './alerts.js';
import { lineChart, barChart, esc } from './charts.js';

export const STATE_LABEL = { dormindo: 'dormindo', repouso: 'repouso acordada', esforco: 'após esforço' };
export const ROUTE_LABEL = { oral: 'oral', colirio: 'colírio', topica: 'tópica', injetavel: 'injetável' };
const FOOD_LABEL = { sim: 'com comida', nao: 'sem comida', indiferente: 'com ou sem comida' };
const METHOD_LABEL = { manual: 'manual', auto: 'automático', auto_corrigido: 'automático corrigido' };
const pct = (x) => `${Math.round(x * 100)}%`;
const num = (n, d = 0) => Number(n).toFixed(d).replace('.', ',');

export function buildReport(d, from, to, now) {
  const th = thresholds(d.patient);
  const kg = currentWeight(d.patient, d.weights);
  const inR = (r) => r.at >= from && r.at <= to;
  const days = Math.max(1, Math.round((to - from) / DAY));
  const calDays = Math.round((dayStart(to) - dayStart(from)) / DAY) + 1; // dias do calendário que o período toca
  const dosesTo = Math.min(to, now + 1);
  const doses = doseStats(d.meds || [], d.doseLogs || [], from, Math.max(from, dosesTo), now, th.lateMin);
  const ref = kg > 0 ? waterRef(kg, th) : null;
  const water = (d.water || []).filter(inR), food = (d.food || []).filter(inR);
  const waterDays = dayBuckets(water, waterDrunk, calDays, to);
  const foodDays = dayBuckets(food, (f) => eatenFraction(f), calDays, to).map((b, i) => ({ ...b, avg: b.count ? b.v / b.count : null }));
  const resps = (d.resps || []).filter(inR).sort((a, b) => a.at - b.at);
  const rest = restingSeries(d.resps || [], from, to);
  const rpms = rest.map((r) => Number(r.rpm));
  const signs = (d.signs || []).filter(inR).sort((a, b) => a.at - b.at);
  const elims = (d.elims || []).filter(inR), vomits = (d.vomits || []).filter(inR);
  const notes = [];
  for (const [k, list] of Object.entries({ Respiração: resps, Sinais: signs, Vômito: vomits, Eliminações: elims, Comida: food })) {
    for (const r of list) if (r.notes) notes.push({ at: r.at, src: k, text: r.notes });
  }
  for (const l of (d.doseLogs || []).filter(inR)) if (l.note) { const m = (d.meds || []).find((x) => x.id === l.medId); notes.push({ at: l.at, src: m ? m.name : 'Dose', text: l.note }); }
  notes.sort((a, b) => a.at - b.at);
  return {
    patient: d.patient || {}, th, kg, from, to, now, days, doses, ref, water, waterDays, food, foodDays,
    resps, rest, rpmStats: rpms.length ? { n: rpms.length, min: Math.min(...rpms), max: Math.max(...rpms), mean: mean(rpms), last: rest[rest.length - 1] } : null,
    signs, elims, vomits, notes, alerts: historyAlerts(d, from, to), photos: (d.photos || []).filter(inR),
    meds: d.meds || [], weights: (d.weights || []).filter(inR),
  };
}

export const periodLabel = (m) => `${fmtDateTime(m.from)} a ${fmtDateTime(m.to)} (${m.days === 1 ? '24 h' : m.days + ' dias'})`;

function respLine(r) {
  const flags = [r.effort && 'esforço abdominal', r.mouthOpen && 'boca aberta', r.noisy && 'barulho/chiado', r.cough && 'tosse', r.gumAbnormal && 'gengiva alterada', ...(r.soundTypes || [])].filter(Boolean);
  return `${fmtDateTime(r.at)}: ${r.rpm ?? '—'} rpm, ${STATE_LABEL[r.state] || r.state} (${METHOD_LABEL[r.method] || r.method}${r.confidence ? `, confiança ${r.confidence}` : ''})${flags.length ? ' – ' + flags.join(', ') : ''}`;
}

export function reportText(m) {
  const p = m.patient, L = [];
  L.push(`*Diário de Recuperação – ${p.name || 'paciente'}*`);
  L.push(`Período: ${periodLabel(m)}`);
  L.push(`Peso: ${m.kg ? num(m.kg, 1) + ' kg' : '—'}${p.accidentDate ? ` · Acidente: ${fmtDate(p.accidentDate)}` : ''}`);
  if (p.injuries) L.push(`Lesões informadas: ${p.injuries}`);
  L.push('');
  L.push('*💊 Medicamentos* (doses como prescritas)');
  if (!m.doses.length) L.push('• nenhuma dose programada no período');
  for (const c of m.doses) {
    L.push(`• ${c.med.name}${c.med.strength ? ' ' + c.med.strength : ''} – ${c.med.dose}, ${ROUTE_LABEL[c.med.route] || c.med.route}, a cada ${c.med.intervalH} h`);
    L.push(`   programadas ${c.scheduled}: dadas ${c.given}${c.givenLate ? ` (${c.givenLate} com atraso)` : ''}, puladas ${c.skipped}, vomitou após ${c.vomited}, sem registro ${c.missed}${c.upcoming ? `, a vencer ${c.upcoming}` : ''}`);
  }
  L.push('');
  L.push('*💧 Água* (mL ingeridos por dia' + (m.ref ? `; referência geral ${Math.round(m.ref.min)}–${Math.round(m.ref.max)} mL/dia` : '') + ')');
  L.push(m.waterDays.map((b) => `${b.label}: ${b.count ? Math.round(b.v) : '—'}`).join(' | '));
  L.push('');
  L.push('*🍽️ Comida* (refeições / % média comida)');
  L.push(m.foodDays.map((b) => `${b.label}: ${b.count ? `${b.count} / ${pct(b.avg)}` : '—'}`).join(' | '));
  const vom = m.vomits;
  if (vom.length) L.push(`Vômito/regurgitação: ${vom.length}${vom.some((v) => v.blood) ? ' (COM SANGUE)' : ''} – ${vom.map((v) => `${fmtDateTime(v.at)} ${v.kind === 'vomito' ? 'vômito' : 'regurgitação'}${v.aspect ? ' ' + v.aspect : ''}`).join('; ')}`);
  L.push('');
  L.push('*🫁 Respiração em repouso*');
  if (m.rpmStats) L.push(`${m.rpmStats.n} medidas · mín ${m.rpmStats.min} · máx ${m.rpmStats.max} · média ${num(m.rpmStats.mean, 1)} rpm`);
  else L.push('sem medidas em repouso no período');
  for (const r of m.resps.slice(-8)) L.push('• ' + respLine(r));
  L.push('');
  const u = m.elims.filter((e) => e.kind === 'urina' && e.amount !== 'nada').length, c = m.elims.filter((e) => e.kind === 'coco').length;
  L.push(`*🚽 Eliminações:* xixi ${u}x · cocô ${c}x${m.elims.some((e) => e.blood) ? ' (sangue registrado)' : ''}`);
  const lastSign = m.signs[m.signs.length - 1];
  if (lastSign) L.push(`*🩺 Últimos sinais (${fmtDateTime(lastSign.at)}):* ${signSummary(lastSign)}`);
  if (m.alerts.length) {
    L.push('');
    L.push('*⚠️ Alertas no período*');
    for (const a of m.alerts) L.push(`${a.level === 'red' ? '🔴' : '🟡'} ${fmtDateTime(a.at)} ${a.title}`);
  }
  if (m.notes.length) {
    L.push('');
    L.push('*📝 Observações*');
    for (const n of m.notes) L.push(`• ${fmtDateTime(n.at)} (${n.src}): ${n.text}`);
  }
  L.push('');
  L.push('_Registro feito pela tutora no app Diário de Recuperação. Não substitui avaliação veterinária._');
  return L.join('\n');
}

export function signSummary(s) {
  const GUM = { rosa: 'rosa', palida: 'pálida', branca: 'branca', azulada: 'azulada', amarelada: 'amarelada' };
  const BELLY = { normal: 'normal', inchada: 'inchada', dura: 'dura', inchada_dura: 'inchada e dura' };
  return [s.gum && `gengiva ${GUM[s.gum]}`, s.crt != null && s.crt !== '' && `TPC ${s.crt} s`, s.pain != null && s.pain !== '' && `dor ${s.pain}/4`,
    s.belly && `barriga ${BELLY[s.belly]}`, s.temp != null && s.temp !== '' && `${num(s.temp, 1)} °C`,
    (s.woundDischarge || s.woundSmell || s.woundSwelling) && `ferida: ${[s.woundDischarge && 'secreção', s.woundSmell && 'cheiro', s.woundSwelling && 'inchaço'].filter(Boolean).join(', ')}`,
    s.seizure && 'CONVULSÃO', s.collapse && 'DESMAIO/FRAQUEZA'].filter(Boolean).join(', ') || '—';
}

/** HTML do relatório (para a tela e para imprimir). photoUrls: {photoId: dataUrl} */
export function reportHtml(m, photoUrls = {}) {
  const p = m.patient;
  const rows = (arr) => arr.join('');
  const respPts = m.rest.map((r) => ({ t: r.at, v: Number(r.rpm), kind: r.method === 'auto' ? 'auto' : '' }));
  const maxY = Math.max(60, ...respPts.map((q) => q.v + 5));
  let h = `<article class="report">
  <h2>Diário de Recuperação — ${esc(p.name || 'paciente')}</h2>
  <p class="muted">Período: ${esc(periodLabel(m))}<br>Peso: ${m.kg ? num(m.kg, 1) + ' kg' : '—'}${p.accidentDate ? ` · Acidente: ${fmtDate(p.accidentDate)}` : ''}</p>
  ${p.injuries ? `<p><b>Lesões informadas pelo veterinário:</b> ${esc(p.injuries)}</p>` : ''}
  <h3>Medicamentos <small>(doses como prescritas)</small></h3>
  <table><thead><tr><th>Medicamento</th><th>Prescrição</th><th>Prog.</th><th>Dadas</th><th>Atras.</th><th>Puladas</th><th>Vomitou</th><th>S/ reg.</th></tr></thead><tbody>
  ${rows(m.doses.map((c) => `<tr><td>${esc(c.med.name)}<br><small>${esc(c.med.strength || '')}</small></td><td>${esc(c.med.dose)}<br><small>${esc(ROUTE_LABEL[c.med.route] || '')}, a cada ${c.med.intervalH} h, ${esc(FOOD_LABEL[c.med.food] || '')}</small></td><td>${c.scheduled}</td><td>${c.given}</td><td>${c.givenLate}</td><td>${c.skipped}</td><td>${c.vomited}</td><td>${c.missed}</td></tr>`)) || '<tr><td colspan="8">Nenhuma dose no período.</td></tr>'}
  </tbody></table>
  <h3>Água <small>(mL ingeridos por dia${m.ref ? `; referência geral ${Math.round(m.ref.min)}–${Math.round(m.ref.max)} mL, editável pelo veterinário` : ''})</small></h3>
  ${barChart({ bars: m.waterDays.map((b) => ({ label: b.label, v: b.v })), ref: m.ref })}
  <h3>Comida <small>(refeições e % média ingerida)</small></h3>
  <table><thead><tr><th>Dia</th>${m.foodDays.map((b) => `<th>${b.label}</th>`).join('')}</tr></thead><tbody>
  <tr><td>Refeições</td>${m.foodDays.map((b) => `<td>${b.count || '—'}</td>`).join('')}</tr>
  <tr><td>% ingerido</td>${m.foodDays.map((b) => `<td>${b.count ? pct(b.avg) : '—'}</td>`).join('')}</tr></tbody></table>
  <h3>Respiração em repouso <small>(rpm; só dormindo/repouso acordada)</small></h3>
  ${m.rpmStats ? `<p>${m.rpmStats.n} medidas · mín ${m.rpmStats.min} · máx ${m.rpmStats.max} · média ${num(m.rpmStats.mean, 1)} rpm</p>` : ''}
  ${lineChart({ points: respPts, from: m.from, to: m.to, yMin: 0, yMax: Math.ceil(maxY / 20) * 20, lines: [{ v: m.th.rrYellow, cls: 'yellow', label: m.th.rrYellow }, { v: m.th.rrRed, cls: 'red', label: m.th.rrRed }], unit: 'rpm' })}
  <ul class="plain">${rows(m.resps.map((r) => `<li>${esc(respLine(r))}${r.notes ? ` — <i>${esc(r.notes)}</i>` : ''}</li>`))}</ul>
  <h3>Eventos</h3>
  <ul class="plain">
   <li>Xixi: ${m.elims.filter((e) => e.kind === 'urina' && e.amount !== 'nada').length}x · Cocô: ${m.elims.filter((e) => e.kind === 'coco').length}x${m.elims.some((e) => e.blood) ? ' · <b>sangue registrado</b>' : ''}</li>
   <li>Vômito/regurgitação: ${m.vomits.length}x${m.vomits.some((v) => v.blood) ? ' · <b>com sangue</b>' : ''}</li>
   ${rows(m.signs.map((s) => `<li>${fmtDateTime(s.at)}: ${esc(signSummary(s))}</li>`))}
  </ul>
  <h3>Alertas no período</h3>
  <ul class="plain">${rows(m.alerts.map((a) => `<li class="al-${a.level}">${a.level === 'red' ? '🔴' : '🟡'} ${fmtDateTime(a.at)} — ${esc(a.title)}</li>`)) || '<li>Nenhum alerta.</li>'}</ul>
  ${m.notes.length ? `<h3>Observações</h3><ul class="plain">${rows(m.notes.map((n) => `<li>${fmtDateTime(n.at)} (${esc(n.src)}): ${esc(n.text)}</li>`))}</ul>` : ''}
  ${m.photos.length ? `<h3>Fotos</h3><div class="photos">${rows(m.photos.map((ph) => photoUrls[ph.id] ? `<figure><img src="${photoUrls[ph.id]}" alt=""><figcaption>${fmtDateTime(ph.at)} ${esc(ph.note || '')}</figcaption></figure>` : ''))}</div>` : ''}
  <p class="muted small">Registro feito pela tutora no app Diário de Recuperação. Não substitui avaliação veterinária.</p>
  </article>`;
  return h;
}

// ---- CSV (separador ; e BOM, abre direto no Excel em português) ----
export function toCsv(d) {
  const meds = Object.fromEntries((d.meds || []).map((m) => [m.id, m]));
  const rows = [['tipo', 'data_hora', 'detalhe', 'valor', 'unidade']];
  const add = (tipo, at, detalhe, valor = '', unidade = '') => rows.push([tipo, fmtDateTime(at) + ' ' + new Date(at).toISOString(), detalhe, valor, unidade]);
  for (const l of d.doseLogs || []) add('dose', l.at, `${meds[l.medId]?.name || '?'} | ${l.status}${l.scheduledAt ? ' | prog. ' + fmtDateTime(l.scheduledAt) : ' | extra'} | ${l.by || ''} | ${l.note || ''}`);
  for (const w of d.water || []) add('agua', w.at, `oferecido ${w.offeredMl}, sobrou ${w.leftMl}`, waterDrunk(w), 'mL');
  for (const f of d.food || []) add('comida', f.at, `${f.type || ''} | ${f.portion || ''} | oferecido ${f.offeredG ?? ''} g, sobrou ${f.leftG ?? ''} g`, eatenFraction(f) == null ? '' : Math.round(eatenFraction(f) * 100), '%');
  for (const v of d.vomits || []) add('vomito', v.at, `${v.kind} | ${v.aspect || ''} | sangue: ${v.blood ? 'sim' : 'não'} | ${v.notes || ''}`);
  for (const e of d.elims || []) add('eliminacao', e.at, `${e.kind} | ${e.amount || ''} | ${e.color || e.consistency || ''} | sangue: ${e.blood ? 'sim' : 'não'}`);
  for (const r of d.resps || []) add('respiracao', r.at, `${r.state} | ${r.method} | confiança ${r.confidence || ''} | esforço ${r.effort ? 'sim' : 'não'}, boca aberta ${r.mouthOpen ? 'sim' : 'não'}, barulho ${r.noisy ? 'sim' : 'não'}, tosse ${r.cough ? 'sim' : 'não'} | ${(r.soundTypes || []).join('/')} | ${r.notes || ''}`, r.rpm, 'rpm');
  for (const s of d.signs || []) add('sinais', s.at, signSummary(s) + (s.notes ? ' | ' + s.notes : ''), s.temp ?? '', s.temp ? '°C' : '');
  for (const w of d.weights || []) add('peso', w.at, '', w.kg, 'kg');
  rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => a[1].slice(-24) < b[1].slice(-24) ? -1 : 1).map((r) => [r[0], r[1].slice(0, -25), r[2], r[3], r[4]]));
  const q = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}
