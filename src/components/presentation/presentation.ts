/* Presentation mode: a tiny external store shared by the navbar button and
 * the controller mounted in Root. While on, <html data-presentation> drives
 * the CSS in presentation.css and --pres-scale sets the size of the text,
 * code blocks, demos and playgrounds.
 *
 * Playgrounds also keep their own zoom for use outside presentation mode. */

type Listener = () => void;

const SESSION_KEY = 'presentation:on';
const SCALE_KEY = 'presentation:scale';
const PLAYGROUND_ZOOM_KEY = 'playground:zoom';
export const MIN_SCALE = 1;
export const MAX_SCALE = 2.5;
export const DEFAULT_SCALE = 1.2;

let on = false;
let scale = DEFAULT_SCALE;
let playgroundZoom = 1;
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
export const getPlaygroundZoom = () => playgroundZoom;

const clamp = (n: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, n)) * 10) / 10;

function stored(key: string): number | undefined {
  const n = Number(read(() => localStorage, key));
  return n >= MIN_SCALE && n <= MAX_SCALE ? n : undefined;
}

/** Restores the mode and sizes after a reload (without full screen: that needs a gesture). */
export function restore() {
  scale = stored(SCALE_KEY) ?? scale;
  playgroundZoom = stored(PLAYGROUND_ZOOM_KEY) ?? playgroundZoom;
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
  scale = clamp(next);
  write(() => localStorage, SCALE_KEY, String(scale));
  apply();
}

export function setPlaygroundZoom(next: number) {
  playgroundZoom = clamp(next);
  write(() => localStorage, PLAYGROUND_ZOOM_KEY, String(playgroundZoom));
  apply();
}
