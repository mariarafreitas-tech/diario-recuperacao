import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAlerts, respAlertsFor, historyAlerts } from '../js/alerts.js';
import { thresholds, waterStatus, eatenFraction, restingSeries } from '../js/calc.js';

const T = (s) => new Date(s + '-03:00').getTime();
const NOW = T('2026-10-22T12:00:00');
const H = 3600e3, MIN = 60e3;
const patient = { weightKg: 20 };
const base = (o = {}) => ({ patient, meds: [], doseLogs: [], water: [], food: [], vomits: [], elims: [], resps: [], signs: [], weights: [], settings: {}, ...o });
const R = (id, minsAgo, rpm, o = {}) => ({ id, at: NOW - minsAgo * MIN, rpm, state: 'repouso', method: 'manual', ...o });
const PEE = [{ id: 'u', at: NOW - 2 * H, kind: 'urina', amount: 'medio' }];
const codes = (a) => a.map((x) => `${x.level}:${x.code}`);

test('respiração: 28 rpm em repouso = sem alerta; 31 = amarelo; 41 = vermelho', () => {
  assert.deepEqual(computeAlerts(base({ resps: [R('a', 5, 28)] }), NOW), []);
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 31)] }), NOW)), ['yellow:resp_rpm_yellow']);
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 41)] }), NOW)), ['red:resp_rpm_red']);
});

test('limites exatos (30 e 40) não disparam: é "maior que"', () => {
  assert.deepEqual(computeAlerts(base({ resps: [R('a', 5, 30)] }), NOW), []);
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 40)] }), NOW)), ['yellow:resp_rpm_yellow']);
});

test('após esforço não gera alerta de frequência nem de boca aberta', () => {
  assert.deepEqual(computeAlerts(base({ resps: [R('a', 5, 60, { state: 'esforco', mouthOpen: true })] }), NOW), []);
});

test('aumento de 20% sobre a média das últimas 24h (amarelo), mesmo abaixo de 30 rpm', () => {
  const resps = [R('a', 600, 16), R('b', 400, 18), R('c', 200, 17), R('d', 5, 21)];
  const a = computeAlerts(base({ resps }), NOW);
  assert.deepEqual(codes(a), ['yellow:resp_rise']);
  assert.deepEqual(computeAlerts(base({ resps: [...resps.slice(0, 3), R('d', 5, 19)] }), NOW), []);
});

test('sinais de gravidade: esforço, boca aberta em repouso e gengiva = vermelho', () => {
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 20, { effort: true })] }), NOW)), ['red:resp_effort']);
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 20, { mouthOpen: true })] }), NOW)), ['red:resp_mouth']);
  assert.deepEqual(codes(computeAlerts(base({ signs: [{ id: 's', at: NOW - 10 * MIN, gum: 'azulada' }] }), NOW)), ['red:sign_gum']);
  assert.deepEqual(codes(computeAlerts(base({ signs: [{ id: 's', at: NOW - 10 * MIN, gum: 'rosa' }] }), NOW)), []);
});

test('respiração ruidosa: amarelo; com esforço, gengiva alterada ou rpm > 40: vermelho', () => {
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 22, { noisy: true })] }), NOW)), ['yellow:resp_noisy']);
  assert.match(computeAlerts(base({ resps: [R('a', 5, 22, { noisy: true })] }), NOW)[0].text, /comunique o veterinário/);
  assert.ok(codes(computeAlerts(base({ resps: [R('a', 5, 22, { soundTypes: ['chiado'], effort: true })] }), NOW)).includes('red:resp_noisy'));
  assert.ok(codes(computeAlerts(base({ resps: [R('a', 5, 45, { noisy: true })] }), NOW)).includes('red:resp_noisy'));
  const withGum = base({ resps: [R('a', 5, 22, { noisy: true })], signs: [{ id: 's', at: NOW - 30 * MIN, gum: 'palida' }] });
  assert.ok(codes(computeAlerts(withGum, NOW)).includes('red:resp_noisy'));
});

