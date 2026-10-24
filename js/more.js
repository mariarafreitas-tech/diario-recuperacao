// Aba Mais: relatório, paciente, limites, backup, dados de exemplo, notificações.
import { h, sheet, buildForm, toast, confirmBox, download } from './ui.js';
import * as DB from './db.js';
import { S, reload, render, saveSettings, nowMs } from './state.js';
import { DAY } from './time.js';
import { DEFAULT_THRESHOLDS, thresholds, currentWeight } from './calc.js';
import { buildReport, reportText, reportHtml, toCsv } from './report.js';
import { loadSample } from './sample.js';
import { openEmergency } from './emergency.js';
import { openRecord } from './records.js';
import { permission, requestPermission } from './notify.js';

export function openPatientForm() {
  const p = S.D.patient || {};
  sheet('Paciente', (close) => {
    const f = buildForm([
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'weightKg', label: 'Peso atual', type: 'number', suffix: 'kg', required: true, hint: 'Cada peso novo entra no histórico de pesagens.' },
      { key: 'accidentDate', label: 'Data e hora do acidente', type: 'datetime' },
      { key: 'injuries', label: 'Lesões / diagnósticos informados pelo veterinário', type: 'textarea', rows: 4 },
      { key: 'vetName', label: 'Veterinário(a) — nome', type: 'text' },
      { key: 'vetPhone', label: 'Veterinário(a) — telefone', type: 'tel' },
      { key: 'emName', label: 'Emergência 24h — nome da clínica', type: 'text' },
      { key: 'emPhone', label: 'Emergência 24h — telefone', type: 'tel' },
    ], { ...p, vetName: p.vet && p.vet.name, vetPhone: p.vet && p.vet.phone, emName: p.emergency && p.emergency.name, emPhone: p.emergency && p.emergency.phone, accidentDate: p.accidentDate || nowMs() });
    const err = h('p', { class: 'error', role: 'alert' });
    return h('div', {}, f.el, err, h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: async () => {
      const v = f.read();
      if (!v.name || !(v.weightKg > 0)) { err.textContent = 'Informe o nome e o peso.'; return; }
      const prevKg = currentWeight(p, S.D.weights);
      await DB.put('patient', { ...p, id: 'main', sample: p.sample && p.name === v.name ? true : undefined, name: v.name, weightKg: v.weightKg, accidentDate: v.accidentDate, injuries: v.injuries,
        vet: { name: v.vetName, phone: v.vetPhone }, emergency: { name: v.emName, phone: v.emPhone } });
      if (v.weightKg !== prevKg) await DB.put('weights', { at: nowMs(), kg: v.weightKg });
      close(); await reload(); toast('Paciente salvo.');
    } }, 'Salvar')));
  });
}

const TH_FIELDS = [
  ['rrYellow', 'Respiração em repouso — atenção (amarelo) acima de', 'rpm'],
  ['rrRed', 'Respiração em repouso — emergência (vermelho) acima de', 'rpm'],
  ['rrRisePct', 'Aumento sobre a média das últimas 24h (amarelo)', '%'],
  ['lateMin', 'Dose considerada atrasada após', 'min'],
  ['waterRefMin', 'Água — referência mínima', 'mL/kg/dia'],
  ['waterRefMax', 'Água — referência máxima', 'mL/kg/dia'],
  ['waterLowPct', 'Água — alerta se abaixo de (% do mínimo da referência)', '%'],
  ['waterHighMlKg', 'Água — alerta de sede excessiva acima de', 'mL/kg/dia'],
  ['noUrineH', 'Sem urinar há mais de (vermelho)', 'h'],
  ['noEatH', 'Sem comer há mais de (amarelo)', 'h'],
  ['refuseMeals', 'Recusas seguidas de refeição (amarelo)', 'refeições'],
  ['crtMaxS', 'Preenchimento capilar normal até', 's'],
  ['tempMin', 'Temperatura retal — mínimo', '°C'],
  ['tempMax', 'Temperatura retal — máximo', '°C'],
  ['painYellow', 'Dor (0–4) a partir de', ''],
  ['stockDays', 'Avisar estoque quando restar para', 'dias'],
  ['endDays', 'Avisar fim de tratamento com', 'dias de antecedência'],
];
function openThresholds() {
  const th = thresholds(S.D.patient);
  sheet('Limites dos alertas', (close) => {
    const f = buildForm([{ type: 'static', html: 'Valores gerais de referência. <b>Ajuste com o veterinário</b>; eles mudam quando os alertas aparecem.' },
      ...TH_FIELDS.map(([key, label, suffix]) => ({ key, label, type: 'number', suffix }))], th);
    return h('div', {}, f.el, h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: async () => { await DB.put('patient', { ...S.D.patient, thresholds: {} }); close(); await reload(); toast('Limites padrão restaurados.'); } }, 'Restaurar padrão'),
      h('button', { class: 'btn primary', onclick: async () => {
        const v = f.read(), t = {};
        for (const [k] of TH_FIELDS) if (v[k] != null && v[k] !== DEFAULT_THRESHOLDS[k]) t[k] = v[k];
        if (t.rrRed != null && (t.rrYellow ?? th.rrYellow) >= t.rrRed) { toast('O limite vermelho deve ser maior que o amarelo.'); return; }
        await DB.put('patient', { ...S.D.patient, thresholds: t }); close(); await reload(); toast('Limites salvos.');
      } }, 'Salvar')));
  });
}

async function photoUrls(photos) {
  const out = {};
  for (const ph of photos) {
    const rec = await DB.get('photos', ph.id);
    if (rec && rec.blob) out[ph.id] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(rec.blob); });
  }
  return out;
}

