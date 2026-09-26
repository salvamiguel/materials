import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuItem } from './info';
import styles from './k8s.module.css';

interface Props {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
  onPick: (item: MenuItem) => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, title, items, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll('button') ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={styles.menu} style={pos} role="menu" aria-label={title} onContextMenu={(e) => e.preventDefault()}>
      <div className={styles.menuTitle}>{title}</div>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className={styles.menuSep} role="separator">
            {it.label}
          </div>
        ) : (
          <button key={i} type="button" role="menuitem" className={`${styles.menuItem} ${it.danger ? styles.menuDanger : ''}`} onClick={() => onPick(it)}>
            <span>{it.label}</span>
            {it.hint && <span className={styles.menuHint}>{it.hint}</span>}
            {it.cmd && <span className={styles.menuCmd}>$ {it.cmd}</span>}
          </button>
        ),
      )}
    </div>
  );
}
