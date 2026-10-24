import { loadAll, put } from './db.js';

export const S = { D: null, route: 'home', dayOffset: 0, reportDays: 1, respDays: 3, histFilter: 'all' };
let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const render = () => renderFn();
export async function reload() { S.D = await loadAll(); renderFn(); }
export async function saveSettings(patch) {
  S.D.settings = { ...S.D.settings, ...patch, id: 'main' };
  await put('settings', S.D.settings);
}
export const nowMs = () => Date.now();
