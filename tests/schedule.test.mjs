import test from 'node:test';
import assert from 'node:assert/strict';
import { slotsBetween, slotStatus, agenda, nextDose, treatmentState, stockInfo, doseStats, slotKey } from '../js/schedule.js';
import { dayStart, addDays, fmtTime, endOfDayMs, localToMs, dayKey } from '../js/time.js';

const T = (s) => new Date(s + '-03:00').getTime(); // America/Sao_Paulo = UTC-3 (sem horário de verão)
const times = (a) => a.map(fmtTime);
const med = (o = {}) => ({ id: 'm1', name: 'Remédio A', intervalH: 8, firstDoseAt: T('2026-10-20T06:00:00'), ...o });

test('time: limites de dia no fuso de São Paulo', () => {
  const d = dayStart(T('2026-10-21T23:30:00'));
  assert.equal(d, T('2026-10-21T00:00:00'));
  assert.equal(addDays(d, 1), T('2026-10-22T00:00:00'));
  assert.equal(endOfDayMs('2026-10-21'), T('2026-10-22T00:00:00'));
  assert.equal(dayKey(T('2026-10-21T23:59:59')), '2026-10-21');
  assert.equal(localToMs(2026, 10, 21, 8, 30), T('2026-10-21T08:30:00'));
});

test('8/8h: três doses no dia, âncora na 1ª dose', () => {
  const d = dayStart(T('2026-10-22T12:00:00'));
  assert.deepEqual(times(slotsBetween(med(), d, addDays(d, 1))), ['06:00', '14:00', '22:00']);
});

test('12/12h e 1x/dia', () => {
  const d = dayStart(T('2026-10-22T12:00:00'));
  assert.deepEqual(times(slotsBetween(med({ intervalH: 12, firstDoseAt: T('2026-10-20T20:00:00') }), d, addDays(d, 1))), ['08:00', '20:00']);
  assert.deepEqual(times(slotsBetween(med({ intervalH: 24, firstDoseAt: T('2026-10-20T09:00:00') }), d, addDays(d, 1))), ['09:00']);
});

test('intervalo que vira o dia: 8/8h começando às 22h', () => {
  const m = med({ firstDoseAt: T('2026-10-20T22:00:00') });
  const d20 = dayStart(T('2026-10-20T12:00:00')), d21 = addDays(d20, 1);
  assert.deepEqual(times(slotsBetween(m, d20, d21)), ['22:00']);
  assert.deepEqual(times(slotsBetween(m, d21, addDays(d21, 1))), ['06:00', '14:00', '22:00']);
});

test('intervalo que não divide 24h (5/5h) desloca os horários a cada dia', () => {
  const m = med({ intervalH: 5, firstDoseAt: T('2026-10-20T22:00:00') });
  const d21 = dayStart(T('2026-10-21T12:00:00'));
  assert.deepEqual(times(slotsBetween(m, d21, addDays(d21, 1))), ['03:00', '08:00', '13:00', '18:00', '23:00']);
  const d22 = addDays(d21, 1);
  assert.deepEqual(times(slotsBetween(m, d22, addDays(d22, 1))), ['04:00', '09:00', '14:00', '19:00']);
});

test('1ª dose no futuro: nada antes dela', () => {
  const m = med({ firstDoseAt: T('2026-10-22T18:00:00') });
  const d = dayStart(T('2026-10-22T12:00:00'));
  assert.deepEqual(times(slotsBetween(m, d, addDays(d, 1))), ['18:00']);
  assert.deepEqual(slotsBetween(m, addDays(d, -3), d), []);
});

test('término do tratamento: inclui o último dia inteiro e nada depois', () => {
  const m = med({ endDate: '2026-10-22' });
  const d22 = dayStart(T('2026-10-22T12:00:00'));
  assert.deepEqual(times(slotsBetween(m, d22, addDays(d22, 1))), ['06:00', '14:00', '22:00']);
  assert.deepEqual(slotsBetween(m, addDays(d22, 1), addDays(d22, 3)), []);
});

test('medicamento suspenso não gera doses depois da suspensão', () => {
  const m = med({ active: false, stoppedAt: T('2026-10-22T10:00:00') });
  const d = dayStart(T('2026-10-22T12:00:00'));
  assert.deepEqual(times(slotsBetween(m, d, addDays(d, 1))), ['06:00']);
});

test('status: pendente → atrasada após 30 min; dada; pulada; vomitou', () => {
  const m = med();
  const at = T('2026-10-22T14:00:00');
  assert.equal(slotStatus(m, at, [], T('2026-10-22T13:00:00')).status, 'pending');
  assert.equal(slotStatus(m, at, [], T('2026-10-22T14:30:00')).status, 'pending'); // exatamente 30 min: ainda não
  assert.equal(slotStatus(m, at, [], T('2026-10-22T14:31:00')).status, 'late');
  const log = (status, atLog = at + 5 * 60e3) => ({ id: 'l' + status, medId: 'm1', scheduledAt: at, at: atLog, status });
  const now = T('2026-10-22T16:00:00');
  assert.equal(slotStatus(m, at, [log('given')], now).status, 'given');
  assert.equal(slotStatus(m, at, [log('skipped')], now).status, 'skipped');
  assert.equal(slotStatus(m, at, [log('vomited')], now).status, 'vomited');
});

