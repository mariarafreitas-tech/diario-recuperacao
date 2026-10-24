// Contagem de respiração por áudio. 100% local, sem DOM (testável no Node).
// Pipeline: passa-banda 150–2000 Hz → envelope RMS (janela 50 ms) → suavização + remoção da variação lenta
// → frequência por autocorrelação (confirmada por FFT) → contagem de picos (com agrupamento inspiração/expiração)
// → qualidade (ruído, latido, movimento, ofego) → confiança.

export const BAND = { lo: 150, hi: 2000 };
export const F_MIN = 0.1, F_MAX = 1.5; // 6 a 90 rpm
export const AMBIENT_HIGH_DB = -48;    // heurística: acima disto o ambiente está barulhento demais
export const AMBIENT_MID_DB = -55;

function biquad(type, fs, f0, Q = Math.SQRT1_2) {
  const w0 = 2 * Math.PI * f0 / fs, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
  const hp = type === 'hp';
  const b0 = hp ? (1 + cos) / 2 : (1 - cos) / 2;
  const b1 = hp ? -(1 + cos) : 1 - cos;
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}
function runBiquad(c, x) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** Passa-banda de 4ª ordem (2 HP + 2 LP em cascata). */
export function bandpass(x, fs, lo = BAND.lo, hi = BAND.hi) {
  hi = Math.min(hi, fs * 0.45);
  let y = runBiquad(biquad('hp', fs, lo), x);
  y = runBiquad(biquad('hp', fs, lo), y);
  y = runBiquad(biquad('lp', fs, hi), y);
  return runBiquad(biquad('lp', fs, hi), y);
}
export function lowpass(x, fs, f0) { return runBiquad(biquad('lp', fs, f0), runBiquad(biquad('lp', fs, f0), x)); }

/** Envelope RMS: janela winMs, passo hopMs. */
export function rmsEnvelope(x, fs, winMs = 50, hopMs = 25) {
  const win = Math.max(1, Math.round(fs * winMs / 1000)), hop = Math.max(1, Math.round(fs * hopMs / 1000));
  const cum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i] * x[i];
  const n = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.sqrt((cum[i * hop + win] - cum[i * hop]) / win);
  return { env, rate: fs / hop };
}

function movingAverage(x, w) {
  w = Math.max(1, Math.round(w));
  const n = x.length, cum = new Float64Array(n + 1), out = new Float64Array(n);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + x[i];
  const h = Math.floor(w / 2);
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); out[i] = (cum[b] - cum[a]) / (b - a); }
  return out;
}
const dbfs = (v) => 20 * Math.log10(Math.max(v, 1e-9));
function percentile(arr, p) { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; }
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

/** Mede os ~3 s de ruído ambiente. */
export function assessAmbient(x, fs) {
  const bandDb = dbfs(rms(bandpass(x, fs)));
  const level = bandDb > AMBIENT_HIGH_DB ? 'alto' : bandDb > AMBIENT_MID_DB ? 'medio' : 'baixo';
  return { bandDb, level, rms: rms(bandpass(x, fs)) };
}

/** Grupos contíguos de quadros do envelope muito acima do nível normal (latido, batida, lambedura). */
export function spikeGroups(env, factor = 5) {
  const ref = Math.max(percentile(env, 0.9), 1e-9);
  const groups = [];
  let cur = null;
  for (let i = 0; i < env.length; i++) {
    if (env[i] > factor * ref) { if (!cur) groups.push((cur = { start: i, end: i })); else cur.end = i; } else cur = null;
  }
  return groups;
}

function ftPower(x, rate, freqs) {
  const n = x.length;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  return freqs.map((f) => {
    let re = 0, im = 0; const k = (2 * Math.PI * f) / rate;
    for (let i = 0; i < n; i++) { re += w[i] * Math.cos(k * i); im -= w[i] * Math.sin(k * i); }
    return (re * re + im * im) / n;
  });
}

function acfEstimate(x, rate) {
  const n = x.length;
  const lmin = Math.max(1, Math.round(rate / F_MAX)), lmax = Math.min(Math.round(rate * 10), Math.floor(n * 0.6));
  if (lmax <= lmin + 2) return null;
  const cum2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum2[i + 1] = cum2[i] + x[i] * x[i];
  const r = new Float64Array(lmax + 2);
  for (let L = 1; L <= lmax + 1 && L < n; L++) {
    let s = 0; for (let i = 0; i + L < n; i++) s += x[i] * x[i + L];
    const den = Math.sqrt((cum2[n - L] - cum2[0]) * (cum2[n] - cum2[L]));
    r[L] = den > 0 ? s / den : 0;
  }
  const peaks = [];
  for (let L = lmin; L <= lmax; L++) if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] > 0.05) peaks.push(L);
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map((L) => r[L]));
  let L1 = peaks.find((L) => r[L] >= 0.85 * best);
  let alternating = false;
  const L2 = peaks.find((L) => Math.abs(L - 2 * L1) <= Math.max(2, 0.1 * L1));
  if (L2 && r[L2] > r[L1] + 0.1) { L1 = L2; alternating = true; }
  const a = r[L1 - 1], b = r[L1], c = r[L1 + 1];
  const den = a - 2 * b + c;
  const L = den !== 0 ? L1 + (0.5 * (a - c)) / den : L1;
  return { freq: rate / L, strength: r[L1], alternating, r, lag: L };
}