test('medida automática de baixa confiança nunca dispara alerta de frequência', () => {
  const low = R('a', 5, 55, { method: 'auto', confidence: 'baixa' });
  assert.deepEqual(computeAlerts(base({ resps: [low] }), NOW), []);
  // ...e também não "limpa" um alerta anterior:
  const prev = R('p', 60, 45);
  assert.deepEqual(codes(computeAlerts(base({ resps: [prev, low] }), NOW)), ['red:resp_rpm_red']);
  // corrigida pela tutora (conta como confirmada)
  assert.deepEqual(codes(computeAlerts(base({ resps: [R('a', 5, 55, { method: 'auto_corrigido', confidence: 'baixa' })] }), NOW)), ['red:resp_rpm_red']);
  assert.equal(restingSeries([low]).length, 0);
});

test('medida normal mais recente substitui alerta de frequência anterior', () => {
  assert.deepEqual(computeAlerts(base({ resps: [R('p', 60, 45), R('n', 5, 24)] }), NOW), []);
});

test('limites editáveis pelo veterinário', () => {
  const p = { ...patient, thresholds: { rrYellow: 35, rrRed: 50 } };
  assert.deepEqual(computeAlerts(base({ patient: p, resps: [R('a', 5, 33)] }), NOW), []);
  assert.deepEqual(codes(computeAlerts(base({ patient: p, resps: [R('a', 5, 42)] }), NOW)), ['yellow:resp_rpm_yellow']);
  assert.equal(thresholds(p).rrRed, 50);
});

test('banner: alerta confirmado ("visto") continua na lista mas marcado como acked', () => {
  const a = computeAlerts(base({ resps: [R('a', 5, 45)], settings: { acks: { 'resp_rpm_red:a': NOW } } }), NOW);
  assert.equal(a[0].acked, true);
});

test('xixi: mais de 24h sem urinar = vermelho; xixi recente não alerta; "tentou e nada" não conta', () => {
  const e = (id, h, o = {}) => ({ id, at: NOW - h * H, kind: 'urina', amount: 'medio', ...o });
  assert.deepEqual(codes(computeAlerts(base({ elims: [e('a', 25)] }), NOW)), ['red:nourine']);
  assert.deepEqual(computeAlerts(base({ elims: [e('a', 5)] }), NOW), []);
  assert.deepEqual(codes(computeAlerts(base({ elims: [e('a', 30), e('b', 2, { amount: 'nada' })] }), NOW)), ['red:nourine']);
  assert.deepEqual(codes(computeAlerts(base({ water: [{ id: 'w', at: NOW - 30 * H, offeredMl: 100, leftMl: 50 }] }), NOW)).filter((c) => c.endsWith('nourine')), ['red:nourine']);
});

test('vômito com sangue, barriga inchada, convulsão e desmaio = vermelho', () => {
  assert.deepEqual(codes(computeAlerts(base({ vomits: [{ id: 'v', at: NOW - 60 * MIN, kind: 'vomito', blood: true }] }), NOW)), ['red:vomit_blood']);
  assert.deepEqual(codes(computeAlerts(base({ signs: [{ id: 's', at: NOW - 60 * MIN, belly: 'inchada' }] }), NOW)), ['red:sign_belly']);
  assert.deepEqual(codes(computeAlerts(base({ signs: [{ id: 's', at: NOW - 60 * MIN, seizure: true, collapse: true }] }), NOW)).sort(), ['red:sign_collapse', 'red:sign_seizure']);
  // barriga normal mais recente substitui
  assert.deepEqual(computeAlerts(base({ signs: [{ id: 's1', at: NOW - 120 * MIN, belly: 'dura' }, { id: 's2', at: NOW - 30 * MIN, belly: 'normal' }] }), NOW), []);
});

test('comida: 2 recusas seguidas e >24h sem comer = amarelo', () => {
  const f = (id, h, portion) => ({ id, at: NOW - h * H, portion });
  assert.deepEqual(codes(computeAlerts(base({ elims: PEE, food: [f('a', 10, 'tudo'), f('b', 6, 'recusou'), f('c', 1, 'recusou')] }), NOW)), ['yellow:refuse']);
  assert.deepEqual(computeAlerts(base({ elims: PEE, food: [f('a', 6, 'recusou'), f('b', 1, 'tudo')] }), NOW), []);
  assert.deepEqual(codes(computeAlerts(base({ elims: PEE, food: [f('a', 26, 'tudo')] }), NOW)), ['yellow:noeat']);
  assert.equal(eatenFraction({ offeredG: 200, leftG: 50 }), 0.75);
  assert.equal(eatenFraction({ portion: '1/2' }), 0.5);
});

