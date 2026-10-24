// IndexedDB: um object store por tipo de registro, todos com keyPath 'id'.
export const STORES = ['patient', 'weights', 'meds', 'doseLogs', 'water', 'food', 'vomits', 'elims', 'resps', 'signs', 'photos', 'audios', 'settings'];
const BLOB_STORES = ['photos', 'audios'];
const DB_NAME = 'diario-recuperacao';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

let dbp;
function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => { result = r; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = (store) => run(store, 'readonly', (tx) => rq(tx.objectStore(store).getAll()));
export const get = (store, id) => run(store, 'readonly', (tx) => rq(tx.objectStore(store).get(id)));
export async function put(store, obj) {
  if (!obj.id) obj.id = uid();
  await run(store, 'readwrite', (tx) => rq(tx.objectStore(store).put(obj)));
  return obj;
}
export const del = (store, id) => run(store, 'readwrite', (tx) => rq(tx.objectStore(store).delete(id)));
export const clear = (store) => run(store, 'readwrite', (tx) => rq(tx.objectStore(store).clear()));

/** Carrega tudo (sem blobs) para a memória. */
export async function loadAll() {
  const d = {};
  for (const s of STORES) if (!BLOB_STORES.includes(s)) d[s] = await getAll(s);
  d.patient = d.patient.find((p) => p.id === 'main') || null;
  d.settings = d.settings.find((p) => p.id === 'main') || { id: 'main', acks: {}, calibrationDone: 0, notified: {} };
  d.photos = (await getAll('photos')).map(({ blob, ...meta }) => meta);
  d.audios = (await getAll('audios')).map(({ blob, ...meta }) => meta);
  return d;
}

/** Remove registros de exemplo (e o paciente de exemplo). */
export async function clearSample() {
  for (const s of STORES) {
    if (s === 'settings') continue;
    for (const r of await getAll(s)) if (r.sample) await del(s, r.id);
  }
}

const toDataUrl = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
const fromDataUrl = async (u) => (await fetch(u)).blob();

export async function exportJson() {
  const out = { app: 'diario-recuperacao', version: 1, exportedAt: Date.now(), data: {} };
  for (const s of STORES) {
    const rows = await getAll(s);
    out.data[s] = [];
    for (const r of rows) {
      if (BLOB_STORES.includes(s) && r.blob) out.data[s].push({ ...r, blob: await toDataUrl(r.blob) });
      else out.data[s].push(r);
    }
  }
  return out;
}

/** replace=true apaga tudo antes. */
export async function importJson(obj, { replace = true } = {}) {
  if (!obj || obj.app !== 'diario-recuperacao' || !obj.data) throw new Error('Arquivo de backup inválido.');
  if (replace) for (const s of STORES) await clear(s);
  for (const s of STORES) for (const r of obj.data[s] || []) {
    if (BLOB_STORES.includes(s) && typeof r.blob === 'string') r.blob = await fromDataUrl(r.blob);
    await put(s, r);
  }
}
