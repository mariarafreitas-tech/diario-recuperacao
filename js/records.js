// Registros genéricos: água, comida, vômito, xixi/cocô, sinais, peso e o histórico.
import { h, sheet, buildForm, toast, confirmBox, compressImage } from './ui.js';
import * as DB from './db.js';
import { S, reload, render } from './state.js';
import { fmtDateTime, fmtWeek, dayKey } from './time.js';
import { waterDrunk, eatenFraction } from './calc.js';
import { signSummary, STATE_LABEL } from './report.js';
import { openDoseLogForm, STATUS_LABEL } from './meds.js';
import { openRespEdit } from './resp.js';

const o = (pairs) => pairs.map(([v, l, cls]) => ({ v, l, cls }));
const PORTION_L = { tudo: 'comeu tudo', '3/4': '¾', '1/2': '½', '1/4': '¼', recusou: 'recusou' };

export const TYPES = {
  water: {
    store: 'water', label: 'Água', icon: '💧',
    fields: [
      { key: 'offeredMl', label: 'Água oferecida (pote medido)', type: 'number', suffix: 'mL', required: true },
      { key: 'leftMl', label: 'Quanto sobrou no pote', type: 'number', suffix: 'mL', default: 0, required: true },
      { type: 'computed', label: 'Ingerido', computed: (v) => (v.offeredMl != null ? `${Math.max(0, v.offeredMl - (v.leftMl || 0))} mL` : '—') },
    ],
    validate: (v) => (v.offeredMl == null ? 'Informe quantos mL foram oferecidos.' : (v.leftMl || 0) > v.offeredMl ? 'O que sobrou não pode ser maior que o oferecido.' : null),
    summary: (r) => `${waterDrunk(r)} mL ingeridos (ofereceu ${r.offeredMl}, sobrou ${r.leftMl || 0})`,
  },
  food: {
    store: 'food', label: 'Comida', icon: '🍽️',
    fields: [
      { key: 'type', label: 'Tipo de alimento', type: 'text', placeholder: 'ex.: ração úmida, frango cozido' },
      { key: 'portion', label: 'Quanto comeu', type: 'chips', options: o([['tudo', 'Comeu tudo'], ['3/4', '¾'], ['1/2', '½'], ['1/4', '¼'], ['recusou', 'Recusou', 'chip-bad']]) },
      { key: 'offeredG', label: 'Gramas oferecidas (opcional)', type: 'number', suffix: 'g' },
      { key: 'leftG', label: 'Gramas que sobraram (opcional)', type: 'number', suffix: 'g', show: (v) => v.offeredG != null },
      { key: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    validate: (v) => (!v.portion && !(v.offeredG > 0) ? 'Escolha quanto comeu ou informe as gramas.' : null),
    summary: (r) => `${r.type || 'Refeição'} · ${r.portion ? PORTION_L[r.portion] : `${Math.round((eatenFraction(r) || 0) * 100)}% (${r.offeredG} g, sobrou ${r.leftG || 0} g)`}`,
  },
  vomits: {
    store: 'vomits', label: 'Vômito / regurgitação', icon: '🤮',
    fields: [
      { key: 'kind', label: 'O que foi', type: 'chips', required: true, options: o([['vomito', 'Vômito'], ['regurgitacao', 'Regurgitação']]), hint: 'Vômito: com esforço/contração. Regurgitação: sai fácil, sem esforço.' },
      { key: 'aspect', label: 'Aspecto', type: 'chips', options: o([['alimento', 'Comida'], ['espumoso', 'Espuma'], ['bile', 'Amarelo (bile)'], ['liquido', 'Líquido'], ['outro', 'Outro']]) },
      { key: 'blood', label: 'Tem sangue (vermelho vivo ou borra de café)', type: 'toggle' },
      { key: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    defaults: () => ({ kind: 'vomito' }),
    validate: (v) => (!v.kind ? 'Escolha vômito ou regurgitação.' : null),
    summary: (r) => `${r.kind === 'vomito' ? 'Vômito' : 'Regurgitação'}${r.aspect ? ' · ' + r.aspect : ''}${r.blood ? ' · COM SANGUE' : ''}`,
  },
  elims: {
    store: 'elims', label: 'Xixi / cocô', icon: '🚽',
    fields: [
      { key: 'kind', label: 'O que foi', type: 'chips', required: true, options: o([['urina', 'Xixi'], ['coco', 'Cocô']]) },
      { key: 'amount', label: 'Quantidade', type: 'chips', options: o([['nada', 'Tentou e não saiu', 'chip-bad'], ['pouco', 'Pouco'], ['medio', 'Médio'], ['grande', 'Grande']]) },
      { key: 'color', label: 'Cor do xixi', type: 'chips', show: (v) => v.kind === 'urina', options: o([['clara', 'Clara'], ['amarela', 'Amarela'], ['escura', 'Escura'], ['alaranjada', 'Alaranjada'], ['vermelha', 'Avermelhada', 'chip-bad']]) },
      { key: 'consistency', label: 'Consistência do cocô', type: 'chips', show: (v) => v.kind === 'coco', options: o([['normal', 'Normal'], ['mole', 'Mole'], ['diarreia', 'Diarreia'], ['duro', 'Duro/seco']]) },
      { key: 'blood', label: 'Tem sangue', type: 'toggle' },
      { key: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    defaults: () => ({ kind: 'urina' }),
    validate: (v) => (!v.kind ? 'Escolha xixi ou cocô.' : null),
    summary: (r) => `${r.kind === 'urina' ? 'Xixi' : 'Cocô'}${r.amount ? ' · ' + (r.amount === 'nada' ? 'tentou e não saiu' : r.amount) : ''}${r.color ? ' · ' + r.color : ''}${r.consistency ? ' · ' + r.consistency : ''}${r.blood ? ' · COM SANGUE' : ''}`,
  },
  signs: {
    store: 'signs', label: 'Sinais gerais', icon: '🩺',
    fields: [
      { key: 'gum', label: 'Cor da gengiva', type: 'chips', options: o([['rosa', 'Rosa'], ['palida', 'Pálida', 'chip-bad'], ['branca', 'Branca', 'chip-bad'], ['azulada', 'Azulada', 'chip-bad'], ['amarelada', 'Amarelada']]), hint: 'Levante o lábio e olhe a gengiva com boa luz.' },
      { key: 'crt', label: 'Tempo de preenchimento capilar', type: 'number', suffix: 's', hint: 'Pressione a gengiva até ficar branca, solte e conte até voltar o rosa. Normal: até 2 s.' },
      { key: 'pain', label: 'Dor (0 = nenhuma, 4 = muito forte)', type: 'chips', options: o([[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]) },
      { key: 'painSigns', label: 'Sinais de dor observados', type: 'multi', options: o([['postura', 'Postura curvada'], ['gemidos', 'Gemidos'], ['toque', 'Não deixa tocar'], ['inquieta', 'Inquietação']]) },
      { key: 'belly', label: 'Barriga', type: 'chips', options: o([['normal', 'Normal'], ['inchada', 'Inchada', 'chip-bad'], ['dura', 'Dura', 'chip-bad'], ['inchada_dura', 'Inchada e dura', 'chip-bad']]) },
      { key: 'wound', label: 'Ferimentos / curativos', type: 'chips', options: o([['ok', 'Sem alteração'], ['alterada', 'Com alteração']]) },
      { key: 'woundDischarge', label: 'Secreção', type: 'toggle', show: (v) => v.wound === 'alterada' },
      { key: 'woundSmell', label: 'Cheiro ruim', type: 'toggle', show: (v) => v.wound === 'alterada' },
      { key: 'woundSwelling', label: 'Inchaço / vermelhidão', type: 'toggle', show: (v) => v.wound === 'alterada' },
      { key: 'temp', label: 'Temperatura retal (se o vet orientou)', type: 'number', suffix: '°C' },
      { key: 'seizure', label: 'Teve convulsão', type: 'toggle' },
      { key: 'collapse', label: 'Teve desmaio / fraqueza súbita', type: 'toggle' },
      { key: 'photo', label: 'Foto (ferida, curativo, postura)', type: 'photo' },
      { key: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    prefill: (r) => ({ ...r, wound: r.woundDischarge === undefined ? null : (r.woundDischarge || r.woundSmell || r.woundSwelling) ? 'alterada' : 'ok' }),
    async beforeSave(v, rec) {
      const wound = v.wound; delete v.wound;
      if (wound === 'ok') { v.woundDischarge = v.woundSmell = v.woundSwelling = false; }
      else if (wound !== 'alterada') { delete v.woundDischarge; delete v.woundSmell; delete v.woundSwelling; }
      const file = v.photo; delete v.photo;
      if (file) {
        const blob = await compressImage(file);
        const ph = await DB.put('photos', { at: v.at, blob, note: v.notes || '' });
        v.photoId = ph.id;
      }
      for (const k of Object.keys(v)) if (v[k] === null || v[k] === undefined) { if (!rec || !(k in rec)) delete v[k]; }
    },
    summary: (r) => signSummary(r) + (r.photoId ? ' · 📷' : ''),
  },
  weights: {
    store: 'weights', label: 'Peso', icon: '⚖️',
    fields: [{ key: 'kg', label: 'Peso', type: 'number', suffix: 'kg', required: true }],
    validate: (v) => (!(v.kg > 0) ? 'Informe o peso.' : null),
    summary: (r) => `${String(r.kg).replace('.', ',')} kg`,
  },
};

export function openRecord(type, rec = null) {
  const T = TYPES[type], isNew = !rec;
  const init = isNew ? (T.defaults ? T.defaults() : {}) : (T.prefill ? T.prefill(rec) : rec);
  sheet(`${isNew ? 'Registrar' : 'Editar'}: ${T.label}`, (close) => {
    const f = buildForm([{ key: 'at', label: 'Data e hora', type: 'datetime' }, ...T.fields], init);
    const err = h('p', { class: 'error', role: 'alert' });
    return h('div', {}, f.el, err,
      h('div', { class: 'btn-row' },
        !isNew && h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Apagar este registro?', { ok: 'Apagar', danger: true })) { await DB.del(T.store, rec.id); close(); await reload(); } } }, 'Apagar'),
        h('button', { class: 'btn primary', onclick: async (e) => {
          const v = f.read(); const msg = T.validate && T.validate(v);
          if (msg) { err.textContent = msg; return; }
          e.target.disabled = true;
          if (T.beforeSave) await T.beforeSave(v, rec);
          await DB.put(T.store, { ...(rec || {}), ...v });
          close(); await reload(); toast('Salvo.');
        } }, 'Salvar')));
  });
}

const FILTERS = [['all', 'Tudo'], ['water', 'Água'], ['food', 'Comida'], ['resps', 'Respiração'], ['signs', 'Sinais'], ['elims', 'Xixi/cocô'], ['vomits', 'Vômito'], ['doseLogs', 'Doses'], ['weights', 'Peso']];

export function renderHistory() {
  const D = S.D, root = h('section', {});
  root.append(
    h('h3', {}, 'Registrar agora'),
    h('div', { class: 'quick' }, ['water', 'food', 'elims', 'vomits', 'signs', 'weights'].map((t) =>
      h('button', { class: 'quick-btn', onclick: () => openRecord(t) }, h('span', { class: 'qi' }, TYPES[t].icon), TYPES[t].label))),
    h('h3', {}, 'Histórico'),
    h('div', { class: 'chips scroll' }, FILTERS.map(([v, l]) => h('button', { class: 'chip', 'aria-pressed': S.histFilter === v ? 'true' : 'false', onclick: () => { S.histFilter = v; S.histLimit = 40; render(); } }, l))));
  const items = [];
  const push = (type, list) => list.forEach((r) => items.push({ type, r }));
  push('water', D.water); push('food', D.food); push('vomits', D.vomits); push('elims', D.elims); push('signs', D.signs); push('weights', D.weights);
  push('resps', D.resps); push('doseLogs', D.doseLogs);
  const list = items.filter((i) => S.histFilter === 'all' || i.type === S.histFilter).sort((a, b) => b.r.at - a.r.at);
  const limit = S.histLimit || 40;
  let lastDay = '';
  for (const { type, r } of list.slice(0, limit)) {
    const dk = dayKey(r.at);
    if (dk !== lastDay) { lastDay = dk; root.append(h('div', { class: 'day-sep' }, fmtWeek(r.at))); }
    let icon, text, onclick;
    if (type === 'resps') { icon = '🫁'; text = `${r.rpm ?? '—'} rpm · ${STATE_LABEL[r.state] || r.state} · ${r.method === 'manual' ? 'manual' : 'áudio'}${r.confidence ? ` (${r.confidence})` : ''}${r.audioId ? ' 🔊' : ''}${r.effort || r.mouthOpen || r.noisy ? ' ⚠️' : ''}`; onclick = () => openRespEdit(r); }
    else if (type === 'doseLogs') { const m = D.meds.find((x) => x.id === r.medId); icon = '💊'; text = `${m ? m.name : 'Remédio'} · ${STATUS_LABEL[r.status === 'skipped' ? 'skipped' : r.status]}${r.by ? ' · ' + r.by : ''}`; onclick = () => openDoseLogForm(r); }
    else { icon = TYPES[type].icon; text = TYPES[type].summary(r); onclick = () => openRecord(type, r); }
    root.append(h('button', { class: 'row', onclick }, h('span', { class: 'row-time' }, fmtDateTime(r.at).split(' ')[1]), h('span', { class: 'row-icon' }, icon), h('span', { class: 'row-text' }, text)));
  }
  if (!list.length) root.append(h('p', { class: 'empty' }, 'Nenhum registro ainda.'));
  if (list.length > limit) root.append(h('button', { class: 'btn wide', onclick: () => { S.histLimit = limit + 40; render(); } }, 'Mostrar mais'));
  return root;
}
