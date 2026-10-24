// Gráficos SVG simples (sem bibliotecas). Cores vêm de classes CSS, funcionam no app e na impressão.
import { fmtShort, DAY } from './time.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Linha do tempo. points: [{t, v, kind?}], lines: [{v, cls, label}] */
export function lineChart({ points, from, to, yMin, yMax, lines = [], width = 340, height = 190, unit = '' }) {
  const m = { l: 34, r: 8, t: 10, b: 24 }, W = width - m.l - m.r, H = height - m.t - m.b;
  const x = (t) => m.l + ((t - from) / Math.max(1, to - from)) * W;
  const y = (v) => m.t + H - ((v - yMin) / (yMax - yMin)) * H;
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico">`;
  const step = (yMax - yMin) / 4;
  for (let i = 0; i <= 4; i++) {
    const v = yMin + i * step;
    s += `<line class="ch-grid" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-txt" x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  }
  const days = Math.max(1, Math.round((to - from) / DAY));
  const every = days > 8 ? 2 : 1;
  for (let i = 0; i <= days; i += every) {
    const t = from + i * DAY;
    if (t > to) break;
    s += `<text class="ch-txt" x="${x(t)}" y="${height - 6}" text-anchor="middle">${fmtShort(t)}</text>`;
  }
  for (const l of lines) {
    if (l.v < yMin || l.v > yMax) continue;
    s += `<line class="ch-ref ${l.cls || ''}" x1="${m.l}" x2="${width - m.r}" y1="${y(l.v)}" y2="${y(l.v)}"/><text class="ch-txt ${l.cls || ''}" x="${width - m.r}" y="${y(l.v) - 3}" text-anchor="end">${esc(l.label || '')}</text>`;
  }
  const pts = points.filter((p) => p.t >= from && p.t <= to).sort((a, b) => a.t - b.t);
  if (pts.length > 1) s += `<polyline class="ch-line" points="${pts.map((p) => `${x(p.t).toFixed(1)},${y(Math.min(yMax, Math.max(yMin, p.v))).toFixed(1)}`).join(' ')}"/>`;
  for (const p of pts) s += `<circle class="ch-dot ${p.kind || ''}" cx="${x(p.t).toFixed(1)}" cy="${y(Math.min(yMax, Math.max(yMin, p.v))).toFixed(1)}" r="3.2"><title>${p.v} ${unit}</title></circle>`;
  if (!pts.length) s += `<text class="ch-txt" x="${width / 2}" y="${height / 2}" text-anchor="middle">Sem medidas no período</text>`;
  return s + '</svg>';
}

/** Barras por dia com faixa de referência opcional. bars: [{label, v}] */
export function barChart({ bars, ref = null, width = 340, height = 170, unit = 'mL' }) {
  const m = { l: 40, r: 8, t: 12, b: 24 }, W = width - m.l - m.r, H = height - m.t - m.b;
  const top = Math.max(1, ...bars.map((b) => b.v), ref ? ref.max * 1.15 : 0) * 1.1;
  const y = (v) => m.t + H - (v / top) * H;
  const bw = W / bars.length;
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de barras">`;
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    s += `<line class="ch-grid" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-txt" x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  }
  if (ref) s += `<rect class="ch-band" x="${m.l}" y="${y(ref.max)}" width="${W}" height="${Math.max(1, y(ref.min) - y(ref.max))}"><title>Referência ${Math.round(ref.min)}–${Math.round(ref.max)} ${unit}</title></rect>`;
  bars.forEach((b, i) => {
    const x = m.l + i * bw + bw * 0.2;
    s += `<rect class="ch-bar" x="${x.toFixed(1)}" y="${y(b.v).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${(m.t + H - y(b.v)).toFixed(1)}" rx="3"><title>${Math.round(b.v)} ${unit}</title></rect>`;
    s += `<text class="ch-txt" x="${(x + bw * 0.3).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    if (b.v > 0) s += `<text class="ch-txt" x="${(x + bw * 0.3).toFixed(1)}" y="${(y(b.v) - 3).toFixed(1)}" text-anchor="middle">${Math.round(b.v)}</text>`;
  });
  return s + '</svg>';
}

/** Forma de onda com picos marcados (confirmação do áudio). */
export function waveChart({ signal, rate, peaks, width = 340, height = 130 }) {
  const m = { l: 6, r: 6, t: 8, b: 18 }, W = width - m.l - m.r, H = height - m.t - m.b;
  const n = signal.length, lo = Math.min(...signal, -1), hi = Math.max(...signal, 1);
  const x = (i) => m.l + (i / (n - 1)) * W;
  const y = (v) => m.t + H - ((v - lo) / (hi - lo)) * H;
  let s = `<svg class="chart wave" viewBox="0 0 ${width} ${height}" role="img" aria-label="Forma de onda da respiração">`;
  s += `<polyline class="ch-line" points="${signal.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
  const byBreath = {};
  peaks.forEach((p) => { if (p.breath >= 0) (byBreath[p.breath] ||= []).push(p); });
  Object.values(byBreath).forEach((pair) => {
    if (pair.length === 2) s += `<path class="ch-pair" d="M${x(pair[0].i).toFixed(1)},${(y(pair[0].a) - 10).toFixed(1)} v-4 H${x(pair[1].i).toFixed(1)} v4"/>`;
  });
  peaks.forEach((p) => {
    s += `<circle class="ch-peak ${p.role}" cx="${x(p.i).toFixed(1)}" cy="${y(p.a).toFixed(1)}" r="4.5"/>`;
  });
  const secs = (n - 1) / rate;
  for (let t = 0; t <= secs; t += 5) s += `<text class="ch-txt" x="${x(t * rate).toFixed(1)}" y="${height - 4}" text-anchor="middle">${t}s</text>`;
  return s + '</svg>';
}
