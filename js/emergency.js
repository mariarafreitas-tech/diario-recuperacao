import { h, sheet, telHref } from './ui.js';
import { S } from './state.js';

export const EMERGENCY_SIGNS = [
  'Dificuldade para respirar (esforço, boca aberta em repouso, barulho forte)',
  'Gengiva pálida, branca ou azulada',
  'Barriga inchando ou ficando dura',
  'Vômito com sangue',
  'Desmaio ou fraqueza súbita',
  'Mais de 24 horas sem urinar',
  'Convulsão',
];

export function callButtons() {
  const p = S.D && S.D.patient;
  return h('div', { class: 'btn-col' },
    p && p.emergency && p.emergency.phone && h('a', { class: 'btn danger big', href: telHref(p.emergency.phone) }, `📞 Ligar emergência 24h${p.emergency.name ? ' — ' + p.emergency.name : ''}`),
    p && p.vet && p.vet.phone && h('a', { class: 'btn big', href: telHref(p.vet.phone) }, `📞 Ligar veterinário${p.vet.name ? ' — ' + p.vet.name : ''}`),
    (!p || !((p.emergency && p.emergency.phone) || (p.vet && p.vet.phone))) && h('p', { class: 'alert-inline yellow' }, 'Cadastre os telefones em Mais → Paciente.'));
}

/** Folha de emergência: lista de sinais + botões de ligar. alerts opcional (motivo). */
export function openEmergency(alerts = []) {
  sheet(alerts.length ? '🚨 Procure emergência agora' : '🚨 Sinais de emergência', () => h('div', {},
    alerts.length > 0 && h('div', { class: 'alert-inline red' }, alerts.map((a) => h('div', {}, h('b', {}, a.title)))),
    callButtons(),
    h('h3', {}, 'Procure atendimento imediato se houver:'),
    h('ul', { class: 'emerg-list' }, EMERGENCY_SIGNS.map((s) => h('li', {}, s))),
    h('p', { class: 'muted small' }, 'Este app organiza registros e não substitui o veterinário. Na dúvida, ligue.')));
}