test('água: referência 50–60 mL/kg (20 kg = 1000–1200 mL); <50% da ref. = amarelo; muito acima = amarelo', () => {
  const day = (total) => [{ id: 'w0', at: NOW - 30 * H, offeredMl: 10, leftMl: 10 }, { id: 'w1', at: NOW - 3 * H, offeredMl: total, leftMl: 0 }];
  const th = thresholds(patient);
  assert.equal(waterStatus(day(1100), 20, th, NOW).status, 'ok');
  assert.equal(waterStatus(day(400), 20, th, NOW).status, 'low');
  assert.equal(waterStatus(day(2500), 20, th, NOW).status, 'high');
  assert.deepEqual(codes(computeAlerts(base({ elims: PEE, water: day(400) }), NOW)), ['yellow:water_low']);
  assert.match(computeAlerts(base({ elims: PEE, water: day(400) }), NOW)[0].text, /veterinário/);
  assert.deepEqual(codes(computeAlerts(base({ elims: PEE, water: day(2500) }), NOW)), ['yellow:water_high']);
  assert.deepEqual(computeAlerts(base({ elims: PEE, water: day(1100) }), NOW), []);
});

test('água: sem 24h de registros não alerta (dados parciais)', () => {
  assert.equal(waterStatus([{ id: 'w', at: NOW - 3 * H, offeredMl: 100, leftMl: 0 }], 20, thresholds(patient), NOW).status, 'partial');
});

test('medicamentos: atrasada >30 min, duplicada, vomitou, fim de tratamento, estoque', () => {
  const m = { id: 'm1', name: 'Remédio A', intervalH: 8, firstDoseAt: T('2026-10-20T06:00:00'), endDate: '2026-10-23', stockQty: 3, unitsPerDose: 1, stockAt: 0 };
  const at14 = T('2026-10-22T14:00:00'), at06 = T('2026-10-22T06:00:00'), at22 = T('2026-10-21T22:00:00');
  const now = T('2026-10-22T14:40:00');
  const logs = [
    { id: '1', medId: 'm1', scheduledAt: at06, at: at06 + MIN, status: 'given' },
    { id: '2', medId: 'm1', scheduledAt: at06, at: at06 + 2 * MIN, status: 'given' },
    { id: '3', medId: 'm1', scheduledAt: at22, at: at22 + MIN, status: 'vomited' },
  ];
  const c = codes(computeAlerts(base({ meds: [m], doseLogs: logs }), now));
  assert.ok(c.includes('yellow:dose_late'));
  assert.ok(c.includes('yellow:dose_dup'));
  assert.ok(c.includes('yellow:dose_vomit'));
  assert.ok(c.includes('info:med_ending'));
  assert.ok(c.includes('yellow:med_stock'));
  assert.match(computeAlerts(base({ meds: [m], doseLogs: logs }), now).find((a) => a.code === 'dose_vomit').text, /Não repita/);
  // dentro dos 30 min não é atraso
  assert.ok(!codes(computeAlerts(base({ meds: [m], doseLogs: logs }), at14 + 20 * MIN)).includes('yellow:dose_late'));
});

test('ordenação: vermelho antes de amarelo', () => {
  const a = computeAlerts(base({ resps: [R('a', 5, 31)], signs: [{ id: 's', at: NOW - 60 * MIN, gum: 'branca' }] }), NOW);
  assert.deepEqual(a.map((x) => x.level), ['red', 'yellow']);
});

test('histórico para o relatório inclui alertas já resolvidos', () => {
  const d = base({ resps: [R('p', 300, 45), R('n', 5, 24)] });
  assert.deepEqual(computeAlerts(d, NOW), []);
  const h = historyAlerts(d, NOW - 24 * H, NOW);
  assert.deepEqual(codes(h), ['red:resp_rpm_red']);
});
