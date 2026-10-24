// Captura de áudio do microfone, sem processamento do navegador (eco/ruído/ganho desligados).
// O áudio é analisado no próprio aparelho (breath.js); nada é enviado à internet.

export async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Este navegador não permite usar o microfone (é preciso abrir o app por HTTPS).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const st = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
  const stillOn = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((k) => st[k] === true);
  return { stream, warning: stillOn.length ? `Seu navegador manteve ligado: ${stillOn.join(', ')}. Isso pode apagar o som da respiração; se a medida falhar, conte manualmente.` : null };
}

const WORKLET = `class Cap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor('cap',Cap);`;

/** Cria o grafo de captura. Retorna {fs, collect(ms,onLevel), recordClip(s,onTick), close}. */
export async function createCapture(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  let sink = null;
  const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
  const listeners = new Set();
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'cap');
    node.port.onmessage = (e) => listeners.forEach((fn) => fn(e.data));
    src.connect(node); node.connect(mute); sink = node;
  } else {
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); listeners.forEach((fn) => fn(d.slice(0))); };
    src.connect(node); node.connect(mute); sink = node;
  }
  const rmsOf = (c) => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * c[i]; return Math.sqrt(s / c.length); };
  const concat = (chunks) => { const n = chunks.reduce((s, c) => s + c.length, 0), out = new Float32Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };

  function collect(seconds, { onTick, onLevel } = {}) {
    return new Promise((resolve) => {
      const chunks = [], t0 = performance.now();
      const fn = (c) => { chunks.push(c); onLevel && onLevel(rmsOf(c)); };
      listeners.add(fn);
      const timer = setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        onTick && onTick(Math.min(seconds, el));
        if (el >= seconds) { clearInterval(timer); listeners.delete(fn); resolve(concat(chunks)); }
      }, 100);
    });
  }

  /** Grava `seconds` s: devolve PCM (para análise) e um Blob comprimido (para guardar/ouvir). */
  async function recordClip(seconds, opts = {}) {
    let rec = null, parts = [], mime = '';
    if (window.MediaRecorder) {
      const cand = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      mime = cand.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      try {
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
        rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
        rec.start();
      } catch { rec = null; }
    }
    const samples = await collect(seconds, opts);
    let blob = null;
    if (rec) {
      blob = await new Promise((res) => { rec.onstop = () => res(new Blob(parts, { type: rec.mimeType || mime })); rec.stop(); });
    }
    return { samples, fs: ctx.sampleRate, blob };
  }

  function close() {
    try { sink.disconnect(); src.disconnect(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }
  return { fs: ctx.sampleRate, collect, recordClip, close };
}
