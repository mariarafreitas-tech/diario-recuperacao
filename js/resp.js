// Respiração: contagem manual (30 s), gravação por áudio, tendência e edição.
import { h, sheet, buildForm, toast, confirmBox } from './ui.js';
import * as DB from './db.js';
import { S, reload, render, saveSettings, nowMs } from './state.js';
import { fmtDateTime, fmtAgo, DAY } from './time.js';
import { thresholds, restingSeries, isRest, rpmCounts } from './calc.js';
import { computeAlerts } from './alerts.js';
import { lineChart, waveChart } from './charts.js';
import { STATE_LABEL } from './report.js';
import { openMic, createCapture } from './audio.js';
import { analyzeBreathing, assessAmbient, regroup, invalidMessage } from './breath.js';
import { openEmergency } from './emergency.js';

const o = (pairs) => pairs.map(([v, l, cls]) => ({ v, l, cls }));
const STATES = o([['dormindo', 'Dormindo'], ['repouso', 'Em repouso, acordada'], ['esforco', 'Após esforço']]);
const CONF_L = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export const RESP_FIELDS = [
  { key: 'state', label: 'Estado da cadela na hora', type: 'chips', required: true, options: STATES, hint: 'Só “dormindo” e “repouso” entram na tendência e nos alertas de frequência.' },
  { type: 'static', html: '<b>Checklist rápido</b>' },
  { key: 'effort', label: 'Respiração com esforço abdominal (a barriga trabalha)', type: 'toggle' },
  { key: 'mouthOpen', label: 'Boca aberta em repouso', type: 'toggle' },
  { key: 'noisy', label: 'Barulho / chiado (dá para ouvir sem estetoscópio)', type: 'toggle' },
  { key: 'cough', label: 'Tosse', type: 'toggle' },
  { key: 'gumAbnormal', label: 'Gengiva pálida, branca ou azulada agora', type: 'toggle' },
  { key: 'soundTypes', label: 'Como é o som (se houver)', type: 'multi', options: o([['chiado', 'Chiado'], ['ronco', 'Ronco'], ['estertor', 'Estertor (“borbulhante”)'], ['gemido', 'Gemido']]) },
  { key: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
];

/** Depois de salvar: se a medida gerou alerta vermelho, mostra a tela de emergência. */
async function afterSave(rec) {
  await reload();
  const reds = computeAlerts(S.D, nowMs()).filter((a) => a.level === 'red' && !a.acked && a.id.endsWith(':' + rec.id));
  if (reds.length) openEmergency(reds);
  else {
    const ys = computeAlerts(S.D, nowMs()).filter((a) => a.level === 'yellow' && a.id.endsWith(':' + rec.id));
    if (ys.length) toast(`⚠️ ${ys[0].title}. Converse com o veterinário.`);
    else toast('Medida salva.');
  }
}

// ---------- contagem manual ----------
export function openManualCount() {
  let timer = null;
  sheet('Contar respiração (30 s)', (close) => {
    const box = h('div', { class: 'counter' });
    let taps = 0;
    const ready = () => {
      box.replaceChildren(
        h('p', { class: 'big-p' }, 'Deixe a cadela quieta (dormindo ou em repouso). Toque no botão grande cada vez que o peito subir. O app conta 30 segundos e multiplica por 2.'),
        h('button', { class: 'btn primary big', onclick: run }, 'Começar 30 s'));
    };
    const run = () => {
      taps = 0; let left = 30;
      const t0 = nowMs();
      const cnt = h('div', { class: 'tap-count' }, '0'), tl = h('div', { class: 'tap-left' }, '30 s');
      const btn = h('button', { class: 'tap-btn', 'aria-label': 'Toque a cada respiração', onpointerdown: (e) => { e.preventDefault(); taps++; cnt.textContent = taps; navigator.vibrate && navigator.vibrate(15); } }, 'TOQUE a cada respiração', cnt);
      box.replaceChildren(tl, btn);
      timer = setInterval(() => {
        left = Math.max(0, 30 - (nowMs() - t0) / 1000);
        tl.textContent = `${Math.ceil(left)} s`;
        if (left <= 0) { clearInterval(timer); timer = null; navigator.vibrate && navigator.vibrate([100, 50, 100]); done(t0); }
      }, 100);
    };
    const done = (t0) => {
      const rpm = taps * 2;
      const f = buildForm([{ key: 'rpm', label: 'Respirações por minuto (confirme ou corrija)', type: 'number', suffix: 'rpm', required: true, default: rpm }, ...RESP_FIELDS], { state: 'repouso' });
      const err = h('p', { class: 'error', role: 'alert' });
      box.replaceChildren(
        h('div', { class: 'result-big' }, h('b', {}, `${taps} × 2 = ${rpm} rpm`)),
        f.el, err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: ready }, 'Refazer'),
          h('button', { class: 'btn primary', onclick: async () => {
            const v = f.read();
            if (!(v.rpm > 0)) { err.textContent = 'Informe a frequência.'; return; }
            if (!v.state) { err.textContent = 'Escolha o estado da cadela.'; return; }
            const rec = await DB.put('resps', { at: t0, ...v, method: 'manual', manualRpm: rpm, confidence: null, taps });
            close(); await afterSave(rec);
          } }, 'Salvar')));
    };
    ready();
    return box;
  }, { onClose: () => timer && clearInterval(timer) });
}

