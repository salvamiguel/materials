import React, { useMemo, useRef, useCallback, useEffect, useId, useLayoutEffect, useState } from 'react';
import {
  VscLoading,
  VscSymbolClass,
  VscSymbolConstant,
  VscSymbolField,
  VscSymbolKeyword,
  VscSymbolMethod,
  VscSymbolNamespace,
  VscSymbolStructure,
  VscSymbolVariable,
} from 'react-icons/vsc';
import { highlight } from './highlight';
import type { Diag } from './engine';
import type { CompletionItem, CompletionResult, ItemKind } from './completion/complete';
import { expandSnippet, type Stop } from './completion/snippet';
import styles from '../shared/playground.module.css';

interface Props {
  filename: string;
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diag[];
  readOnly?: boolean;
  /** Autocompletion at an offset of the (possibly unsaved) value. */
  complete?: (value: string, offset: number) => CompletionResult | undefined;
  /** Changes when completion data arrives (a provider schema): an open list is refreshed. */
  completionVersion?: number;
}

const KIND_ICON: Record<ItemKind, React.ComponentType> = {
  keyword: VscSymbolKeyword,
  block: VscSymbolStructure,
  attribute: VscSymbolField,
  type: VscSymbolClass,
  provider: VscSymbolNamespace,
  reference: VscSymbolVariable,
  function: VscSymbolMethod,
  value: VscSymbolConstant,
};

const KIND_LABEL: Record<ItemKind, string> = {
  keyword: 'palabra clave',
  block: 'bloque',
  attribute: 'argumento',
  type: 'tipo',
  provider: 'proveedor',
  reference: 'referencia',
  function: 'función',
  value: 'valor',
};

interface Popup {
  result: CompletionResult;
  caret: number;
  selected: number;
  /** Opened with Ctrl+Space or after inserting a snippet: shown even with nothing typed. */
  explicit: boolean;
}

/** Tab stops of the snippet being filled in; `at` is the current one (-1: none yet). */
interface Session {
  stops: Stop[];
  at: number;
}

const isWordChar = (c: string) => /[A-Za-z0-9_-]/.test(c);

/** Line and visual column (tabs are 2 wide, like tab-size in the CSS) of an offset. */
function lineCol(text: string, offset: number) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let line = 0;
  for (let i = 0; i < lineStart; i++) if (text[i] === '\n') line++;
  let col = 0;
  for (let i = lineStart; i < offset; i++) col += text[i] === '\t' ? 2 - (col % 2) : 1;
  return { line, col };
}

