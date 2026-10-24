// Geradores de áudio sintético para testar o DSP.
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function noise(r) { return (r() + r() + r() + r() - 2) * 1.7; }
const bump = (t, c, w) => Math.exp(-0.5 * ((t - c) / w) ** 2);

/** bumps: [{offset, amp, width}] por respiração; ruído branco modulado por esse envelope. */
export function breathing({ fs = 16000, seconds = 30, rpm = 24, bumps = [{ offset: 0, amp: 1, width: 0.25 }], amp = 0.05, floor = 0.002, seed = 3, extra = null }) {
  const r = rng(seed), n = Math.round(fs * seconds), x = new Float32Array(n), T = 60 / rpm;
  for (let i = 0; i < n; i++) {
    const t = i / fs; let e = floor;
    const k0 = Math.floor((t - 0.5) / T);
    for (let k = k0 - 1; k <= k0 + 2; k++) for (const b of bumps) e += amp * b.amp * bump(t, 1 + k * T + b.offset, b.width);
    x[i] = e * noise(r) + (extra ? extra(t, r) : 0);
  }
  return x;
}
export function ambient({ fs = 16000, seconds = 3, level = 0.002, seed = 9 }) {
  const r = rng(seed), x = new Float32Array(Math.round(fs * seconds));
  for (let i = 0; i < x.length; i++) x[i] = level * noise(r);
  return x;
}
