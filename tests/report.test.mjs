import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportText, reportHtml, toCsv } from '../js/report.js';

const T = (s) => new Date(s + '-03:00').getTime();
const NOW = T('2026-10-22T12:00:00'), H = 3600e3;
const d = {
  patient: { name: 'Mel', weightKg: 20, injuries: 'Contusão' }, weights: [],
  meds: [{ id: 'm1', name: 'Remédio A', dose: '1 comp', route: 'oral', intervalH: 8, firstDoseAt: T('2026-10-21T06:00:00'), food: 'sim' }],
  doseLogs: [{ id: 'l1', medId: 'm1', scheduledAt: T('2026-10-21T06:00:00'), at: T('2026-10-21T06:05:00'), status: 'given', note: 'ok; "teste"' }],
  water: [{ id: 'w1', at: NOW - 5 * H, offeredMl: 300, leftMl: 100 }],
  food: [{ id: 'f1', at: NOW - 6 * H, portion: '3/4', type: 'Ração' }], vomits: [], elims: [{ id: 'e1', at: NOW - 3 * H, kind: 'urina', amount: 'medio' }],
  resps: [{ id: 'r1', at: NOW - 4 * H, rpm: 44, state: 'repouso', method: 'manual' }], signs: [], photos: [], settings: {},
};

test('relatório: texto e HTML contêm os blocos principais, e escapam HTML', () => {
  const m = buildReport(d, NOW - 24 * H, NOW, NOW);
  const t = reportText(m);
  for (const s of ['Mel', 'Remédio A', 'Água', 'Respiração em repouso', '44 rpm', 'Alertas no período', 'Não substitui']) assert.ok(t.includes(s), s);
  const html = reportHtml({ ...m, patient: { ...m.patient, name: '<b>Mel</b>' } });
  assert.ok(html.includes('&lt;b&gt;Mel'));
  assert.equal(m.rpmStats.max, 44);
  assert.ok(m.alerts.some((a) => a.level === 'red' && a.code === 'resp_rpm_red'));
});

test('CSV: BOM, separador ; e aspas escapadas', () => {
  const csv = toCsv(d);
  assert.ok(csv.startsWith('﻿tipo;data_hora;detalhe'));
  assert.ok(csv.includes('"Remédio A | given | prog. 21/10 06:00 |  | ok; ""teste"""'));
  assert.ok(csv.includes('respiracao'));
  assert.equal(csv.split('\r\n').length, 6);
});