// A plain <textarea> on top of a highlighted <pre>: light, accessible and
// with native undo/redo, which is all a playground needs. Terraform files
// get a completion list like an IDE's (Ctrl+Space opens it by hand).
export default function HclEditor({ filename, value, onChange, diagnostics, readOnly, complete, completionVersion }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const session = useRef<Session | null>(null);
  // Selection to restore once React has written a programmatic edit into the
  // textarea (which moves the caret to the end). A layout effect runs before
  // the next keystroke, so fast typing never lands in the wrong place.
  const selectAfter = useRef<[number, number] | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [, setScrolled] = useState(0);
  const listId = useId();
  const tokens = useMemo(() => highlight(value, filename), [value, filename]);
  const lineCount = value.split('\n').length;

  const marks = useMemo(() => {
    const m = new Map<number, Diag>();
    for (const d of diagnostics) {
      if (!d.line) continue;
      const prev = m.get(d.line);
      if (!prev || (prev.severity === 'warning' && d.severity === 'error')) m.set(d.line, d);
    }
    return m;
  }, [diagnostics]);

  /** Opens (or refreshes) the list for the text and caret given. */
  const suggest = useCallback(
    (text: string, caret: number, explicit: boolean) => {
      const r = complete?.(text, caret);
      const typed = r ? text.slice(r.from, caret) : '';
      // Opened by typing: only while a word is being typed or right after "." or a quote.
      const worth = r && (explicit || typed !== '' || /["./]/.test(text[r.from - 1] ?? ''));
      if (!r || !worth || (!r.items.length && !r.pending && !explicit)) {
        setPopup(null);
        return;
      }
      setPopup((p) => {
        // Keep the item the user moved to when the list is refreshed around it.
        const prev = p && p.selected > 0 ? p.result.items[p.selected]?.label : undefined;
        const keep = prev ? r.items.findIndex((it) => it.label === prev) : -1;
        return { result: r, caret, selected: keep >= 0 && p?.result.from === r.from ? keep : 0, explicit: explicit || !!p?.explicit };
      });
    },
    [complete],
  );

  // A provider schema arrived: refresh an open list.
  useEffect(() => {
    const ta = taRef.current;
    if (ta && popup && document.activeElement === ta) suggest(ta.value, ta.selectionStart, popup.explicit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionVersion]);

  // Switching files closes the list and forgets the snippet.
  useEffect(() => {
    setPopup(null);
    session.current = null;
  }, [filename]);

  useLayoutEffect(() => {
    const sel = selectAfter.current;
    const ta = taRef.current;
    if (sel && ta) {
      selectAfter.current = null;
      ta.setSelectionRange(sel[0], sel[1]);
    }
  });

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [popup?.selected, popup?.result]);

  /** Every edit goes through here: keeps the snippet's tab stops in place. */
  const edit = useCallback(
    (next: string, editAt: number) => {
      const s = session.current;
      if (s) {
        const delta = next.length - value.length;
        const cur = s.stops[s.at];
        if (cur && (editAt < cur.start || editAt > cur.end)) {
          session.current = null; // edited outside the snippet
        } else {
          s.stops.forEach((st, k) => {
            if (k === s.at) st.end = Math.max(st.start, st.end + delta);
            else if (st.start >= editAt) {
              st.start += delta;
              st.end += delta;
            }
          });
        }
      }
      onChange(next);
    },
    [value, onChange],
  );

  const accept = useCallback(
    (it: CompletionItem) => {
      const ta = taRef.current;
      if (!ta || !popup) return;
      const { from, to } = popup.result;
      const lineStart = value.lastIndexOf('\n', from - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart))![0];
      const { text, stops } = expandSnippet(it.insert, indent);
      const next = value.slice(0, from) + text + value.slice(to);
      const delta = text.length - (to - from);
      // Stops of a snippet we were already filling in (resource "$1" "$2") come after this one's.
      const outer = session.current;
      const later = outer ? outer.stops.slice(outer.at + 1).map((s) => (s.start >= to ? { start: s.start + delta, end: s.end + delta } : s)) : [];
      const own = stops.map((s) => ({ start: from + s.start, end: from + s.end }));
      session.current =
        own.length > 1 ? { stops: [...own, ...later], at: 0 } : later.length ? { stops: later, at: -1 } : null;
      setPopup(null);
      selectAfter.current = [own[0].start, own[0].end];
      onChange(next);
      if (it.retrigger) suggest(next, own[0].end, true);
    },
    [popup, value, onChange, suggest],
  );

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const t = e.currentTarget;
      if (preRef.current) preRef.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`;
      if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-t.scrollTop}px)`;
      if (popup) setScrolled((n) => n + 1);
    },
    [popup],
  );

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const t = e.target;
      const next = t.value;
      const caret = t.selectionStart;
      const ev = e.nativeEvent as InputEvent;
      const typed = ev.inputType === 'insertText' ? ev.data ?? '' : '';
      edit(next, next.length >= value.length ? caret - (next.length - value.length) : caret);
      if (!complete) return;
      if (typed.length === 1 && (isWordChar(typed) || typed === '.' || typed === '"')) {
        if (/[0-9-]/.test(typed) && !popup) return; // numbers and minus signs don't open the list
        suggest(next, caret, false);
      } else if (popup && ev.inputType === 'deleteContentBackward') {
        suggest(next, caret, popup.explicit);
      } else if (popup) {
        setPopup(null);
      }
    },
    [edit, value, complete, popup, suggest],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const t = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = t;

      if (popup) {
        const n = popup.result.items.length;
        const move = (d: number) => {
          e.preventDefault();
          setPopup({ ...popup, selected: n ? (popup.selected + d + n) % n : 0 });
        };
        if (e.key === 'ArrowDown') return move(1);
        if (e.key === 'ArrowUp') return move(-1);
        if (e.key === 'PageDown') return move(Math.min(8, n - 1 - popup.selected) || 0);
        if (e.key === 'PageUp') return move(-Math.min(8, popup.selected) || 0);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPopup(null);
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && n) {
          e.preventDefault();
          accept(popup.result.items[popup.selected]);
          return;
        }
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Tab'].includes(e.key)) setPopup(null);
      }

      if (complete && e.key === ' ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        suggest(value, start, true);
        return;
      }

      const s = session.current;
      if (e.key === 'Escape' && s) {
        session.current = null;
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey && s && s.at + 1 < s.stops.length) {
        e.preventDefault();
        s.at++;
        const st = s.stops[s.at];
        t.setSelectionRange(st.start, st.end);
        if (s.at === s.stops.length - 1) session.current = null;
        return;
      }

      const insert = (text: string, caret: number) => {
        e.preventDefault();
        selectAfter.current = [caret, caret];
        edit(value.slice(0, start) + text + value.slice(end), start);
      };
      if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        insert('  ', start + 2);
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const indent = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
        const extra = /[{[(]\s*$/.test(value.slice(lineStart, start)) ? '  ' : '';
        insert('\n' + indent + extra, start + 1 + indent.length + extra.length);
      }
    },
    [popup, accept, complete, suggest, value, edit],
  );

  // Where the list goes: under the word being completed, or above it when
  // there is no room below.
  let popupStyle: React.CSSProperties | undefined;
  const ta = taRef.current;
  if (popup && ta) {
    const cs = getComputedStyle(ta);
    const font = parseFloat(cs.fontSize) || 13;
    const lh = parseFloat(cs.lineHeight) || font * 1.5;
    const cw = (measureRef.current?.getBoundingClientRect().width || font * 12) / 20;
    const { line, col } = lineCol(value, popup.result.from);
    const x = parseFloat(cs.paddingLeft) + col * cw - ta.scrollLeft;
    const yBelow = parseFloat(cs.paddingTop) + (line + 1) * lh - ta.scrollTop;
    const yAbove = yBelow - lh;
    const W = ta.clientWidth;
    const H = ta.clientHeight;
    const width = Math.min(font * 38, W - 8);
    const left = Math.max(4, Math.min(x - font * 1.9, W - width - 4));
    const below = H - yBelow;
    popupStyle =
      below >= Math.min(font * 16, H * 0.45) || yAbove < below
        ? { left, top: yBelow + 2, width, maxHeight: Math.max(below - 6, lh * 3) }
        : { left, bottom: H - yAbove + 2, width, maxHeight: Math.max(yAbove - 6, lh * 3) };
  }
  const selected = popup?.result.items[popup.selected];
  const typed = popup ? value.slice(popup.result.from, popup.caret) : '';

  return (
    <div className={styles.editor}>
      <div className={styles.gutter} aria-hidden="true">
        <div ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => {
            const d = marks.get(i + 1);
            return (
              <div
                key={i}
                className={d ? (d.severity === 'error' ? styles.gutterErr : styles.gutterWarn) : undefined}
                title={d ? `${d.summary}${d.detail ? '\n\n' + d.detail : ''}` : undefined}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.codeArea}>
        <pre ref={preRef} className={styles.codeHighlight} aria-hidden="true">
          {tokens.map((t, i) =>
            t.cls ? (
              <span key={i} className={styles['tk_' + t.cls]}>
                {t.text}
              </span>
            ) : (
              <React.Fragment key={i}>{t.text}</React.Fragment>
            ),
          )}
          {'\n'}
        </pre>
        <span ref={measureRef} className={styles.measure} aria-hidden="true">
          {'M'.repeat(20)}
        </span>
        <textarea
          ref={taRef}
          className={styles.codeInput}
          value={value}
          onChange={onInput}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onBlur={() => setPopup(null)}
          onMouseDown={() => {
            setPopup(null);
            session.current = null;
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          readOnly={readOnly}
          aria-label={`Editor de ${filename}`}
          aria-autocomplete={complete ? 'list' : undefined}
          aria-expanded={complete ? !!popup : undefined}
          aria-controls={popup ? listId : undefined}
          aria-activedescendant={popup && selected ? `${listId}-${popup.selected}` : undefined}
        />
        {popup && popupStyle && (
          // mousedown would blur the textarea and close the list before the click.
          <div className={styles.completion} style={popupStyle} onMouseDown={(e) => e.preventDefault()}>
            {popup.result.pending && (
              <div className={styles.completionPending}>
                <VscLoading className={styles.spin} aria-hidden /> {popup.result.pending}
              </div>
            )}
            {!popup.result.items.length && !popup.result.pending && <div className={styles.completionPending}>Sin sugerencias</div>}
            {popup.result.items.length > 0 && (
              <ul ref={listRef} id={listId} role="listbox" aria-label="Sugerencias" className={styles.completionList}>
                {popup.result.items.map((it, i) => {
                  const Icon = KIND_ICON[it.kind];
                  const bold = typed && it.label.toLowerCase().startsWith(typed.toLowerCase()) ? typed.length : 0;
                  return (
                    <li
                      key={it.kind + it.label}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === popup.selected}
                      className={`${styles.completionItem} ${i === popup.selected ? styles.completionActive : ''}`}
                      // Only real movement: a list opening under a resting pointer keeps its selection.
                      onMouseMove={(e) => (e.movementX || e.movementY) && i !== popup.selected && setPopup((p) => (p ? { ...p, selected: i } : p))}
                      onClick={() => accept(it)}
                    >
                      <span className={`${styles.completionIcon} ${styles['ck_' + it.kind]}`} title={KIND_LABEL[it.kind]}>
                        <Icon />
                      </span>
                      <span className={styles.completionLabel}>
                        <b>{it.label.slice(0, bold)}</b>
                        {it.label.slice(bold)}
                        {it.required && <i className={styles.completionRequired} title="obligatorio" />}
                      </span>
                      {it.detail && <span className={styles.completionDetail}>{it.detail}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {selected?.doc && <div className={styles.completionDoc}>{selected.doc}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
