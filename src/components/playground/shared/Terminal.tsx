import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './playground.module.css';

export interface TermEntry {
  id: number;
  prompt: string;
  command: string;
  output: string;
  exitCode?: number;
  pending?: boolean;
}

export interface OutToken {
  text: string;
  /** Space-separated colour classes; each maps to `styles.c_<name>`. */
  cls?: string;
}

export interface OutLine {
  tokens: OutToken[];
  /** Keep on one line even in wrap mode (tables). */
  nowrap?: boolean;
}

const plain = (text: string): OutLine[] =>
  text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => ({ tokens: line ? [{ text: line }] : [] }));

interface Props {
  entries: TermEntry[];
  prompt: string;
  busy: boolean;
  onCommand: (line: string) => void;
  /** Static completions: Tab picks the first one that extends the current input. */
  suggestions?: string[];
  /** Context-aware completion; returns the new input, or undefined for no match. */
  complete?: (input: string) => string | undefined;
  colorize?: (text: string) => OutLine[];
  ariaLabel?: string;
  placeholder?: string;
  /** Hides the typed characters (for secret prompts). */
  secret?: boolean;
  /** Puts text in the input line (e.g. a command clicked in a side panel); bump `seq` to repeat. */
  insert?: { text: string; seq: number };
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
}

function Output({ text, colorize, wrap }: { text: string; colorize: (text: string) => OutLine[]; wrap: boolean }) {
  const lines = useMemo(() => colorize(text), [text, colorize]);
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={`${styles.termLine} ${wrap && !l.nowrap ? styles.termWrap : ''}`}>
          {l.tokens.length === 0 ? ' ' : null}
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

export default function Terminal({
  entries,
  prompt,
  busy,
  onCommand,
  suggestions = [],
  complete,
  colorize = plain,
  ariaLabel = 'Línea de comandos',
  placeholder = '',
  secret = false,
  insert,
  wrap = false,
}: Props) {
  const [input, setInput] = useState('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useMemo(() => entries.map((e) => e.command).filter(Boolean), [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  useEffect(() => {
    if (!insert) return;
    setInput(insert.text);
    setHistIdx(null);
    inputRef.current?.focus();
  }, [insert]);

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
      const next = complete?.(input) ?? suggestions.find((s) => s.startsWith(input) && s !== input);
      if (next !== undefined) setInput(next);
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
              <div className={`${styles.termLine} ${wrap ? styles.termWrap : ''}`}>
                <span className={styles.c_prompt}>{e.prompt}</span>
                {e.command}
              </div>
            )}
            {e.pending ? (
              <div className={`${styles.termLine} ${styles.c_dim}`}>…</div>
            ) : (
              <Output text={e.output} colorize={colorize} wrap={wrap} />
            )}
          </div>
        ))}
        <div className={styles.termInputLine}>
          <span className={styles.c_prompt}>{prompt}</span>
          <input
            ref={inputRef}
            className={styles.termInput}
            type={secret ? 'password' : 'text'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label={ariaLabel}
            placeholder={busy ? '' : placeholder}
          />
        </div>
      </div>
    </div>
  );
}
