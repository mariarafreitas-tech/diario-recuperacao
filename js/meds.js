// Aba Remédios: agenda do dia, marcação de doses com 1 toque, cadastro de medicamentos.
import { h, sheet, buildForm, toast, confirmBox } from './ui.js';
import * as DB from './db.js';
import { S, reload, render, saveSettings, nowMs } from './state.js';
import { dayStart, addDays, fmtTime, fmtWeek, fmtDateTime, fmtIn, fmtAgo, MIN } from './time.js';
import { agenda, treatmentState, stockInfo, treatmentEnd } from './schedule.js';
import { thresholds } from './calc.js';

export const STATUS_LABEL = { pending: 'Pendente', given: 'Dada', late: 'Atrasada', skipped: 'Pulada', vomited: 'Vomitou após' };
export const ROUTES = [['oral', 'Oral'], ['colirio', 'Colírio'], ['topica', 'Tópica'], ['injetavel', 'Injetável']];
export const intervalLabel = (hrs) => (Number(hrs) === 24 ? '1x/dia' : Number(hrs) === 48 ? 'a cada 48 h' : `${hrs}/${hrs}h`);
const FOOD = { sim: 'Dar COM comida', nao: 'Dar SEM comida (jejum)', indiferente: 'Com ou sem comida' };

export async function logDose(med, scheduledAt, status) {
  const dup = S.D.doseLogs.filter((l) => l.medId === med.id && l.scheduledAt === scheduledAt && l.status === 'given');
  if (status === 'given' && dup.length) {
    const ok = await confirmBox(`Este horário já tem dose marcada como dada às ${fmtTime(dup[0].at)}. Marcar de novo? Ela ficará sinalizada como duplicada.`, { ok: 'Marcar de novo', title: 'Dose já marcada' });
    if (!ok) return;
  }
  const log = await DB.put('doseLogs', { medId: med.id, scheduledAt, at: nowMs(), status, by: S.D.settings.by || '', note: '' });
  await reload();
  toast(`${STATUS_LABEL[status]}: ${med.name}`, { label: 'Detalhes', fn: () => openDoseLogForm(log) });
}

export function openDoseLogForm(log) {
  const med = S.D.meds.find((m) => m.id === log.medId);
  sheet(`Dose: ${med ? med.name : ''}`, (close) => {
    const f = buildForm([
      { key: 'status', label: 'O que aconteceu', type: 'chips', required: true, options: [{ v: 'given', l: 'Dada' }, { v: 'skipped', l: 'Pulada' }, { v: 'vomited', l: 'Vomitou após' }] },
      { key: 'at', label: 'Quando foi dada/registrada', type: 'datetime' },
      { key: 'by', label: 'Quem deu', type: 'text', placeholder: 'ex.: Maria' },
      { key: 'note', label: 'Observação', type: 'textarea', placeholder: 'ex.: tomou com patê; lambeu o colírio' },
      { type: 'static', html: log.scheduledAt ? `Horário programado: <b>${fmtDateTime(log.scheduledAt)}</b>` : 'Dose extra (fora do horário programado).' },
    ], log);
    return h('div', {},
      f.el,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Apagar este registro de dose?', { ok: 'Apagar', danger: true })) { await DB.del('doseLogs', log.id); close(); await reload(); } } }, 'Apagar'),
        h('button', { class: 'btn primary', onclick: async () => { const v = f.read(); await DB.put('doseLogs', { ...log, ...v }); if (v.by) await saveSettings({ by: v.by }); close(); await reload(); toast('Salvo.'); } }, 'Salvar')));
  });
}

