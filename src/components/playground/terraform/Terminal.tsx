import React, { useEffect, useMemo, useRef, useState } from 'react';
import { colorizeOutput } from './highlight';
import styles from './playground.module.css';

export interface TermEntry {
  id: number;
  prompt: string;
  command: string;
  output: string;
  exitCode?: number;
  pending?: boolean;
}

interface Props {
  entries: TermEntry[];
  prompt: string;
  busy: boolean;
  onCommand: (line: string) => void;
  suggestions: string[];
}

function Output({ text }: { text: string }) {
  const lines = useMemo(() => colorizeOutput(text), [text]);
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={styles.termLine}>
          {l.tokens.length === 0 ? ' ' : null}
          {l.tokens.map((t, j) =>
            t.cls ? (
              <span key={j} className={t.cls.split(' ').map((c) => styles['c_' + c]).join(' ')}>
                {t.text}
              </span>
            ) : (
              <React.Fragment key={j}>{t.text}</React.Fragment>
            ),
          )}
        </div>
      ))}
    </>
  );
}

export default function Terminal({ entries, prompt, busy, onCommand, suggestions }: Props) {
  const [input, setInput] = useState('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useMemo(() => entries.map((e) => e.command).filter(Boolean), [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const submit = () => {
    const line = input.trim();
    setInput('');
    setHistIdx(null);
    onCommand(line);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!busy) submit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      let idx = histIdx === null ? history.length : histIdx;
      idx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(history.length, idx + 1);
      setHistIdx(idx);
      setInput(idx === history.length ? '' : history[idx]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const match = suggestions.find((s) => s.startsWith(input) && s !== input);
      if (match) setInput(match);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      onCommand('clear');
    }
  };

  return (
    <div className={styles.terminal} onClick={() => window.getSelection()?.toString() || inputRef.current?.focus()}>
      <div ref={scrollRef} className={styles.termScroll} role="log" aria-live="polite">
        {entries.map((e) => (
          <div key={e.id} className={styles.termEntry}>
            {e.command !== undefined && (
              <div className={styles.termLine}>
                <span className={styles.c_prompt}>{e.prompt}</span>
                {e.command}
              </div>
            )}
            {e.pending ? <div className={`${styles.termLine} ${styles.c_dim}`}>…</div> : <Output text={e.output} />}
          </div>
        ))}
        <div className={styles.termInputLine}>
          <span className={styles.c_prompt}>{prompt}</span>
          <input
            ref={inputRef}
            className={styles.termInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Línea de comandos de terraform"
            placeholder={busy ? '' : 'plan, apply, state list, console…'}
          />
        </div>
      </div>
    </div>
  );
}
