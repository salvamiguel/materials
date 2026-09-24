import React, { useMemo, useRef, useCallback } from 'react';
import { highlight } from './highlight';
import type { Diag } from './engine';
import styles from './playground.module.css';

interface Props {
  filename: string;
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diag[];
  readOnly?: boolean;
}

// A plain <textarea> on top of a highlighted <pre>: light, accessible and
// with native undo/redo, which is all a playground needs.
export default function HclEditor({ filename, value, onChange, diagnostics, readOnly }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
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

  const onScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    if (preRef.current) preRef.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-t.scrollTop}px)`;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const t = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = t;
      const insert = (text: string, caret: number) => {
        e.preventDefault();
        const next = value.slice(0, start) + text + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          t.selectionStart = t.selectionEnd = caret;
        });
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
    [value, onChange],
  );

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
        <textarea
          className={styles.codeInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          readOnly={readOnly}
          aria-label={`Editor de ${filename}`}
        />
      </div>
    </div>
  );
}