function fftEstimate(x, rate) {
  const freqs = []; for (let f = 0.08; f <= 1.6; f += 0.01) freqs.push(f);
  const P = ftPower(x, rate, freqs);
  let bi = -1;
  freqs.forEach((f, i) => { if (f >= F_MIN && f <= F_MAX && (bi < 0 || P[i] > P[bi])) bi = i; });
  let f = freqs[bi];
  // subharmônico: se há energia em f/2, a respiração é f/2 (dois picos por ciclo)
  const half = f / 2;
  if (half >= F_MIN) {
    let sub = 0; freqs.forEach((ff, i) => { if (Math.abs(ff - half) <= 0.06 * half + 0.01) sub = Math.max(sub, P[i]); });
    if (sub >= 0.3 * P[bi]) f = half;
  }
  return { freq: f, power: P[bi] };
}

function pickPeaks(sig, rate, minGapS = 0.25, thr = 0.3) {
  const cand = [];
  for (let i = 1; i < sig.length - 1; i++) if (sig[i] > thr && sig[i] >= sig[i - 1] && sig[i] > sig[i + 1]) cand.push(i);
  const minGap = Math.round(minGapS * rate), kept = [];
  for (const i of cand) {
    const last = kept[kept.length - 1];
    if (last !== undefined && i - last < minGap) { if (sig[i] > sig[last]) kept[kept.length - 1] = i; } else kept.push(i);
  }
  return kept.map((i) => ({ i, t: i / rate, a: sig[i] }));
}

/** Agrupa picos em respirações. paired=true: pares (inspiração+expiração). Marca role/breath em cada pico. */
export function groupPeaks(peaks, paired) {
  const ps = peaks.map((p) => ({ ...p, role: 'single', breath: -1 }));
  const breaths = [];
  if (!paired) {
    ps.forEach((p, k) => { p.breath = k; breaths.push(p.t); });
  } else {
    // fase: pares com intervalo interno menor; senão, começa no pico mais forte
    const gaps = ps.slice(1).map((p, i) => p.t - ps[i].t);
    const m = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const ev = m(gaps.filter((_, i) => i % 2 === 0)), od = m(gaps.filter((_, i) => i % 2 === 1));
    let phase = 0;
    if (Math.abs(ev - od) > 0.15 * Math.max(ev, od, 1e-9)) phase = ev < od ? 0 : 1;
    else {
      const ae = m(ps.filter((_, i) => i % 2 === 0).map((p) => p.a)), ao = m(ps.filter((_, i) => i % 2 === 1).map((p) => p.a));
      phase = ae >= ao ? 0 : 1;
    }
    if (phase === 1 && ps[0]) { ps[0].role = 'single'; }
    let b = 0;
    for (let k = phase; k + 1 < ps.length; k += 2) {
      ps[k].role = 'insp'; ps[k + 1].role = 'exp'; ps[k].breath = ps[k + 1].breath = b++;
      breaths.push((ps[k].t + ps[k + 1].t) / 2);
    }
  }
  const span = breaths.length >= 2 ? breaths[breaths.length - 1] - breaths[0] : 0;
  const rpm = breaths.length >= 4 && span > 0 ? ((breaths.length - 1) / span) * 60 : null;
  return { peaks: ps, breaths, rpmPeaks: rpm };
}

const MSG = {
  muito_curto: 'Gravação muito curta.',
  ruido_ambiente: 'Ambiente barulhento demais (TV, ventilador, conversa).',
  sinal_fraco: 'Som da respiração muito fraco: aproxime o celular (10–30 cm) do focinho/peito.',
  latido: 'Houve latido, lambedura ou barulho súbito durante a gravação.',
  movimento: 'Houve movimento ou manuseio do celular durante a gravação.',
  ofego: 'A cadela estava ofegante: não dá para medir por áudio.',
  sem_ritmo: 'Não foi encontrado um ritmo de respiração regular.',
  saturado: 'O áudio saturou (som alto demais).',
};
export const invalidMessage = (reason) => `Não foi possível medir, tente de novo ou conte manualmente. (${MSG[reason] || reason})`;

/**
 * Analisa a gravação. ambientRms = RMS (banda) do ruído medido antes. Retorna sempre um objeto;
 * valid=false com reason quando a medida deve ser descartada.
 */