test('dose dada com atraso é sinalizada', () => {
  const at = T('2026-10-22T14:00:00');
  const s = slotStatus(med(), at, [{ medId: 'm1', scheduledAt: at, at: at + 45 * 60e3, status: 'given' }], at + 2 * 3600e3);
  assert.equal(s.givenLate, true);
});

test('dose duplicada: dois "dada" no mesmo horário; vômito seguido de nova dose NÃO é duplicata', () => {
  const at = T('2026-10-22T14:00:00');
  const g = (n) => ({ id: 'g' + n, medId: 'm1', scheduledAt: at, at: at + n * 60e3, status: 'given' });
  assert.equal(slotStatus(med(), at, [g(1), g(2)], at + 3600e3).duplicate, true);
  assert.equal(slotStatus(med(), at, [g(1)], at + 3600e3).duplicate, false);
  const v = { id: 'v', medId: 'm1', scheduledAt: at, at: at + 60e3, status: 'vomited' };
  const s = slotStatus(med(), at, [v, g(30)], at + 3600e3);
  assert.equal(s.duplicate, false);
  assert.equal(s.status, 'given');
});

test('agenda do dia e próxima dose', () => {
  const m = med();
  const now = T('2026-10-22T14:40:00');
  const d = dayStart(now);
  const logs = [{ id: 'a', medId: 'm1', scheduledAt: T('2026-10-22T06:00:00'), at: T('2026-10-22T06:03:00'), status: 'given' }];
  const ag = agenda([m], logs, d, now);
  assert.deepEqual(ag.map((s) => s.status), ['given', 'late', 'pending']);
  const nd = nextDose([m], logs, now);
  assert.equal(fmtTime(nd.late[0].at), '14:00');
  assert.equal(fmtTime(nd.next.at), '22:00');
});

test('próxima dose atravessa a meia-noite', () => {
  const m = med({ intervalH: 12, firstDoseAt: T('2026-10-20T20:00:00') });
  const nd = nextDose([m], [], T('2026-10-22T20:10:00')); // 20:00 pendente ainda dentro dos 30 min
  assert.equal(fmtTime(nd.next.at), '20:00');
  const nd2 = nextDose([m], [{ medId: 'm1', scheduledAt: T('2026-10-22T20:00:00'), at: T('2026-10-22T20:05:00'), status: 'given' }], T('2026-10-22T23:50:00'));
  assert.equal(nd2.next.at, T('2026-10-23T08:00:00'));
});

test('estado do tratamento: em andamento, terminando, encerrado, suspenso', () => {
  const now = T('2026-10-22T12:00:00');
  assert.equal(treatmentState(med(), now).state, 'ongoing');
  assert.equal(treatmentState(med({ endDate: '2026-10-23' }), now).state, 'ending');
  assert.equal(treatmentState(med({ endDate: '2026-10-30' }), now).state, 'ongoing');
  assert.equal(treatmentState(med({ endDate: '2026-10-21' }), now).state, 'finished');
  assert.equal(treatmentState(med({ active: false }), now).state, 'stopped');
});

test('estoque: desconta unidades por dose das doses dadas e alerta quando não chega ao fim', () => {
  const now = T('2026-10-22T12:00:00');
  const m = med({ stockQty: 6, unitsPerDose: 1, stockAt: T('2026-10-20T00:00:00'), endDate: '2026-10-25' });
  const logs = [1, 2].map((i) => ({ medId: 'm1', scheduledAt: i, at: T('2026-10-21T10:00:00') + i, status: 'given' }));
  const st = stockInfo(m, logs, now);
  assert.equal(st.remaining, 4);
  assert.equal(st.dosesLeft, 4);
  assert.equal(st.short, true);   // faltam ~9 doses até 25/10
  assert.equal(st.low, true);
  assert.equal(stockInfo(med(), [], now), null);
});

test('resumo por medicamento no período', () => {
  const m = med();
  const from = T('2026-10-22T00:00:00'), to = T('2026-10-23T00:00:00'), now = T('2026-10-22T23:00:00');
  const logs = [
    { medId: 'm1', scheduledAt: T('2026-10-22T06:00:00'), at: T('2026-10-22T06:05:00'), status: 'given' },
    { medId: 'm1', scheduledAt: T('2026-10-22T14:00:00'), at: T('2026-10-22T15:00:00'), status: 'given' },
  ];
  const [c] = doseStats([m], logs, from, to, now);
  assert.equal(c.scheduled, 3); assert.equal(c.given, 2); assert.equal(c.givenLate, 1); assert.equal(c.missed, 1);
});

test('slotKey', () => assert.equal(slotKey('a', 5), 'a|5'));
