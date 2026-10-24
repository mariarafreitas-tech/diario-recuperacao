import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBreathing, assessAmbient, regroup } from '../js/breath.js';
import { breathing, ambient } from './helpers.mjs';

const FS = 16000;
const amb = () => assessAmbient(ambient({ fs: FS }), FS);

test('um pico por respiração: 24 rpm', () => {
  const r = analyzeBreathing(breathing({ rpm: 24 }), FS, { ambientRms: amb().rms });
  assert.equal(r.valid, true, r.reason);
  assert.ok(Math.abs(r.rpm - 24) <= 2, `rpm=${r.rpm}`);
  assert.notEqual(r.confidence, 'baixa');
  assert.equal(r.paired, false);
});

test('um pico por respiração: 36 rpm e 16 rpm', () => {
  for (const rpm of [16, 36]) {
    const r = analyzeBreathing(breathing({ rpm, seed: rpm }), FS, { ambientRms: amb().rms });
    assert.equal(r.valid, true, `${rpm}: ${r.reason}`);
    assert.ok(Math.abs(r.rpm - rpm) <= 2, `esperado ${rpm}, obteve ${r.rpm}`);
  }
});

test('dois picos por respiração (inspiração forte + expiração fraca) são agrupados em pares', () => {
  const bumps = [{ offset: 0, amp: 1, width: 0.2 }, { offset: 0.9, amp: 0.5, width: 0.2 }];
  const r = analyzeBreathing(breathing({ rpm: 20, bumps, seed: 5 }), FS, { ambientRms: amb().rms });
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.paired, true);
  assert.ok(Math.abs(r.rpm - 20) <= 2, `rpm=${r.rpm}`);
  assert.ok(r.peaks.some((p) => p.role === 'insp') && r.peaks.some((p) => p.role === 'exp'));
});

test('regroup alterna entre pares e picos simples', () => {
  const bumps = [{ offset: 0, amp: 1, width: 0.2 }, { offset: 0.9, amp: 0.5, width: 0.2 }];
  const r = analyzeBreathing(breathing({ rpm: 20, bumps, seed: 5 }), FS, { ambientRms: amb().rms });
  const single = regroup(r, false);
  assert.ok(Math.abs(single.rpm - 40) <= 3, `rpm=${single.rpm}`);
  assert.ok(Math.abs(regroup(single, true).rpm - 20) <= 2);
});

test('latido invalida a medida', () => {
  const x = breathing({ rpm: 24, extra: (t, r) => (t > 12 && t < 12.3 ? 0.9 * (r() - 0.5) : 0) });
  const r = analyzeBreathing(x, FS, { ambientRms: amb().rms });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'latido');
  assert.match(r.message, /Não foi possível medir/);
});

test('ofego (3 Hz) invalida a medida', () => {
  const r = analyzeBreathing(breathing({ rpm: 180, bumps: [{ offset: 0, amp: 1, width: 0.06 }] }), FS, { ambientRms: amb().rms });
  assert.equal(r.valid, false);
  assert.ok(['ofego', 'sem_ritmo'].includes(r.reason), r.reason);
});

test('só ruído (sem ritmo) invalida', () => {
  const r = analyzeBreathing(ambient({ fs: FS, seconds: 30, level: 0.01, seed: 4 }), FS, {});
  assert.equal(r.valid, false);
});

test('ambiente barulhento invalida e é classificado como alto', () => {
  const loud = assessAmbient(ambient({ fs: FS, level: 0.05 }), FS);
  assert.equal(loud.level, 'alto');
  assert.equal(amb().level, 'baixo');
  const r = analyzeBreathing(breathing({ rpm: 24 }), FS, { ambientRms: loud.rms });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'ruido_ambiente');
});

test('sinal fraco (celular longe) invalida', () => {
  const r = analyzeBreathing(breathing({ rpm: 24, amp: 0.0006, floor: 0.0001 }), FS, { ambientRms: amb().rms });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'sinal_fraco');
});

test('gravação curta demais invalida', () => {
  assert.equal(analyzeBreathing(breathing({ seconds: 8 }), FS, {}).reason, 'muito_curto');
});

test('movimento (batida grave) invalida', () => {
  const x = breathing({ rpm: 24, extra: (t) => (t > 10 && t < 10.4 ? 0.7 * Math.sin(2 * Math.PI * 40 * t) : 0) });
  const r = analyzeBreathing(x, FS, { ambientRms: amb().rms });
  assert.equal(r.valid, false);
});

test('gravação de 60 s funciona', () => {
  const r = analyzeBreathing(breathing({ seconds: 60, rpm: 28, seed: 11 }), FS, { ambientRms: amb().rms });
  assert.equal(r.valid, true, r.reason);
  assert.ok(Math.abs(r.rpm - 28) <= 2);
});