// ---------- gravação por áudio ----------
export function openAutoRecord() {
  let cap = null, aborted = false;
  sheet('Gravar respiração', (close) => {
    const box = h('div', { class: 'counter' });
    let seconds = 30, state = 'dormindo', ambientRms = null, wake = null;
    const meter = () => h('div', { class: 'meter' }, h('i', {}));
    const setLevel = (m, rms) => { const db = 20 * Math.log10(Math.max(rms, 1e-6)); m.firstChild.style.width = `${Math.max(0, Math.min(100, ((db + 80) / 60) * 100))}%`; };

    const intro = () => {
      const f = buildForm([
        { key: 'seconds', label: 'Duração', type: 'chips', required: true, options: o([[30, '30 s'], [60, '60 s']]) },
        { key: 'state', label: 'Estado da cadela', type: 'chips', required: true, options: STATES.slice(0, 2) },
      ], { seconds, state });
      box.replaceChildren(
        h('ul', { class: 'steps' },
          h('li', {}, 'Ambiente silencioso: desligue TV, ventilador e peça silêncio.'),
          h('li', {}, 'Apoie o celular parado, a 10–30 cm do focinho/peito. Não segure na mão.'),
          h('li', {}, 'Primeiro o app ouve 3 s do ambiente. Depois grava. Tudo é analisado no seu celular; nada vai para a internet.')),
        f.el,
        h('button', { class: 'btn primary big', onclick: () => { const v = f.read(); seconds = v.seconds || 30; state = v.state || 'dormindo'; start(); } }, 'Começar'),
        h('button', { class: 'btn wide', onclick: () => { close(); openManualCount(); } }, 'Prefiro contar manualmente'));
    };

    const start = async () => {
      try {
        const { stream, warning } = await openMic();
        cap = await createCapture(stream);
        if (aborted) { cap.close(); return; }
        if (warning) toast(warning);
        try { wake = navigator.wakeLock && await navigator.wakeLock.request('screen'); } catch { /* opcional */ }
        const m = meter(), t = h('p', { class: 'big-p' }, 'Medindo o ruído do ambiente (3 s)…');
        box.replaceChildren(t, m);
        const amb = await cap.collect(3, { onLevel: (r) => setLevel(m, r) });
        const a = assessAmbient(amb, cap.fs);
        ambientRms = a.rms;
        if (a.level === 'alto') {
          box.replaceChildren(h('p', { class: 'alert-inline red' }, `🔊 Ambiente barulhento demais (${a.bandDb.toFixed(0)} dBFS). Desligue TV/ventilador e peça silêncio.`),
            h('button', { class: 'btn primary', onclick: start2 }, 'Medir o ambiente de novo'),
            h('button', { class: 'btn', onclick: ready }, 'Gravar assim mesmo (menos confiável)'));
        } else ready(a);
      } catch (e) {
        box.replaceChildren(h('p', { class: 'alert-inline red' }, `Não foi possível usar o microfone: ${e.message || e.name}`),
          h('p', { class: 'muted' }, 'Verifique a permissão do microfone no navegador e se o app está aberto por HTTPS.'),
          h('button', { class: 'btn primary', onclick: () => { close(); openManualCount(); } }, 'Contar manualmente'));
      }
    };
    const start2 = async () => {
      const m = meter(); box.replaceChildren(h('p', { class: 'big-p' }, 'Medindo o ruído do ambiente (3 s)…'), m);
      const amb = await cap.collect(3, { onLevel: (r) => setLevel(m, r) });
      const a = assessAmbient(amb, cap.fs); ambientRms = a.rms;
      a.level === 'alto' ? box.replaceChildren(h('p', { class: 'alert-inline red' }, 'Ainda muito barulhento.'), h('button', { class: 'btn primary', onclick: start2 }, 'Medir de novo'), h('button', { class: 'btn', onclick: () => ready() }, 'Gravar assim mesmo')) : ready(a);
    };
    const ready = (a) => {
      box.replaceChildren(
        a && h('p', { class: `alert-inline ${a.level === 'medio' ? 'yellow' : 'ok'}` }, a.level === 'medio' ? '🔉 Ambiente com algum ruído. Tente reduzir.' : '✅ Ambiente silencioso.'),
        h('p', { class: 'big-p' }, `Posicione o celular a 10–30 cm do focinho/peito e toque em Gravar. Serão ${seconds} s.`),
        h('button', { class: 'btn primary big', onclick: record }, `● Gravar ${seconds} s`));
    };
    const record = async () => {
      const m = meter(), t = h('div', { class: 'tap-left' }, `${seconds} s`);
      box.replaceChildren(t, m, h('p', { class: 'muted center' }, 'Fique em silêncio e não mexa no celular.'));
      const t0 = nowMs();
      const { samples, fs, blob } = await cap.recordClip(seconds, { onTick: (el) => { t.textContent = `${Math.ceil(seconds - el)} s`; }, onLevel: (r) => setLevel(m, r) });
      cap.close(); cap = null; wake && wake.release && wake.release().catch(() => {});
      box.replaceChildren(h('p', { class: 'big-p' }, 'Analisando…'));
      await new Promise((r) => setTimeout(r, 30));
      const res = analyzeBreathing(samples, fs, { ambientRms });
      result(res, blob, t0);
    };

    const result = (res0, blob, t0) => {
      if (!res0.valid) {
        box.replaceChildren(
          h('p', { class: 'alert-inline red' }, res0.message || invalidMessage(res0.reason)),
          blob && h('audio', { controls: true, src: URL.createObjectURL(blob) }),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', onclick: start }, 'Tentar de novo'),
            h('button', { class: 'btn', onclick: () => { close(); openManualCount(); } }, 'Contar manualmente')));
        return;
      }
      let res = res0;
      const calibrating = (S.D.settings.calibrationDone || 0) < 5;
      const chart = h('div', {}), info = h('div', { class: 'muted small' });
      const rpmIn = h('input', { type: 'text', inputmode: 'decimal', class: 'rpm-input', value: res.rpm, 'aria-label': 'Respirações por minuto' });
      const manIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex.: 24', 'aria-label': 'Contagem manual' });
      const diff = h('div', { class: 'small' });
      const pairBtn = h('button', { class: 'btn small', 'aria-pressed': String(res.paired), onclick: () => { res = regroup(res, !res.paired); rpmIn.value = res.rpm; draw(); } }, '');
      const confBadge = h('span', {});
      const draw = () => {
        chart.innerHTML = waveChart({ signal: res.signal, rate: res.rate, peaks: res.peaks });
        info.textContent = `${res.breaths.length} respiração(ões) em ${res.durationS.toFixed(0)} s · autocorrelação ${res.rpmSpec.toFixed(1)} rpm · picos ${res.rpmPeaks != null ? res.rpmPeaks.toFixed(1) : '—'} rpm${res.divergence != null ? ` · divergência ${(res.divergence * 100).toFixed(0)}%` : ''}`;
        pairBtn.textContent = res.paired ? '✓ Picos agrupados 2 a 2 (inspiração + expiração)' : 'Agrupar picos 2 a 2';
        pairBtn.setAttribute('aria-pressed', String(res.paired));
        confBadge.className = `badge conf-${res.confidence}`; confBadge.textContent = `Confiança ${CONF_L[res.confidence]}`;
        upDiff();
      };
      const num = (el) => { const n = Number(String(el.value).replace(',', '.')); return el.value.trim() !== '' && Number.isFinite(n) ? n : null; };
      const upDiff = () => { const m = num(manIn); diff.textContent = m != null ? `Diferença (auto − manual): ${(num(rpmIn) - m) > 0 ? '+' : ''}${(num(rpmIn) - m).toFixed(0)} rpm` : ''; };
      rpmIn.addEventListener('input', upDiff); manIn.addEventListener('input', upDiff);
      const f = buildForm(RESP_FIELDS, { state });
      let blobUrl = blob ? URL.createObjectURL(blob) : null;
      const keep = h('input', { type: 'checkbox', checked: !!blob });
      const err = h('p', { class: 'error', role: 'alert' });
      box.replaceChildren(
        h('div', { class: 'result-big' }, h('label', {}, 'Respirações por minuto'), rpmIn, confBadge),
        res.confidence === 'baixa' && h('p', { class: 'alert-inline yellow' }, 'Confiança baixa: confira os picos na onda ou conte manualmente. Enquanto você não corrigir o valor, esta medida não dispara nem apaga alertas.'),
        res.ambiguous && h('p', { class: 'alert-inline yellow' }, 'Ritmo alto: se cada respiração tem 2 picos (subida e descida), use “agrupar picos 2 a 2”.'),
        chart, info, h('div', { class: 'btn-row tight' }, pairBtn),
        blobUrl && h('audio', { controls: true, src: blobUrl }),
        blob && h('label', { class: 'toggle' }, keep, h('span', {}, 'Guardar o áudio para mostrar ao veterinário')),
        calibrating && h('div', { class: 'card calib' }, h('b', {}, `Calibração (${(S.D.settings.calibrationDone || 0) + 1}ª de 5)`), h('p', { class: 'small' }, 'Nas primeiras medições, conte também manualmente (toque a cada respiração por 30 s × 2) para comparar com o app.'), manIn, diff),
        f.el, err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: start }, 'Gravar de novo'),
          h('button', { class: 'btn primary', onclick: async () => {
            const v = f.read(), final = num(rpmIn);
            if (!(final > 0)) { err.textContent = 'Informe a frequência.'; return; }
            if (!v.state) { err.textContent = 'Escolha o estado da cadela.'; return; }
            let audioId = null;
            if (blob && keep.checked) audioId = (await DB.put('audios', { at: t0, blob, mime: blob.type, durationS: res.durationS })).id;
            const manual = num(manIn);
            const corrected = Math.round(final) !== Math.round(res.rpm);
            const rec = await DB.put('resps', {
              at: t0, ...v, rpm: Math.round(final), method: corrected ? 'auto_corrigido' : 'auto', confidence: res.confidence,
              autoRpm: res.rpm, manualRpm: manual, rpmSpec: +res.rpmSpec.toFixed(1), rpmPeaks: res.rpmPeaks != null ? +res.rpmPeaks.toFixed(1) : null,
              paired: res.paired, durationS: Math.round(res.durationS), breathsDetected: res.breaths.length, audioId,
            });
            if (calibrating && manual != null) await saveSettings({ calibrationDone: (S.D.settings.calibrationDone || 0) + 1 });
            close(); await afterSave(rec);
          } }, 'Salvar')));
      draw();
    };

    intro();
    return box;
  }, { onClose: () => { aborted = true; if (cap) cap.close(); } });
}