export function analyzeBreathing(samples, fs, { ambientRms = null, maxRpm = 90 } = {}) {
  const durationS = samples.length / fs;
  const base = { valid: false, durationS, fs };
  if (durationS < 15) return { ...base, reason: 'muito_curto', message: invalidMessage('muito_curto') };

  let clipped = 0; for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > 0.98) clipped++;
  const band = bandpass(samples, fs);
  const bandRms = rms(band);
  const { env, rate } = rmsEnvelope(band, fs, 50, 25);
  const quality = {
    bandDb: dbfs(bandRms), ambientDb: ambientRms != null ? dbfs(ambientRms) : null,
    clippedPct: (100 * clipped) / samples.length, snrDb: ambientRms ? dbfs(bandRms / ambientRms) : null,
  };
  const fail = (reason, extra = {}) => ({ ...base, reason, message: invalidMessage(reason), quality, ...extra });

  if (quality.clippedPct > 0.1) return fail('saturado');
  if (ambientRms != null && quality.ambientDb > AMBIENT_HIGH_DB) return fail('ruido_ambiente');
  if (ambientRms && bandRms < 2 * ambientRms) return fail('sinal_fraco');
  if (bandRms < 1e-5) return fail('sinal_fraco');

  if (spikeGroups(env, 4).length > 0) return fail('latido');
  const low = rmsEnvelope(lowpass(samples, fs, 100), fs, 50, 25).env;
  if (spikeGroups(low, 6).length > 0) return fail('movimento');

  // envelope suave, sem variação lenta, normalizado
  let sm = movingAverage(movingAverage(env, 0.1 * rate), 0.1 * rate);
  const trend = movingAverage(sm, 8 * rate);
  let sig = sm.map((v, i) => v - trend[i]);
  const sd = Math.sqrt(sig.reduce((s, v) => s + v * v, 0) / sig.length) || 1;
  sig = sig.map((v) => v / sd);

  const fft = fftEstimate(sig, rate);
  const acf = acfEstimate(sig, rate);
  // ofego: envelope varia mais rápido que 90 rpm (1,5 Hz)
  const hi = ftPower(sig, rate, [1.8, 2.2, 2.6, 3, 3.5, 4, 5]).reduce((m, v) => Math.max(m, v), 0);
  const lowGrid = []; for (let f = 0.1; f <= 1.5; f += 0.05) lowGrid.push(f);
  const lowBand = ftPower(sig, rate, lowGrid).reduce((m, v) => Math.max(m, v), 0);
  if (hi > 1.2 * lowBand) return fail('ofego');
  if (!acf || acf.strength < 0.2) return fail('sem_ritmo', { acfStrength: acf ? acf.strength : 0 });

  const fAcf = acf.freq, fFft = fft.freq;
  const specDisagree = Math.abs(fAcf - fFft) / fAcf > 0.15;
  const fEst = fAcf;
  const rpmSpec = fEst * 60;
  if (rpmSpec > maxRpm + 5) return fail('ofego');

  // picos: decide agrupamento pela razão taxa de picos / frequência estimada
  const raw = pickPeaks(sig, rate);
  const rawStats = groupPeaks(raw, false);
  const peakRate = raw.length >= 2 ? ((raw.length - 1) / (raw[raw.length - 1].t - raw[0].t)) : 0;
  const ratio = fEst > 0 ? peakRate / fEst : 0;
  const paired = ratio > 1.6 && ratio < 2.5;
  const g = groupPeaks(raw, paired);
  const rpmPeaks = g.rpmPeaks;

  const divergence = rpmPeaks ? Math.abs(rpmPeaks - rpmSpec) / rpmSpec : null;
  // pares sem evidência de alternância e ritmo alto: ambíguo (pode ser 2 picos por respiração)
  const ambiguous = !paired && !acf.alternating && rpmSpec >= 40;
  let confidence;
  if (rpmPeaks == null || divergence > 0.15 || specDisagree && divergence > 0.08) confidence = 'baixa';
  else if (acf.strength >= 0.5 && divergence <= 0.08 && g.breaths.length >= 6 && !ambiguous && !specDisagree) confidence = 'alta';
  else confidence = acf.strength >= 0.3 ? 'media' : 'baixa';
  if (quality.ambientDb != null && quality.ambientDb > AMBIENT_MID_DB && confidence === 'alta') confidence = 'media';

  const rpm = Math.round(rpmPeaks != null && divergence <= 0.15 ? rpmPeaks : rpmSpec);
  return {
    valid: true, durationS, fs, rpm, rpmSpec, rpmPeaks, rpmFft: fFft * 60, divergence,
    confidence, paired, alternating: acf.alternating, ambiguous, acfStrength: acf.strength, specDisagree,
    peaks: g.peaks, breaths: g.breaths, rawPeaks: raw, rate, signal: Array.from(sig, (v) => +v.toFixed(3)),
    quality, rawStats,
  };
}

/** Reagrupa os picos (botão "agrupar 2 a 2") sem reprocessar o áudio. */
export function regroup(result, paired) {
  const g = groupPeaks(result.rawPeaks, paired);
  const rpmPeaks = g.rpmPeaks;
  return { ...result, paired, peaks: g.peaks, breaths: g.breaths, rpmPeaks, rpm: Math.round(rpmPeaks != null ? rpmPeaks : result.rpmSpec) };
}
