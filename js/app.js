// Ponto de entrada: cabeçalho, banner vermelho, navegação e tela inicial.
import { h, toast } from './ui.js';
import { S, reload, setRender, saveSettings, nowMs } from './state.js';
import { computeAlerts } from './alerts.js';
import { thresholds, currentWeight, waterStatus, eatenFraction, within, isRest, rpmCounts } from './calc.js';
import { nextDose } from './schedule.js';
import { fmtAgo, fmtTime, HOUR } from './time.js';
import { telHref } from './ui.js';
import { renderMeds, nextDoseCard } from './meds.js';
import { renderHistory, openRecord } from './records.js';
import { renderResp, openManualCount, openAutoRecord } from './resp.js';
import { renderMore, renderReport, openPatientForm } from './more.js';
import { openEmergency, callButtons } from './emergency.js';
import { permission, requestPermission, checkDue } from './notify.js';
import { loadSample } from './sample.js';
import { STATE_LABEL } from './report.js';

const app = document.getElementById('app');
const TABS = [['home', '🏠', 'Início'], ['meds', '💊', 'Remédios'], ['resp', '🫁', 'Respiração'], ['hist', '📋', 'Registros'], ['more', '☰', 'Mais']];

function header(D) {
  const p = D.patient;
  return h('header', { class: 'topbar no-print' },
    h('div', { class: 'who' }, h('b', {}, p ? p.name : 'Diário de Recuperação'), p && p.sample && h('span', { class: 'badge' }, 'exemplo')),
    h('div', { class: 'calls' },
      p && p.vet && p.vet.phone && h('a', { class: 'call', href: telHref(p.vet.phone), 'aria-label': 'Ligar para o veterinário' }, '📞 Vet'),
      p && p.emergency && p.emergency.phone && h('a', { class: 'call red', href: telHref(p.emergency.phone), 'aria-label': 'Ligar para a emergência 24 horas' }, '🚨 24h'),
      h('button', { class: 'call', onclick: () => openEmergency(), 'aria-label': 'Sinais de emergência' }, '❗')));
}

function banner(alerts) {
  const reds = alerts.filter((a) => a.level === 'red' && !a.acked);
  if (!reds.length) return null;
  const p = S.D.patient;
  return h('div', { class: 'banner-red no-print', role: 'alert' },
    h('b', {}, '🚨 PROCURE EMERGÊNCIA AGORA'),
    h('ul', {}, reds.map((a) => h('li', {}, a.title))),
    h('div', { class: 'btn-row' },
      p && p.emergency && p.emergency.phone
        ? h('a', { class: 'btn light big', href: telHref(p.emergency.phone) }, '📞 Ligar emergência')
        : h('button', { class: 'btn light big', onclick: openPatientForm }, 'Cadastrar telefone de emergência'),
      h('button', { class: 'btn ghost', onclick: () => openEmergency(reds) }, 'Ver sinais'),
      h('button', { class: 'btn ghost', onclick: async () => {
        const acks = { ...(S.D.settings.acks || {}) }; reds.forEach((a) => { acks[a.id] = nowMs(); });
        await saveSettings({ acks }); render();
      } }, 'Já avisei / ciente')));
}

function alertCard(a) {
  return h('div', { class: `alert-card ${a.level}` },
    h('div', {}, h('b', {}, a.title), a.text && h('div', { class: 'small' }, a.text), h('div', { class: 'muted small' }, fmtAgo(a.at, nowMs()))),
    a.level !== 'red' && !a.acked && h('button', { class: 'btn small', onclick: async () => { await saveSettings({ acks: { ...(S.D.settings.acks || {}), [a.id]: nowMs() } }); render(); } }, 'Entendi'));
}

function metric(icon, title, value, sub, cls = '') {
  return h('div', { class: `metric ${cls}` }, h('div', { class: 'm-title' }, `${icon} ${title}`), h('div', { class: 'm-value' }, value), h('div', { class: 'm-sub' }, sub));
}