// ---------- edição ----------
export function openRespEdit(rec) {
  sheet('Editar: Respiração', (close) => {
    const f = buildForm([
      { key: 'at', label: 'Data e hora', type: 'datetime' },
      { key: 'rpm', label: 'Respirações por minuto', type: 'number', suffix: 'rpm', required: true },
      ...RESP_FIELDS,
    ], rec);
    const audioBox = h('div', {});
    const drawAudio = async () => {
      audioBox.replaceChildren();
      if (!rec.audioId) return;
      const a = await DB.get('audios', rec.audioId);
      if (!a) return;
      audioBox.append(h('audio', { controls: true, src: URL.createObjectURL(a.blob) }),
        h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox('Apagar só o áudio desta medida?', { ok: 'Apagar áudio', danger: true })) { await DB.del('audios', rec.audioId); rec = await DB.put('resps', { ...rec, audioId: null }); await reload(); drawAudio(); } } }, 'Apagar áudio'));
    };
    drawAudio();
    return h('div', {},
      h('p', { class: 'muted small' }, `Método: ${rec.method === 'manual' ? 'manual' : rec.method === 'auto' ? 'automático (áudio)' : 'automático corrigido'}${rec.confidence ? ` · confiança ${CONF_L[rec.confidence]}` : ''}${rec.autoRpm != null ? ` · auto ${rec.autoRpm} rpm` : ''}${rec.manualRpm != null ? ` · manual ${rec.manualRpm} rpm` : ''}`),
      audioBox, f.el,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Apagar esta medida (e o áudio dela)?', { ok: 'Apagar', danger: true })) { if (rec.audioId) await DB.del('audios', rec.audioId); await DB.del('resps', rec.id); close(); await reload(); } } }, 'Apagar'),
        h('button', { class: 'btn primary', onclick: async () => {
          const v = f.read();
          const edited = v.rpm !== rec.rpm && rec.method === 'auto';
          await DB.put('resps', { ...rec, ...v, method: edited ? 'auto_corrigido' : rec.method });
          close(); await reload(); toast('Salvo.');
        } }, 'Salvar')));
  });
}