export function renderReport() {
  const now = nowMs(), root = h('section', {});
  const m = buildReport(S.D, now - S.reportDays * DAY, now, now);
  const view = h('div', { class: 'report-wrap' });
  root.append(
    h('div', { class: 'no-print' },
      h('button', { class: 'btn small', onclick: () => { S.route = 'more'; render(); } }, '← Voltar'),
      h('h2', {}, 'Relatório para o veterinário'),
      h('div', { class: 'chips' }, [[1, '24 h'], [3, '3 dias'], [7, '7 dias']].map(([v, l]) => h('button', { class: 'chip', 'aria-pressed': String(S.reportDays === v), onclick: () => { S.reportDays = v; render(); } }, l))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨️ Imprimir / salvar PDF'),
        h('button', { class: 'btn', onclick: async () => {
          const t = reportText(m);
          try { await navigator.clipboard.writeText(t); toast('Texto copiado. Cole no WhatsApp.'); } catch { sheet('Texto do relatório', () => h('textarea', { rows: 14, readonly: true }, t)); }
        } }, '📋 Copiar texto (WhatsApp)'),
        navigator.share && h('button', { class: 'btn', onclick: () => navigator.share({ title: 'Diário de Recuperação', text: reportText(m) }).catch(() => {}) }, 'Compartilhar'))),
    view);
  photoUrls(m.photos).then((urls) => { view.innerHTML = reportHtml(m, urls); });
  return root;
}

function downloadBackup() {
  DB.exportJson().then((o) => download(`diario-recuperacao-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(o), 'application/json'));
}

export function renderMore() {
  const D = S.D, perm = permission();
  const item = (icon, title, sub, fn) => h('button', { class: 'menu-item', onclick: fn }, h('span', { class: 'qi' }, icon), h('span', {}, h('b', {}, title), sub && h('small', {}, sub)));
  const hasSample = [D.patient, ...D.water, ...D.meds].some((r) => r && r.sample);
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (await confirmBox('Importar o backup SUBSTITUI todos os dados atuais deste aparelho. Continuar?', { ok: 'Importar e substituir', danger: true })) { await DB.importJson(obj); await reload(); toast('Backup importado.'); }
    } catch (err) { toast('Não foi possível importar: ' + err.message); }
    e.target.value = '';
  } });
  return h('section', {},
    item('📄', 'Relatório para o veterinário', '24 h, 3 ou 7 dias · PDF e texto para WhatsApp', () => { S.route = 'report'; render(); }),
    item('🐕', 'Paciente', D.patient ? `${D.patient.name} · peso e contatos` : 'Cadastrar', openPatientForm),
    item('⚖️', 'Registrar peso', 'Histórico de pesagens', () => openRecord('weights')),
    item('🎚️', 'Limites dos alertas', 'Editáveis pelo veterinário', openThresholds),
    item('🚨', 'Sinais de emergência', 'Lista e botões de ligar', () => openEmergency()),
    h('h3', {}, 'Avisos de horário'),
    h('div', { class: 'card' },
      perm === 'unsupported' && h('p', {}, 'Este navegador não oferece notificações. Use também o alarme do celular.'),
      perm === 'denied' && h('p', { class: 'warn' }, 'As notificações estão BLOQUEADAS no navegador. Libere nas configurações do site (cadeado ao lado do endereço) e recarregue. Enquanto isso, use o alarme do celular.'),
      perm === 'default' && h('button', { class: 'btn primary', onclick: async () => { const r = await requestPermission(); if (r === 'granted') await saveSettings({ notify: true }); render(); } }, 'Ativar avisos de remédio'),
      perm === 'granted' && h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!D.settings.notify, onchange: async (e) => { await saveSettings({ notify: e.target.checked }); render(); } }), h('span', {}, 'Avisar na hora de cada dose')),
      h('p', { class: 'muted small' }, 'Os navegadores só avisam com o app aberto ou em segundo plano. Para não correr risco, use também um alarme do celular. No iPhone, só funciona com o app adicionado à tela inicial.')),
    h('h3', {}, 'Dados'),
    item('💾', 'Exportar backup (JSON)', 'Inclui fotos e áudios', downloadBackup),
    item('📥', 'Importar backup', 'Substitui os dados deste aparelho', () => file.click()),
    item('📊', 'Exportar CSV', 'Para abrir no Excel/Planilhas', () => download('diario-recuperacao.csv', toCsv(D), 'text/csv;charset=utf-8')),
    file,
    h('h3', {}, 'Dados de exemplo'),
    hasSample
      ? item('🧹', 'Limpar dados de exemplo', 'Remove só o que é fictício', async () => { if (await confirmBox('Remover todos os dados de exemplo? Seus registros reais ficam.', { ok: 'Remover', danger: true })) { await DB.clearSample(); await reload(); toast('Dados de exemplo removidos.'); } })
      : item('🧪', 'Carregar dados de exemplo', 'Cadela fictícia “Mel”, 6 dias de registros', async () => { if (D.patient && !D.patient.sample) { toast('Já existem dados reais neste aparelho. Exporte um backup e use outro navegador/aba anônima para ver o exemplo.'); return; } await loadSample(); await reload(); S.route = 'home'; render(); }),
    h('h3', {}, 'Sobre'),
    h('p', { class: 'muted small' }, 'Diário de Recuperação organiza registros feitos pela tutora e gera relatórios. Não diagnostica, não sugere nem calcula doses e não substitui o veterinário. Todos os dados ficam neste aparelho; nada é enviado à internet. Faça backup de vez em quando.'));
}
