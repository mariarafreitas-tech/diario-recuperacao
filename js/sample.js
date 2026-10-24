// Dados de exemplo FICTÍCIOS (cadela "Mel"). Todos marcados com sample:true.
import { put, uid } from './db.js';
import { dayStart, addDays, localToMs, parts, HOUR, MIN } from './time.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export async function loadSample(now = Date.now()) {
  const r = rng(42);
  const rnd = (a, b) => a + r() * (b - a);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const today = dayStart(now);
  const at = (day, h, m = 0) => { const p = parts(addDays(today, day)); return localToMs(p.y, p.mo, p.d, h, m); };
  const S = (store, o) => put(store, { id: 's-' + uid(), sample: true, ...o });

  await put('patient', {
    id: 'main', sample: true, name: 'Mel (exemplo)', weightKg: 18.2, accidentDate: at(-6, 17, 30),
    injuries: 'DADOS FICTÍCIOS. Contusão pulmonar leve, fratura de pelve em tratamento conservador, escoriações no flanco esquerdo.',
    vet: { name: 'Dra. Exemplo (veterinária)', phone: '(11) 90000-0000' },
    emergency: { name: 'Clínica 24h Exemplo', phone: '(11) 90000-0001' },
  });
  await S('weights', { at: at(-5, 9), kg: 18.0 });
  await S('weights', { at: at(-1, 9), kg: 18.2 });

  const meds = [
    { name: 'Analgésico (exemplo)', strength: '50 mg/comprimido', dose: '1 comprimido (valor fictício — siga sempre a receita)', route: 'oral', intervalH: 12, firstDoseAt: at(-5, 8), endDate: dayKeyOf(addDays(today, 2)), food: 'sim', notes: 'Dar depois da refeição.', stockQty: 9, unitsPerDose: 1, stockAt: at(-3, 8) },
    { name: 'Antibiótico (exemplo)', strength: '250 mg/comprimido', dose: '1 comprimido (valor fictício — siga sempre a receita)', route: 'oral', intervalH: 8, firstDoseAt: at(-5, 6), endDate: dayKeyOf(addDays(today, 5)), food: 'indiferente', notes: '', stockQty: 40, unitsPerDose: 1, stockAt: at(-3, 6) },
    { name: 'Colírio (exemplo)', strength: 'frasco 5 mL', dose: '1 gota no olho esquerdo (valor fictício)', route: 'colirio', intervalH: 12, firstDoseAt: at(-5, 9), endDate: dayKeyOf(addDays(today, 1)), food: 'indiferente', notes: '' },
  ];
  const savedMeds = [];
  for (const m of meds) savedMeds.push(await S('meds', { active: true, ...m }));
  for (const m of savedMeds) {
    const step = m.intervalH * HOUR;
    let n = 0;
    for (let t = m.firstDoseAt; t < now - 35 * MIN; t += step, n++) {
      let status = 'given', delay = Math.round(rnd(0, 10)) * MIN;
      if (m.name.startsWith('Antibiótico') && n === 7) status = 'vomited';
      else if (m.name.startsWith('Antibiótico') && n === 9) status = 'skipped';
      else if (m.name.startsWith('Analgésico') && n === 3) delay = 48 * MIN;
      await S('doseLogs', { medId: m.id, scheduledAt: t, at: t + delay, status, by: pick(['Maria', 'Maria', 'João']), note: status === 'vomited' ? 'Vomitou 15 min depois (exemplo).' : status === 'skipped' ? 'Estava dormindo; vet orientou pular (exemplo).' : '' });
    }
  }

  for (let d = -5; d <= 0; d++) {
    const frac = d === -1 ? 0.6 : 1;
    for (const h of [7, 11, 15, 19, 22]) {
      const t = at(d, h, Math.round(rnd(0, 40)));
      if (t > now) continue;
      const off = 250;
      await S('water', { at: t, offeredMl: off, leftMl: Math.round(off - rnd(130, 230) * frac) });
    }
    for (const [h, type] of [[8, 'Ração úmida'], [13, 'Ração seca'], [19, 'Ração úmida']]) {
      const t = at(d, h, Math.round(rnd(0, 20)));
      if (t > now) continue;
      const portion = d === -2 && h === 13 ? 'recusou' : pick(['tudo', 'tudo', '3/4', '1/2']);
      await S('food', { at: t, type, offeredG: 150, leftG: null, portion });
    }
    for (const h of [8, 12, 16, 20]) {
      const t = at(d, h, Math.round(rnd(0, 30)));
      if (t > now) continue;
      await S('elims', { at: t, kind: 'urina', amount: pick(['medio', 'medio', 'grande']), color: 'amarela', blood: false });
    }
    if (at(d, 10) < now) await S('elims', { at: at(d, 10, 15), kind: 'coco', amount: 'medio', consistency: d === -3 ? 'mole' : 'normal', blood: false });
    for (const [h, state] of [[9, 'repouso'], [14, 'dormindo'], [21, 'dormindo']]) {
      const t = at(d, h, Math.round(rnd(0, 30)));
      if (t > now) continue;
      const rpm = Math.round(rnd(20, 26) + (d + 5) * 0.5);
      await S('resps', { at: t, rpm, state, method: 'manual', confidence: null, effort: false, mouthOpen: false, noisy: false, cough: false, soundTypes: [], notes: '' });
    }
    if (at(d, 9) < now) await S('signs', { at: at(d, 9, 5), gum: 'rosa', crt: 1.5, pain: Math.max(0, 2 - Math.floor((d + 5) / 2)), belly: 'normal', temp: 38.4 + (r() - 0.5) * 0.4, woundDischarge: false, woundSmell: false, woundSwelling: false, notes: d === -4 ? 'Curativo trocado (exemplo).' : '' });
  }
  // um episódio que já passou (aparece no relatório)
  await S('resps', { at: now - 9 * HOUR, rpm: 32, state: 'repouso', method: 'auto', confidence: 'media', autoRpm: 32, effort: false, mouthOpen: false, noisy: false, cough: false, soundTypes: [], notes: 'Depois de passear no quintal (exemplo).' });
  await S('resps', { at: now - 40 * MIN, rpm: 25, state: 'repouso', method: 'auto_corrigido', confidence: 'media', autoRpm: 24, effort: false, mouthOpen: false, noisy: false, cough: false, soundTypes: [], notes: '' });
  await S('vomits', { at: at(-4, 14), kind: 'regurgitacao', aspect: 'alimento', blood: false, notes: 'Comeu rápido demais (exemplo).' });
}

function dayKeyOf(ts) { const p = parts(ts + 12 * HOUR); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