// ---------- aba ----------
export function renderResp() {
  const D = S.D, now = nowMs(), th = thresholds(D.patient);
  const days = S.respDays, from = now - days * DAY;
  const rest = restingSeries(D.resps, from, now);
  const root = h('section', {});
  root.append(
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn primary big', onclick: openManualCount }, '👆 Contar respiração (30 s)'),
      h('button', { class: 'btn big', onclick: openAutoRecord }, '🎙️ Gravar respiração (microfone)')),
    h('h3', {}, 'Tendência em repouso'),
    h('div', { class: 'chips' }, [[1, '24 h'], [3, '3 dias'], [7, '7 dias']].map(([v, l]) => h('button', { class: 'chip', 'aria-pressed': String(S.respDays === v), onclick: () => { S.respDays = v; render(); } }, l))),
    h('div', { class: 'card', html: lineChart({
      points: rest.map((r) => ({ t: r.at, v: Number(r.rpm), kind: r.method === 'manual' ? '' : 'auto' })), from, to: now,
      yMin: 0, yMax: Math.max(60, Math.ceil((Math.max(0, ...rest.map((r) => r.rpm)) + 5) / 20) * 20),
      lines: [{ v: th.rrYellow, cls: 'yellow', label: `${th.rrYellow} atenção` }, { v: th.rrRed, cls: 'red', label: `${th.rrRed} emergência` }], unit: 'rpm' }) }),
    h('p', { class: 'muted small' }, `Só entram medidas “dormindo” ou “repouso”, confirmadas. Limites: amarelo > ${th.rrYellow} rpm ou +${th.rrRisePct}% da média de 24h; vermelho > ${th.rrRed} rpm. Definidos com o veterinário.`));
  const auto = D.resps.filter((r) => r.manualRpm != null && r.autoRpm != null);
  if (auto.length) {
    const d = auto.map((r) => r.autoRpm - r.manualRpm), m = d.reduce((s, x) => s + x, 0) / d.length;
    root.append(h('div', { class: 'card small' }, h('b', {}, 'Calibração: '), `${auto.length} comparação(ões) auto × manual · diferença média ${m > 0 ? '+' : ''}${m.toFixed(1)} rpm (máx. ${Math.max(...d.map(Math.abs))} rpm).`));
  }
  root.append(h('h3', {}, 'Últimas medidas'));
  const last = [...D.resps].sort((a, b) => b.at - a.at).slice(0, 12);
  if (!last.length) root.append(h('p', { class: 'empty' }, 'Nenhuma medida ainda.'));
  for (const r of last) {
    const flags = [r.effort && 'esforço', r.mouthOpen && 'boca aberta', r.noisy && 'barulho', r.cough && 'tosse', r.gumAbnormal && 'gengiva'].filter(Boolean);
    root.append(h('button', { class: 'row', onclick: () => openRespEdit(r) },
      h('span', { class: 'row-time' }, fmtDateTime(r.at)), h('span', { class: `rpm-pill ${rpmCounts(r) && isRest(r.state) ? (r.rpm > th.rrRed ? 'red' : r.rpm > th.rrYellow ? 'yellow' : '') : 'dim'}` }, r.rpm ?? '—'),
      h('span', { class: 'row-text' }, `${STATE_LABEL[r.state] || r.state} · ${r.method === 'manual' ? 'manual' : r.method === 'auto' ? 'áudio' : 'áudio corrigido'}${r.confidence ? ` (${CONF_L[r.confidence]})` : ''}${flags.length ? ' · ⚠️ ' + flags.join(', ') : ''}${r.audioId ? ' 🔊' : ''}`)));
  }
  return root;
}
