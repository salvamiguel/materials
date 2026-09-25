import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from '@docusaurus/router';
import { TbChevronLeft, TbChevronRight, TbMinus, TbPlus, TbX } from 'react-icons/tb';
import { exit, getScale, isOn, MAX_SCALE, MIN_SCALE, restore, setScale, subscribe, toggle } from './presentation';

const HINT_KEY = 'presentation:hinted';

/** Keys are ignored while typing or when a widget uses the arrows itself. */
function ownsKeys(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tab"], [role="textbox"], [role="slider"]');
}

function headings(): HTMLElement[] {
  const root = document.querySelector('.theme-doc-markdown') ?? document.querySelector('main');
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3')).filter((h) => h.offsetParent !== null);
}

/** Section being read after a manual scroll: the last heading near the top of the viewport. */
function positionalIndex(hs: HTMLElement[]): number {
  if (window.scrollY < 5) return 0;
  const line = Math.min(window.innerHeight * 0.25, 140);
  let cur = 0;
  hs.forEach((h, i) => {
    if (h.getBoundingClientRect().top <= line) cur = i;
  });
  return cur;
}

const headingText = (h?: HTMLElement) => (h?.textContent ?? '').replace(/​|#$/g, '').trim();

export default function PresentationController() {
  const active = useSyncExternalStore(subscribe, isOn, () => false);
  const scale = useSyncExternalStore(subscribe, getScale, () => 1.2);
  const location = useLocation();
  const [pos, setPos] = useState({ index: 0, total: 0, title: '' });
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(false);
  const marked = useRef<HTMLElement | null>(null);
  // The section reached with the keys/buttons. Short sections near the end of
  // a page can't scroll to the top, so position alone would skip or stall.
  const pinned = useRef<number | null>(null);
  const currentIndex = useCallback(
    (hs: HTMLElement[]) => (pinned.current !== null && pinned.current < hs.length ? pinned.current : positionalIndex(hs)),
    [],
  );

  const refresh = useCallback(() => {
    if (!isOn()) return;
    const hs = headings();
    const index = currentIndex(hs);
    const h = hs[index];
    if (marked.current !== h) {
      marked.current?.removeAttribute('data-pres-current');
      h?.setAttribute('data-pres-current', '');
      marked.current = h ?? null;
    }
    setPos({ index, total: hs.length, title: headingText(h) });
  }, [currentIndex]);

  const go = useCallback((dir: 1 | -1 | 'first' | 'last') => {
    const hs = headings();
    const cur = currentIndex(hs);
    let target: number;
    if (dir === 'first') target = 0;
    else if (dir === 'last') target = hs.length - 1;
    else if (dir === 1) target = cur + 1;
    // Inside a long section, "back" first returns to its own heading.
    else target = hs[cur] && hs[cur].getBoundingClientRect().top < -40 ? cur : cur - 1;

    if (target >= hs.length || (target < 0 && dir === -1)) {
      // Past the ends: continue with the next / previous lesson.
      const link = document.querySelector<HTMLAnchorElement>(`.pagination-nav__link--${dir === 1 ? 'next' : 'prev'}`);
      link?.click();
      return;
    }
    target = Math.max(0, target);
    pinned.current = target;
    hs[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refresh();
  }, [currentIndex, refresh]);

  // Scrolling by hand (wheel, touch, scrollbar, arrow up/down) unpins the section.
  useEffect(() => {
    const unpin = () => {
      pinned.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') unpin();
    };
    window.addEventListener('wheel', unpin, { passive: true });
    window.addEventListener('touchstart', unpin, { passive: true });
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.presentation-hud'))) unpin();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', unpin);
      window.removeEventListener('touchstart', unpin);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    pinned.current = null;
  }, [location.pathname]);

  // Restore after a reload; leaving full screen (Esc is taken by the browser) leaves the mode.
  useEffect(() => {
    restore();
    let hadFullscreen = false;
    const onFs = () => {
      if (document.fullscreenElement) hadFullscreen = true;
      else if (hadFullscreen) {
        hadFullscreen = false;
        if (isOn()) exit();
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ownsKeys(e.target)) return;
      const key = e.key;
      if (key === 'p' || key === 'P') {
        e.preventDefault();
        toggle();
        return;
      }
      if (!isOn()) return;
      const actions: Record<string, () => void> = {
        Escape: exit,
        ArrowRight: () => go(1),
        PageDown: () => go(1),
        ' ': () => go(e.shiftKey ? -1 : 1),
        ArrowLeft: () => go(-1),
        PageUp: () => go(-1),
        Home: () => go('first'),
        End: () => go('last'),
        '+': () => setScale(getScale() + 0.1),
        '=': () => setScale(getScale() + 0.1),
        '-': () => setScale(getScale() - 0.1),
        '0': () => setScale(1.2),
      };
      const action = actions[key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Track the current section while on.
  useEffect(() => {
    if (!active) {
      marked.current?.removeAttribute('data-pres-current');
      marked.current = null;
      return;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    // The new page renders after the location changes.
    const t = setTimeout(refresh, 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [active, location.pathname, refresh, scale]);

  // Fade the controls when the mouse rests; show the key hint the first time.
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener('mousemove', wake);
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        localStorage.setItem(HINT_KEY, '1');
        setHint(true);
        hintTimer = setTimeout(() => setHint(false), 7000);
      }
    } catch {
      // storage blocked: skip the hint
    }
    return () => {
      clearTimeout(timer);
      if (hintTimer) clearTimeout(hintTimer);
      window.removeEventListener('mousemove', wake);
    };
  }, [active]);

  if (!active) return null;
  return (
    <div className={`presentation-hud${idle && !hint ? ' presentation-hud--idle' : ''}`} role="toolbar" aria-label="Modo presentación">
      {hint && (
        <div className="presentation-hint">
          <kbd>←</kbd> <kbd>→</kbd> secciones · <kbd>+</kbd> <kbd>−</kbd> tamaño · <kbd>P</kbd> / <kbd>Esc</kbd> salir
        </div>
      )}
      <div className="presentation-bar">
        <button type="button" onClick={() => go(-1)} title="Sección anterior (←)" aria-label="Sección anterior">
          <TbChevronLeft />
        </button>
        <span className="presentation-pos" title={pos.title}>
          <b>{pos.total ? pos.index + 1 : 0}</b>/{pos.total}
          {pos.title && <span className="presentation-title"> · {pos.title}</span>}
        </span>
        <button type="button" onClick={() => go(1)} title="Sección siguiente (→)" aria-label="Sección siguiente">
          <TbChevronRight />
        </button>
        <span className="presentation-sep" />
        <button type="button" onClick={() => setScale(scale - 0.1)} disabled={scale <= MIN_SCALE} title="Texto más pequeño (−)" aria-label="Texto más pequeño">
          <TbMinus />
        </button>
        <span className="presentation-scale">{Math.round(scale * 100)} %</span>
        <button type="button" onClick={() => setScale(scale + 0.1)} disabled={scale >= MAX_SCALE} title="Texto más grande (+)" aria-label="Texto más grande">
          <TbPlus />
        </button>
        <span className="presentation-sep" />
        <button type="button" onClick={exit} title="Salir (Esc)" aria-label="Salir del modo presentación">
          <TbX />
        </button>
      </div>
    </div>
  );
}