export function openMedForm(med = null) {
  const presets = [4, 6, 8, 12, 24, 48];
  const init = med ? { ...med, intervalSel: presets.includes(Number(med.intervalH)) ? String(med.intervalH) : 'outro', intervalOther: presets.includes(Number(med.intervalH)) ? '' : med.intervalH } : { route: 'oral', food: 'indiferente', intervalSel: '12', firstDoseAt: nowMs() };
  sheet(med ? 'Editar medicamento' : 'Novo medicamento', (close) => {
    const f = buildForm([
      { type: 'static', html: '⚠️ Registre <b>exatamente</b> o que está na receita. O app <b>não sugere nem calcula doses</b>.' },
      { key: 'name', label: 'Nome do medicamento', type: 'text', required: true },
      { key: 'strength', label: 'Concentração', type: 'text', placeholder: 'ex.: 50 mg/mL, comprimido de 100 mg' },
      { key: 'dose', label: 'Dose prescrita (como na receita)', type: 'text', required: true, placeholder: 'ex.: 1 comprimido; 0,5 mL' },
      { key: 'route', label: 'Via', type: 'chips', required: true, options: ROUTES.map(([v, l]) => ({ v, l })) },
      { key: 'intervalSel', label: 'Intervalo', type: 'select', options: [...presets.map((p) => ({ v: String(p), l: intervalLabel(p) })), { v: 'outro', l: 'Outro…' }] },
      { key: 'intervalOther', label: 'Intervalo em horas', type: 'number', suffix: 'h', show: (v) => v.intervalSel === 'outro' },
      { key: 'firstDoseAt', label: 'Horário da 1ª dose', type: 'datetime', hint: 'Os horários seguintes contam a partir dele (ex.: 8/8h).' },
      { key: 'endDate', label: 'Data de término do tratamento', type: 'date', hint: 'Deixe vazio se for uso contínuo/até nova ordem.' },
      { key: 'food', label: 'Com ou sem comida', type: 'chips', required: true, options: [{ v: 'sim', l: 'Com comida' }, { v: 'nao', l: 'Sem comida' }, { v: 'indiferente', l: 'Tanto faz' }] },
      { key: 'notes', label: 'Observações', type: 'textarea' },
      { key: 'stockQty', label: 'Quantidade restante (estoque)', type: 'number', hint: 'Em unidades (comprimidos, mL, frascos…). Opcional.' },
      { key: 'unitsPerDose', label: 'Unidades que saem do estoque a cada dose', type: 'number', hint: 'Só para o controle de estoque, ex.: 1 comprimido por dose.', show: (v) => v.stockQty != null },
    ], init);
    const err = h('p', { class: 'error', role: 'alert' });
    return h('div', {}, f.el, err,
      h('div', { class: 'btn-row' },
        med && h('button', { class: 'btn danger', onclick: async () => {
          if (await confirmBox('Apagar este medicamento e todo o histórico de doses dele? Esta ação não pode ser desfeita.', { ok: 'Apagar', danger: true })) {
            for (const l of S.D.doseLogs.filter((x) => x.medId === med.id)) await DB.del('doseLogs', l.id);
            await DB.del('meds', med.id); close(); await reload();
          }
        } }, 'Apagar'),
        h('button', { class: 'btn primary', onclick: async () => {
          const v = f.read();
          const intervalH = v.intervalSel === 'outro' ? v.intervalOther : Number(v.intervalSel);
          if (!v.name || !v.dose) { err.textContent = 'Preencha o nome e a dose prescrita.'; return; }
          if (!(intervalH > 0)) { err.textContent = 'Informe o intervalo em horas.'; return; }
          if (!v.route || !v.food) { err.textContent = 'Escolha a via e se é com ou sem comida.'; return; }
          const { intervalSel, intervalOther, ...rest } = v;
          const obj = { active: true, ...(med || {}), ...rest, intervalH };
          if (!med || med.stockQty !== v.stockQty) obj.stockAt = nowMs();
          await DB.put('meds', obj); close(); await reload(); toast('Medicamento salvo.');
        } }, 'Salvar')));
  });
}

function slotCard(s, now) {
  const { med } = s;
  const chip = h('span', { class: `chip-status st-${s.status}` }, STATUS_LABEL[s.status], s.duplicate && ' · DUPLICADA', s.givenLate && ' · com atraso');
  const done = s.status === 'given' || s.status === 'vomited' || s.status === 'skipped';
  return h('article', { class: `card slot st-${s.status}` },
    h('div', { class: 'slot-time' }, fmtTime(s.at)),
    h('div', { class: 'slot-main' },
      h('b', {}, med.name), h('div', { class: 'muted' }, `${med.dose}${med.strength ? ' · ' + med.strength : ''}`),
      h('div', { class: 'muted small' }, `${(ROUTES.find((r) => r[0] === med.route) || [])[1] || ''} · ${FOOD[med.food] || ''}`),
      chip,
      s.log && done && h('div', { class: 'small' }, `${fmtTime(s.log.at)}${s.log.by ? ' por ' + s.log.by : ''}${s.log.note ? ' — ' + s.log.note : ''}`),
      s.status === 'late' && h('div', { class: 'small warn' }, `atrasada ${fmtAgo(s.at, now).replace('há ', 'há ')}`)),
    h('div', { class: 'slot-actions' },
      !done ? [
        h('button', { class: 'btn primary big', onclick: () => logDose(med, s.at, 'given') }, '✓ Dada'),
        h('div', { class: 'btn-row tight' },
          h('button', { class: 'btn small', onclick: () => logDose(med, s.at, 'skipped') }, 'Pular'),
          h('button', { class: 'btn small', onclick: () => logDose(med, s.at, 'vomited') }, 'Vomitou')),
      ] : [
        s.status === 'vomited' && h('button', { class: 'btn small', onclick: () => logDose(med, s.at, 'given') }, 'Repetir (se o vet mandou)'),
        h('button', { class: 'btn small', onclick: () => openDoseLogForm(s.log) }, 'Detalhes')]));
}

