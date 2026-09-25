/* Presentation mode: a tiny external store shared by the navbar button and
 * the controller mounted in Root. While on, <html data-presentation> drives
 * the CSS in presentation.css and --pres-scale sets the text size. */

type Listener = () => void;

const SESSION_KEY = 'presentation:on';
const SCALE_KEY = 'presentation:scale';
export const MIN_SCALE = 1;
export const MAX_SCALE = 1.8;

let on = false;
let scale = 1.2;
const listeners = new Set<Listener>();

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // private mode / blocked storage: the mode still works, it just isn't remembered
  }
}

function apply() {
  const root = document.documentElement;
  if (on) root.dataset.presentation = '';
  else delete root.dataset.presentation;
  root.style.setProperty('--pres-scale', String(scale));
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const isOn = () => on;
export const getScale = () => scale;

/** Restores the mode and text size after a reload (without full screen: that needs a gesture). */
export function restore() {
  const s = Number(read(() => localStorage, SCALE_KEY));
  if (s >= MIN_SCALE && s <= MAX_SCALE) scale = s;
  on = read(() => sessionStorage, SESSION_KEY) === '1';
  apply();
}

export function enter(fullscreen = true) {
  on = true;
  write(() => sessionStorage, SESSION_KEY, '1');
  apply();
  if (fullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
}

export function exit() {
  on = false;
  write(() => sessionStorage, SESSION_KEY, null);
  apply();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
}

export function toggle() {
  if (on) exit();
  else enter();
}

export function setScale(next: number) {
  scale = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) * 10) / 10;
  write(() => localStorage, SCALE_KEY, String(scale));
  apply();
}