function renderHome(alerts) {
  const D = S.D, now = nowMs(), th = thresholds(D.patient), root = h('section', {});
  if (!D.patient) {
    root.append(h('div', { class: 'card welcome' },
      h('h2', {}, 'Bem-vinda 🐾'),
      h('p', {}, 'Este diário organiza medicamentos, água, comida, respiração e sinais da recuperação e gera um relatório para o veterinário. Ele não substitui o veterinário e não calcula doses.'),
      h('button', { class: 'btn primary big', onclick: openPatientForm }, 'Cadastrar paciente'),
      h('button', { class: 'btn wide', onclick: async () => { await loadSample(); await reload(); } }, 'Ver com dados de exemplo')));
    return root;
  }
  const perm = permission();
  if (perm === 'default' && D.meds.length && !D.settings.notifyAsked) {
    root.append(h('div', { class: 'card' }, h('b', {}, '🔔 Avisos de horário'), h('p', { class: 'small' }, 'Quer receber um aviso na hora de cada remédio? (funciona com o app aberto ou em segundo plano)'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => { await saveSettings({ notifyAsked: true }); render(); } }, 'Agora não'),
        h('button', { class: 'btn primary', onclick: async () => { const r = await requestPermission(); await saveSettings({ notifyAsked: true, notify: r === 'granted' }); if (r === 'denied') toast('Notificações bloqueadas pelo navegador. Use o alarme do celular.'); render(); } }, 'Ativar'))));
  } else if (perm === 'denied' && D.settings.notify) {
    root.append(h('div', { class: 'alert-inline yellow' }, '🔕 As notificações estão bloqueadas no navegador. Use também o alarme do celular para os remédios.'));
  }

  // Próxima dose
  const activeMeds = D.meds.filter((m) => m.active !== false);
  const nd = nextDose(activeMeds, D.doseLogs, now, th.lateMin);
  nd.late.forEach((s) => root.append(nextDoseCard(s, now, true)));
  if (nd.next) root.append(nextDoseCard(nd.next, now));
  else if (!nd.late.length) root.append(h('div', { class: 'card muted' }, D.meds.length ? 'Sem doses pendentes nas próximas 48 h.' : 'Nenhum medicamento cadastrado. Vá em Remédios.'));

  // Alertas (amarelos e informativos)
  const soft = alerts.filter((a) => a.level !== 'red' && !a.acked);
  if (soft.length) root.append(h('h3', {}, 'Atenção'), soft.map(alertCard));
  const seen = alerts.filter((a) => a.acked);
  if (seen.length) root.append(h('details', { class: 'seen' }, h('summary', {}, `Alertas já vistos (${seen.length})`), seen.map(alertCard)));

  // Cartões
  const kg = currentWeight(D.patient, D.weights);
  const ws = waterStatus(D.water, kg, th, now);
  const food24 = within(D.food, now, 24).sort((a, b) => b.at - a.at);
  const avg = food24.length ? food24.reduce((s, f) => s + (eatenFraction(f) || 0), 0) / food24.length : null;
  const lastResp = [...D.resps].sort((a, b) => b.at - a.at)[0];
  const lastUrine = [...D.elims].filter((e) => e.kind === 'urina' && e.amount !== 'nada').sort((a, b) => b.at - a.at)[0];
  const respCls = lastResp && isRest(lastResp.state) && rpmCounts(lastResp) ? (lastResp.rpm > th.rrRed ? 'red' : lastResp.rpm > th.rrYellow ? 'yellow' : '') : '';
  root.append(h('h3', {}, 'Resumo'), h('div', { class: 'metrics' },
    metric('💧', 'Água 24 h', D.water.length ? `${Math.round(ws.total)} mL` : '—', kg ? `ref. ${Math.round(kg * th.waterRefMin)}–${Math.round(kg * th.waterRefMax)} mL${ws.status === 'partial' ? ' · coletando 24 h' : ''}` : 'cadastre o peso', ws.status === 'low' || ws.status === 'high' ? 'yellow' : ''),
    metric('🍽️', 'Comida 24 h', food24.length ? `${food24.length} refeições` : '—', food24.length ? `comeu ${Math.round(avg * 100)}% em média · ${fmtAgo(food24[0].at, now)}` : 'sem registros'),
    metric('🫁', 'Última respiração', lastResp ? `${lastResp.rpm} rpm` : '—', lastResp ? `${STATE_LABEL[lastResp.state] || ''} · ${fmtAgo(lastResp.at, now)}` : 'sem medidas', respCls),
    metric('🚽', 'Último xixi', lastUrine ? fmtAgo(lastUrine.at, now) : '—', lastUrine ? fmtTime(lastUrine.at) : 'sem registros', lastUrine && now - lastUrine.at > 12 * HOUR ? 'yellow' : '')));

  root.append(h('h3', {}, 'Registrar'), h('div', { class: 'quick' },
    h('button', { class: 'quick-btn', onclick: openManualCount }, h('span', { class: 'qi' }, '👆'), 'Contar respiração'),
    h('button', { class: 'quick-btn', onclick: openAutoRecord }, h('span', { class: 'qi' }, '🎙️'), 'Gravar respiração'),
    h('button', { class: 'quick-btn', onclick: () => openRecord('water') }, h('span', { class: 'qi' }, '💧'), 'Água'),
    h('button', { class: 'quick-btn', onclick: () => openRecord('food') }, h('span', { class: 'qi' }, '🍽️'), 'Comida'),
    h('button', { class: 'quick-btn', onclick: () => openRecord('elims') }, h('span', { class: 'qi' }, '🚽'), 'Xixi / cocô'),
    h('button', { class: 'quick-btn', onclick: () => openRecord('signs') }, h('span', { class: 'qi' }, '🩺'), 'Sinais')));
  return root;
}

let rendering = false;
function render() {
  if (!S.D || rendering) return;
  rendering = true;
  const D = S.D, scroll = window.scrollY;
  const alerts = computeAlerts(D, nowMs());
  let view;
  switch (S.route) {
    case 'meds': view = renderMeds(); break;
    case 'resp': view = renderResp(); break;
    case 'hist': view = renderHistory(); break;
    case 'more': view = renderMore(); break;
    case 'report': view = renderReport(); break;
    default: view = renderHome(alerts);
  }
  app.replaceChildren(...[header(D), banner(alerts), h('main', { class: 'view', id: 'main' }, view),
    h('nav', { class: 'tabs no-print', 'aria-label': 'Navegação' }, TABS.map(([r, i, l]) =>
      h('button', { class: 'tab', 'aria-current': (S.route === r || (S.route === 'report' && r === 'more')) ? 'page' : null, onclick: () => { S.route = r; render(); window.scrollTo(0, 0); } }, h('span', { class: 'ti' }, i), l)))].filter(Boolean));
  window.scrollTo(0, scroll);
  rendering = false;
}
setRender(render);

async function init() {
  try { await reload(); }
  catch (e) { app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Não foi possível abrir o armazenamento do navegador'), h('p', {}, String(e.message || e)), h('p', {}, 'Saia do modo anônimo/privado e tente de novo.'))); return; }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  // atualiza contagens/status e verifica avisos de dose
  setInterval(() => { const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || ''); if (!document.querySelector('.overlay') && !typing && document.visibilityState === 'visible') render(); checkDue(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); checkDue(); } });
  checkDue();
}
init();