export function nextDoseCard(slot, now, late = false) {
  const { med } = slot;
  return h('article', { class: `card next ${late ? 'is-late' : ''}` },
    h('div', { class: 'next-top' }, h('span', { class: 'label' }, late ? '⏰ DOSE ATRASADA' : '💊 PRÓXIMA DOSE'), h('span', { class: 'when' }, `${fmtTime(slot.at)} · ${late ? fmtAgo(slot.at, now) : fmtIn(slot.at, now)}`)),
    h('div', { class: 'next-name' }, med.name, med.strength && h('small', {}, ` ${med.strength}`)),
    h('div', { class: 'next-dose' }, med.dose),
    h('div', { class: 'muted' }, `${(ROUTES.find((r) => r[0] === med.route) || [])[1] || ''} · ${FOOD[med.food] || ''}${med.notes ? ' · ' + med.notes : ''}`),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary big', onclick: () => logDose(med, slot.at, 'given') }, '✓ Dei agora'),
      h('button', { class: 'btn', onclick: () => logDose(med, slot.at, 'skipped') }, 'Pular'),
      h('button', { class: 'btn', onclick: () => logDose(med, slot.at, 'vomited') }, 'Vomitou')));
}

export function renderMeds() {
  const now = nowMs(), D = S.D, th = thresholds(D.patient);
  const day = addDays(dayStart(now), S.dayOffset);
  const ag = agenda(D.meds, D.doseLogs, day, now, th.lateMin);
  const root = h('section', {});
  root.append(
    h('div', { class: 'card inline' }, h('label', { for: 'by' }, 'Quem está cuidando agora:'),
      h('input', { id: 'by', value: D.settings.by || '', placeholder: 'seu nome', onchange: (e) => saveSettings({ by: e.target.value.trim() }) })),
    h('div', { class: 'daynav' },
      h('button', { class: 'btn small', 'aria-label': 'Dia anterior', onclick: () => { S.dayOffset--; renderMedsAgain(); } }, '◀'),
      h('b', {}, S.dayOffset === 0 ? `Hoje · ${fmtWeek(day)}` : fmtWeek(day)),
      h('button', { class: 'btn small', 'aria-label': 'Próximo dia', onclick: () => { S.dayOffset++; renderMedsAgain(); } }, '▶'),
      S.dayOffset !== 0 && h('button', { class: 'btn small', onclick: () => { S.dayOffset = 0; renderMedsAgain(); } }, 'Hoje')),
    ag.length ? ag.map((s) => slotCard(s, now)) : h('p', { class: 'empty' }, D.meds.length ? 'Nenhuma dose programada neste dia.' : 'Nenhum medicamento cadastrado ainda.'),
    h('h3', {}, 'Medicamentos cadastrados'));
  for (const med of D.meds) {
    const ts = treatmentState(med, now, th.endDays), st = stockInfo(med, D.doseLogs, now, th.stockDays);
    root.append(h('article', { class: `card ${med.active === false || ts.state === 'finished' ? 'dim' : ''}` },
      h('b', {}, med.name), ' ', med.strength && h('span', { class: 'muted' }, med.strength),
      h('div', {}, `Dose: ${med.dose}`),
      h('div', { class: 'muted' }, `${(ROUTES.find((r) => r[0] === med.route) || [])[1]} · ${intervalLabel(med.intervalH)} · 1ª dose ${fmtDateTime(med.firstDoseAt)} · ${FOOD[med.food]}`),
      med.endDate && h('div', { class: ts.state === 'ending' ? 'warn' : 'muted' }, `Término: ${med.endDate.split('-').reverse().join('/')}${ts.state === 'finished' ? ' (encerrado)' : ts.state === 'ending' ? ' — chegando ao fim' : ''}`),
      med.active === false && h('div', { class: 'muted' }, 'Suspenso'),
      st && h('div', { class: st.low ? 'warn' : 'muted' }, `Estoque: ${st.remaining} un.${st.dosesLeft != null ? ` (~${st.dosesLeft} dose(s))` : ''}${st.short ? ' — não chega até o fim' : ''}`),
      med.notes && h('div', { class: 'muted small' }, med.notes),
      h('div', { class: 'btn-row tight' },
        h('button', { class: 'btn small', onclick: () => openMedForm(med) }, 'Editar'),
        h('button', { class: 'btn small', onclick: async () => { const log = await DB.put('doseLogs', { medId: med.id, scheduledAt: null, at: nowMs(), status: 'given', by: D.settings.by || '', note: 'Dose extra' }); await reload(); openDoseLogForm(log); } }, 'Dose extra'),
        h('button', { class: 'btn small', onclick: async () => {
          if (med.active === false) await DB.put('meds', { ...med, active: true, stoppedAt: null });
          else if (await confirmBox(`Suspender ${med.name}? Nenhuma dose futura será programada.`, { ok: 'Suspender' })) await DB.put('meds', { ...med, active: false, stoppedAt: nowMs() });
          await reload();
        } }, med.active === false ? 'Reativar' : 'Suspender'))));
  }
  root.append(h('button', { class: 'btn primary wide', onclick: () => openMedForm() }, '+ Novo medicamento'),
    h('p', { class: 'muted small' }, 'O app só registra o que o veterinário prescreveu. Nunca altere doses sem falar com ele.'));
  return root;
}
const renderMedsAgain = render;
