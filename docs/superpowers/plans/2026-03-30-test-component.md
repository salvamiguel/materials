# Test & ModuleTest Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a quiz/test system with 4 question types, localStorage persistence, timer, and a module-level progress card.

**Architecture:** Composable modular — types.ts as the shared contract, 3 hooks for timer/storage/drag, 4 question components, an orchestrator `<Test>`, and a container `<ModuleTest>`. All wrapped in the existing `.demo-wrapper` style.

**Tech Stack:** React 19, TypeScript, CSS Modules, localStorage, react-icons, CSS variables from custom.css

**Spec:** `docs/superpowers/specs/2026-03-30-test-component-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/components/test/types.ts` | All shared TypeScript interfaces and types |
| `src/components/test/hooks/useTestStorage.ts` | localStorage read/write for sessions and results |
| `src/components/test/hooks/useTestTimer.ts` | Countdown with pause on visibilitychange |
| `src/components/test/hooks/useDragAndDrop.ts` | Mouse + touch drag with snap-to-target |
| `src/components/test/Test.module.css` | Styles for Test, TestProgressBar, QuestionSelect, QuestionMultiSelect, TestResults |
| `src/components/test/TestProgressBar.tsx` | Progress bar + countdown display |
| `src/components/test/QuestionSelect.tsx` | Single-choice radio card question |
| `src/components/test/QuestionMultiSelect.tsx` | Multi-choice checkbox card question |
| `src/components/test/QuestionMatch.tsx` | Connect-pairs with SVG lines |
| `src/components/test/QuestionMatch.module.css` | Match-specific styles (columns, circles, lines) |
| `src/components/test/QuestionClassify.tsx` | Drag items to category columns |
| `src/components/test/QuestionClassify.module.css` | Classify-specific styles (pool, columns, drop zones) |
| `src/components/test/QuestionRenderer.tsx` | Switch by question type → correct component |
| `src/components/test/TestResults.tsx` | Results screen: summary, stats, review |
| `src/components/test/Test.tsx` | Orchestrator: state machine, navigation, scoring |
| `src/components/test/ModuleTest.tsx` | Container card with aggregated progress |
| `src/components/test/ModuleTest.module.css` | ModuleTest-specific styles |
| `docs/terraform/tests/test-data.ts` | Sample test data for Terraform module |
| `docs/terraform/tests/tests.mdx` | Updated MDX page using the components |

---

## Task 1: Types

**Files:**
- Create: `src/components/test/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/components/test/types.ts

export type QuestionType = 'select' | 'multiselect' | 'match' | 'classify';
export type PointsType = 'over100' | 'over10' | 'over5' | 'percent';
export type OnTimeUp = 'submit' | 'warn';

export interface Question {
  id: string;
  title: string;
  type: QuestionType;
  points: number;
  explanation: string;
  answers?: string[];
  correctAnswer?: number | number[];
  matchPairs?: { left: string; right: string }[];
  categories?: string[];
  classifyItems?: { text: string; category: string }[];
}

export interface TestConfig {
  id: string;
  title: string;
  questions: Question[];
  numberOfQuestions: number;
  time: number;
  pointsType: PointsType;
  minForPass: number;
  onTimeUp: OnTimeUp;
}

export interface UserAnswer {
  questionId: string;
  answeredAt: string;
  timeSpentMs: number;
  selectedIndices?: number[];
  matchedPairs?: { left: string; right: string }[];
  classifiedItems?: { text: string; category: string }[];
}

export interface TestSession {
  testId: string;
  selectedQuestionIds: string[];
  currentQuestionIndex: number;
  answers: Record<string, UserAnswer>;
  timeRemainingMs: number;
  startedAt: string;
  status: 'in-progress' | 'completed';
}

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  pointsEarned: number;
  pointsPossible: number;
  timeSpentMs: number;
  userAnswer: UserAnswer;
}

export interface TestResult {
  testId: string;
  completedAt: string;
  score: number;
  maxScore: number;
  passed: boolean;
  totalTimeMs: number;
  questionResults: QuestionResult[];
}

export interface ModuleTestEntry {
  id: string;
  title: string;
  config: TestConfig;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/test/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/types.ts
git commit -m "feat(test): add shared type definitions"
```

---

## Task 2: useTestStorage hook

**Files:**
- Create: `src/components/test/hooks/useTestStorage.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/components/test/hooks/useTestStorage.ts
import { useState, useCallback } from 'react';
import type { TestSession, TestResult } from '../types';

function sessionKey(id: string) { return `test-session-${id}`; }
function resultsKey(id: string) { return `test-results-${id}`; }

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useTestStorage(testId: string) {
  const [session, setSessionState] = useState<TestSession | null>(
    () => readJSON<TestSession>(sessionKey(testId))
  );
  const [results, setResultsState] = useState<TestResult[]>(
    () => readJSON<TestResult[]>(resultsKey(testId)) ?? []
  );

  const saveSession = useCallback((s: TestSession) => {
    localStorage.setItem(sessionKey(testId), JSON.stringify(s));
    setSessionState(s);
  }, [testId]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(sessionKey(testId));
    setSessionState(null);
  }, [testId]);

  const addResult = useCallback((r: TestResult) => {
    const updated = [...(readJSON<TestResult[]>(resultsKey(testId)) ?? []), r];
    localStorage.setItem(resultsKey(testId), JSON.stringify(updated));
    setResultsState(updated);
  }, [testId]);

  const clearAll = useCallback(() => {
    localStorage.removeItem(sessionKey(testId));
    localStorage.removeItem(resultsKey(testId));
    setSessionState(null);
    setResultsState([]);
  }, [testId]);

  const bestResult = results.length > 0
    ? results.reduce((best, r) => r.score > best.score ? r : best)
    : null;

  return { session, results, bestResult, saveSession, clearSession, addResult, clearAll };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/test/hooks/useTestStorage.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/hooks/useTestStorage.ts
git commit -m "feat(test): add useTestStorage hook for localStorage persistence"
```

---

## Task 3: useTestTimer hook

**Files:**
- Create: `src/components/test/hooks/useTestTimer.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/components/test/hooks/useTestTimer.ts
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTestTimerProps {
  initialMs: number;
  running: boolean;
  onTimeUp: () => void;
}

export function useTestTimer({ initialMs, running, onTimeUp }: UseTestTimerProps) {
  const [remainingMs, setRemainingMs] = useState(initialMs);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const setTime = useCallback((ms: number) => {
    setRemainingMs(ms);
    lastTickRef.current = Date.now();
  }, []);

  // Main countdown interval
  useEffect(() => {
    if (!running) {
      stop();
      return;
    }

    lastTickRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      setRemainingMs(prev => {
        const next = Math.max(0, prev - elapsed);
        if (next === 0) {
          stop();
          // Defer to avoid setState-during-render
          setTimeout(() => onTimeUpRef.current(), 0);
        }
        return next;
      });
    }, 250);

    return stop;
  }, [running, stop]);

  // Pause on tab hidden, resume on tab visible
  useEffect(() => {
    if (!running) return;

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        lastTickRef.current = Date.now();
        if (!intervalRef.current) {
          // Re-trigger by toggling — the main effect handles restart
          setRemainingMs(prev => prev);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [running, stop]);

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { remainingMs, display, setTime, stop };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/test/hooks/useTestTimer.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/hooks/useTestTimer.ts
git commit -m "feat(test): add useTestTimer hook with pause on tab hidden"
```

---

## Task 4: useDragAndDrop hook

**Files:**
- Create: `src/components/test/hooks/useDragAndDrop.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/components/test/hooks/useDragAndDrop.ts
import { useState, useRef, useCallback, useEffect } from 'react';

export interface DragItem {
  id: string;
  text: string;
}

interface Position {
  x: number;
  y: number;
}

interface UseDragAndDropProps {
  onDrop: (itemId: string, targetId: string) => void;
}

export function useDragAndDrop({ onDrop }: UseDragAndDropProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<Position | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });
  const isTouchRef = useRef(false);

  useEffect(() => {
    isTouchRef.current = 'ontouchstart' in window;
  }, []);

  // --- Tap-to-select mode (mobile) ---
  const handleTapItem = useCallback((itemId: string) => {
    if (!isTouchRef.current) return;
    setSelectedId(prev => prev === itemId ? null : itemId);
  }, []);

  const handleTapTarget = useCallback((targetId: string) => {
    if (!isTouchRef.current || !selectedId) return;
    onDrop(selectedId, targetId);
    setSelectedId(null);
  }, [selectedId, onDrop]);

  // --- Drag mode (desktop) ---
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, itemId: string) => {
    if (isTouchRef.current) return; // use tap mode instead
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    setDraggingId(itemId);
    setDragPos({ x: clientX, y: clientY });
  }, []);

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      setDragPos({ x: clientX, y: clientY });
    };

    const handleEnd = (e: MouseEvent | TouchEvent) => {
      const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
      const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;

      // Find drop target under cursor
      const elements = document.elementsFromPoint(clientX, clientY);
      const target = elements.find(el => el.hasAttribute('data-drop-target'));
      if (target) {
        const targetId = target.getAttribute('data-drop-target')!;
        onDrop(draggingId, targetId);
      }

      setDraggingId(null);
      setDragPos(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [draggingId, onDrop]);

  return {
    draggingId,
    dragPos,
    selectedId,
    dragOffset: dragOffsetRef.current,
    isTouchDevice: isTouchRef.current,
    handleDragStart,
    handleTapItem,
    handleTapTarget,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/test/hooks/useDragAndDrop.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/hooks/useDragAndDrop.ts
git commit -m "feat(test): add useDragAndDrop hook with mouse + touch support"
```

---

## Task 5: CSS — Test.module.css

**Files:**
- Create: `src/components/test/Test.module.css`

- [ ] **Step 1: Create shared styles**

```css
/* src/components/test/Test.module.css */

/* ── Progress bar ── */
.progressHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--ifm-font-color-base);
  opacity: 0.7;
  margin-bottom: 0.4rem;
}

.timer {
  font-weight: 600;
  transition: color 0.15s ease;
}

.timerWarning {
  color: #e74c3c;
}

.progressTrack {
  background: var(--ifm-background-color);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.progressFill {
  background: var(--ifm-color-primary);
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

/* ── IDLE screen ── */
.idleScreen {
  text-align: center;
  padding: 2rem 1rem;
}

.idleTitle {
  font-family: var(--ifm-heading-font-family);
  font-size: 1.2rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

.idleMeta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  opacity: 0.6;
}

.idleActions {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
  margin-top: 1.5rem;
}

.idleLastResult {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.5;
  margin-top: 1rem;
}

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.2rem;
  border: none;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}

.btn:hover {
  opacity: 0.85;
  transform: translateY(-1px);
}

.btn:active {
  transform: translateY(0);
}

.btnPrimary {
  background: var(--ifm-color-primary);
  color: #0D0D0D;
}

.btnSecondary {
  background: transparent;
  color: var(--ifm-color-primary);
  border: 1px solid var(--ifm-color-primary);
}

.btnDanger {
  background: transparent;
  color: #e74c3c;
  border: 1px solid #e74c3c;
}

/* ── Question area ── */
.questionTitle {
  font-family: var(--ifm-heading-font-family);
  font-size: 1rem;
  font-weight: 600;
  margin: 1.2rem 0 1rem;
}

.questionNav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}

.navBtn {
  background: none;
  border: none;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--ifm-font-color-base);
  opacity: 0.6;
  transition: opacity 0.15s ease;
  padding: 0.3rem 0;
}

.navBtn:hover {
  opacity: 1;
}

.navBtnActive {
  opacity: 1;
  color: var(--ifm-color-primary);
  font-weight: 600;
}

/* ── Answer option cards (select/multiselect) ── */
.optionsList {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.optionCard {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.9rem;
  border: 1.5px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  font-size: 0.85rem;
}

.optionCard:hover {
  border-color: var(--ifm-color-primary);
}

.optionSelected {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.06);
}

.optionCorrect {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.08);
  color: var(--ifm-color-primary);
}

.optionIncorrect {
  border-color: #e74c3c;
  background: rgba(231, 76, 60, 0.08);
  color: #e74c3c;
}

.optionIndicator {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(128, 128, 128, 0.4);
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease, background 0.15s ease;
  font-size: 0.65rem;
}

.optionIndicatorCheckbox {
  border-radius: 4px;
}

.optionIndicatorSelected {
  border-color: var(--ifm-color-primary);
  background: var(--ifm-color-primary);
  color: #0D0D0D;
}

.optionHint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.5;
  margin-bottom: 0.5rem;
}

/* ── Feedback / explanation ── */
.explanation {
  margin-top: 1rem;
  background: var(--ifm-background-surface-color);
  border-left: 3px solid #5bc0de;
  padding: 0.8rem 1rem;
  border-radius: 0 6px 6px 0;
}

.explanationLabel {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5bc0de;
  margin-bottom: 0.3rem;
}

.explanationText {
  font-size: 0.82rem;
  opacity: 0.8;
  line-height: 1.5;
}

/* ── Results screen ── */
.resultsScreen {
  padding: 1rem 0;
}

.scoreBig {
  text-align: center;
  font-family: var(--ifm-heading-font-family);
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--ifm-color-primary);
}

.resultBadge {
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0.3rem;
}

.passed {
  color: var(--ifm-color-primary);
}

.failed {
  color: #e74c3c;
}

.resultMeta {
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  opacity: 0.6;
  margin-top: 0.3rem;
}

.statsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.statCard {
  background: var(--ifm-background-color);
  border-radius: 6px;
  padding: 0.7rem;
  text-align: center;
}

.statLabel {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.statValue {
  font-family: var(--ifm-heading-font-family);
  font-size: 1rem;
  font-weight: 700;
  margin-top: 0.2rem;
}

.resultActions {
  display: flex;
  gap: 0.6rem;
  justify-content: center;
  margin-top: 1.5rem;
}

.reviewSection {
  margin-top: 1.5rem;
}

.reviewItem {
  padding: 0.8rem 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}

.reviewItemHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
}

.reviewItemPoints {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.6;
}

/* ── Time-up overlay ── */
.timeUpOverlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  z-index: 10;
}

.timeUpText {
  font-family: var(--ifm-heading-font-family);
  font-size: 1.3rem;
  font-weight: 700;
  color: #e74c3c;
  margin-bottom: 1rem;
}

/* ── Wrapper override for test ── */
.testWrapper {
  position: relative;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .progressFill,
  .optionCard,
  .btn,
  .navBtn {
    transition: none;
  }
}

/* ── Mobile ── */
@media (max-width: 480px) {
  .statsGrid {
    grid-template-columns: 1fr;
  }

  .idleActions {
    flex-direction: column;
    align-items: center;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/test/Test.module.css
git commit -m "feat(test): add shared CSS module styles"
```

---

## Task 6: TestProgressBar

**Files:**
- Create: `src/components/test/TestProgressBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/test/TestProgressBar.tsx
import React from 'react';
import styles from './Test.module.css';

interface TestProgressBarProps {
  current: number;
  total: number;
  timerDisplay: string;
  timerWarning: boolean;
}

export default function TestProgressBar({ current, total, timerDisplay, timerWarning }: TestProgressBarProps) {
  const percent = ((current + 1) / total) * 100;

  return (
    <div>
      <div className={styles.progressHeader}>
        <span>Pregunta {current + 1}/{total}</span>
        <span
          className={`${styles.timer} ${timerWarning ? styles.timerWarning : ''}`}
          aria-live={timerWarning ? 'assertive' : 'polite'}
        >
          {timerDisplay}
        </span>
      </div>
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={current + 1}
          aria-valuemin={1}
          aria-valuemax={total}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/TestProgressBar.tsx
git commit -m "feat(test): add TestProgressBar component"
```

---

## Task 7: QuestionSelect

**Files:**
- Create: `src/components/test/QuestionSelect.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/test/QuestionSelect.tsx
import React from 'react';
import type { Question, UserAnswer } from './types';
import styles from './Test.module.css';

interface QuestionSelectProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

export default function QuestionSelect({ question, userAnswer, showFeedback, onAnswer }: QuestionSelectProps) {
  const correctIndex = question.correctAnswer as number;
  const selectedIndex = userAnswer?.selectedIndices?.[0] ?? null;

  const handleSelect = (index: number) => {
    if (showFeedback) return;
    onAnswer({
      questionId: question.id,
      answeredAt: new Date().toISOString(),
      timeSpentMs: 0, // calculated by Test orchestrator
      selectedIndices: [index],
    });
  };

  return (
    <div role="radiogroup" aria-label={question.title}>
      <div className={styles.optionsList}>
        {question.answers!.map((text, i) => {
          let cardClass = styles.optionCard;
          let indicatorClass = styles.optionIndicator;

          if (showFeedback) {
            if (i === correctIndex) {
              cardClass += ` ${styles.optionCorrect}`;
              indicatorClass += ` ${styles.optionIndicatorSelected}`;
            } else if (i === selectedIndex && i !== correctIndex) {
              cardClass += ` ${styles.optionIncorrect}`;
            }
          } else if (i === selectedIndex) {
            cardClass += ` ${styles.optionSelected}`;
            indicatorClass += ` ${styles.optionIndicatorSelected}`;
          }

          return (
            <div
              key={i}
              className={cardClass}
              onClick={() => handleSelect(i)}
              role="radio"
              aria-checked={i === selectedIndex}
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(i); } }}
            >
              <div className={indicatorClass}>
                {showFeedback && i === correctIndex && '✓'}
                {showFeedback && i === selectedIndex && i !== correctIndex && '✗'}
              </div>
              <span>{text}</span>
            </div>
          );
        })}
      </div>

      {showFeedback && selectedIndex !== null && selectedIndex !== correctIndex && (
        <div className={styles.explanation}>
          <div className={styles.explanationLabel}>Explicación</div>
          <div className={styles.explanationText}>{question.explanation}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/QuestionSelect.tsx
git commit -m "feat(test): add QuestionSelect component"
```

---

## Task 8: QuestionMultiSelect

**Files:**
- Create: `src/components/test/QuestionMultiSelect.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/test/QuestionMultiSelect.tsx
import React from 'react';
import type { Question, UserAnswer } from './types';
import styles from './Test.module.css';

interface QuestionMultiSelectProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

export default function QuestionMultiSelect({ question, userAnswer, showFeedback, onAnswer }: QuestionMultiSelectProps) {
  const correctIndices = new Set(question.correctAnswer as number[]);
  const selectedIndices = new Set(userAnswer?.selectedIndices ?? []);

  const handleToggle = (index: number) => {
    if (showFeedback) return;
    const current = new Set(selectedIndices);
    if (current.has(index)) {
      current.delete(index);
    } else {
      current.add(index);
    }
    onAnswer({
      questionId: question.id,
      answeredAt: new Date().toISOString(),
      timeSpentMs: 0,
      selectedIndices: Array.from(current),
    });
  };

  return (
    <div role="group" aria-label={question.title}>
      <div className={styles.optionHint}>Selecciona todas las correctas</div>
      <div className={styles.optionsList}>
        {question.answers!.map((text, i) => {
          const isSelected = selectedIndices.has(i);
          const isCorrect = correctIndices.has(i);
          let cardClass = styles.optionCard;
          let indicatorClass = `${styles.optionIndicator} ${styles.optionIndicatorCheckbox}`;

          if (showFeedback) {
            if (isCorrect) {
              cardClass += ` ${styles.optionCorrect}`;
              indicatorClass += ` ${styles.optionIndicatorSelected}`;
            } else if (isSelected && !isCorrect) {
              cardClass += ` ${styles.optionIncorrect}`;
            }
          } else if (isSelected) {
            cardClass += ` ${styles.optionSelected}`;
            indicatorClass += ` ${styles.optionIndicatorSelected}`;
          }

          return (
            <div
              key={i}
              className={cardClass}
              onClick={() => handleToggle(i)}
              role="checkbox"
              aria-checked={isSelected}
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(i); } }}
            >
              <div className={indicatorClass}>
                {showFeedback && isCorrect && '✓'}
                {showFeedback && isSelected && !isCorrect && '✗'}
              </div>
              <span>{text}</span>
            </div>
          );
        })}
      </div>

      {showFeedback && !isAllCorrect(selectedIndices, correctIndices) && (
        <div className={styles.explanation}>
          <div className={styles.explanationLabel}>Explicación</div>
          <div className={styles.explanationText}>{question.explanation}</div>
        </div>
      )}
    </div>
  );
}

function isAllCorrect(selected: Set<number>, correct: Set<number>): boolean {
  if (selected.size !== correct.size) return false;
  for (const i of selected) {
    if (!correct.has(i)) return false;
  }
  return true;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/QuestionMultiSelect.tsx
git commit -m "feat(test): add QuestionMultiSelect component"
```

---

## Task 9: QuestionMatch

**Files:**
- Create: `src/components/test/QuestionMatch.tsx`
- Create: `src/components/test/QuestionMatch.module.css`

- [ ] **Step 1: Create the CSS**

```css
/* src/components/test/QuestionMatch.module.css */

.matchContainer {
  display: flex;
  gap: 3rem;
  position: relative;
  justify-content: space-between;
}

.matchColumn {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  flex: 1;
}

.matchLabel {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  margin-bottom: 0.2rem;
}

.matchBox {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.8rem;
  border: 1.5px solid rgba(128, 128, 128, 0.3);
  border-radius: 6px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  position: relative;
  min-height: 40px;
}

.matchBox:hover {
  border-color: var(--ifm-color-primary);
}

.matchBoxConnected {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.06);
  color: var(--ifm-color-primary);
}

.matchBoxActive {
  border-color: var(--ifm-color-primary);
  box-shadow: 0 0 12px rgba(74, 255, 160, 0.3);
}

.matchBoxCorrect {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.08);
}

.matchBoxIncorrect {
  border-color: #e74c3c;
  background: rgba(231, 76, 60, 0.08);
}

.circle {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(128, 128, 128, 0.4);
  background: var(--ifm-background-surface-color);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.circleLeft {
  right: -7px;
  top: 50%;
  transform: translateY(-50%);
}

.circleRight {
  left: -7px;
  top: 50%;
  transform: translateY(-50%);
}

.circleFilled {
  background: var(--ifm-color-primary);
  border-color: var(--ifm-color-primary);
}

.svgOverlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.matchLine {
  stroke: var(--ifm-color-primary);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: auto;
  cursor: pointer;
}

.matchLineIncorrect {
  stroke: #e74c3c;
}

.matchHint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.5;
  text-align: center;
  margin-top: 1rem;
}

/* ── Mobile: stack vertically ── */
@media (max-width: 480px) {
  .matchContainer {
    flex-direction: column;
    gap: 1.5rem;
  }

  .circle {
    display: none;
  }

  .svgOverlay {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .matchBox,
  .circle {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the component**

```tsx
// src/components/test/QuestionMatch.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Question, UserAnswer } from './types';
import styles from './QuestionMatch.module.css';
import testStyles from './Test.module.css';

interface QuestionMatchProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

interface Connection {
  leftIndex: number;
  rightIndex: number;
}

export default function QuestionMatch({ question, userAnswer, showFeedback, onAnswer }: QuestionMatchProps) {
  const pairs = question.matchPairs!;
  const leftItems = pairs.map(p => p.left);

  // Shuffle right items once per question render (stable via ref)
  const shuffledRightRef = useRef<string[]>([]);
  if (shuffledRightRef.current.length === 0) {
    shuffledRightRef.current = [...pairs.map(p => p.right)].sort(() => Math.random() - 0.5);
  }
  const rightItems = shuffledRightRef.current;

  const [activeLeft, setActiveLeft] = useState<number | null>(null);
  const [connections, setConnections] = useState<Connection[]>(() => {
    if (!userAnswer?.matchedPairs) return [];
    return userAnswer.matchedPairs.map(mp => ({
      leftIndex: leftItems.indexOf(mp.left),
      rightIndex: rightItems.indexOf(mp.right),
    })).filter(c => c.leftIndex >= 0 && c.rightIndex >= 0);
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rightRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [linePositions, setLinePositions] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  const recalcLines = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const positions = connections.map(c => {
      const leftEl = leftRefs.current[c.leftIndex];
      const rightEl = rightRefs.current[c.rightIndex];
      if (!leftEl || !rightEl) return { x1: 0, y1: 0, x2: 0, y2: 0 };
      const lr = leftEl.getBoundingClientRect();
      const rr = rightEl.getBoundingClientRect();
      return {
        x1: lr.right - containerRect.left,
        y1: lr.top + lr.height / 2 - containerRect.top,
        x2: rr.left - containerRect.left,
        y2: rr.top + rr.height / 2 - containerRect.top,
      };
    });
    setLinePositions(positions);
  }, [connections]);

  useEffect(() => {
    recalcLines();
    window.addEventListener('resize', recalcLines);
    return () => window.removeEventListener('resize', recalcLines);
  }, [recalcLines]);

  const emitAnswer = useCallback((conns: Connection[]) => {
    onAnswer({
      questionId: question.id,
      answeredAt: new Date().toISOString(),
      timeSpentMs: 0,
      matchedPairs: conns.map(c => ({
        left: leftItems[c.leftIndex],
        right: rightItems[c.rightIndex],
      })),
    });
  }, [question.id, leftItems, rightItems, onAnswer]);

  const handleLeftClick = (index: number) => {
    if (showFeedback) return;
    setActiveLeft(prev => prev === index ? null : index);
  };

  const handleRightClick = (index: number) => {
    if (showFeedback || activeLeft === null) return;
    // Remove any existing connections for these items
    const filtered = connections.filter(c => c.leftIndex !== activeLeft && c.rightIndex !== index);
    const newConns = [...filtered, { leftIndex: activeLeft, rightIndex: index }];
    setConnections(newConns);
    setActiveLeft(null);
    emitAnswer(newConns);
  };

  const handleRemoveConnection = (connIndex: number) => {
    if (showFeedback) return;
    const newConns = connections.filter((_, i) => i !== connIndex);
    setConnections(newConns);
    emitAnswer(newConns);
  };

  const isLeftConnected = (i: number) => connections.some(c => c.leftIndex === i);
  const isRightConnected = (i: number) => connections.some(c => c.rightIndex === i);

  // Feedback: check which connections are correct
  const isConnectionCorrect = (c: Connection) => {
    const left = leftItems[c.leftIndex];
    const right = rightItems[c.rightIndex];
    return pairs.some(p => p.left === left && p.right === right);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div className={styles.matchContainer}>
        <div className={styles.matchColumn}>
          <div className={styles.matchLabel}>Conceptos</div>
          {leftItems.map((text, i) => {
            let boxClass = styles.matchBox;
            if (activeLeft === i) boxClass += ` ${styles.matchBoxActive}`;
            else if (isLeftConnected(i)) {
              if (showFeedback) {
                const conn = connections.find(c => c.leftIndex === i);
                boxClass += conn && isConnectionCorrect(conn) ? ` ${styles.matchBoxCorrect}` : ` ${styles.matchBoxIncorrect}`;
              } else {
                boxClass += ` ${styles.matchBoxConnected}`;
              }
            }
            return (
              <div
                key={i}
                ref={el => { leftRefs.current[i] = el; }}
                className={boxClass}
                onClick={() => handleLeftClick(i)}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') handleLeftClick(i); }}
              >
                <span>{text}</span>
                <div className={`${styles.circle} ${styles.circleLeft} ${isLeftConnected(i) || activeLeft === i ? styles.circleFilled : ''}`} />
              </div>
            );
          })}
        </div>

        <div className={styles.matchColumn}>
          <div className={styles.matchLabel}>Definiciones</div>
          {rightItems.map((text, i) => {
            let boxClass = styles.matchBox;
            if (isRightConnected(i)) {
              if (showFeedback) {
                const conn = connections.find(c => c.rightIndex === i);
                boxClass += conn && isConnectionCorrect(conn) ? ` ${styles.matchBoxCorrect}` : ` ${styles.matchBoxIncorrect}`;
              } else {
                boxClass += ` ${styles.matchBoxConnected}`;
              }
            }
            return (
              <div
                key={i}
                ref={el => { rightRefs.current[i] = el; }}
                className={boxClass}
                onClick={() => handleRightClick(i)}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') handleRightClick(i); }}
              >
                <div className={`${styles.circle} ${styles.circleRight} ${isRightConnected(i) ? styles.circleFilled : ''}`} />
                <span>{text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* SVG lines */}
      <svg className={styles.svgOverlay}>
        {linePositions.map((pos, i) => (
          <line
            key={i}
            x1={pos.x1} y1={pos.y1}
            x2={pos.x2} y2={pos.y2}
            className={`${styles.matchLine} ${showFeedback && !isConnectionCorrect(connections[i]) ? styles.matchLineIncorrect : ''}`}
            onClick={() => handleRemoveConnection(i)}
          />
        ))}
      </svg>

      {showFeedback && connections.some(c => !isConnectionCorrect(c)) && (
        <div className={testStyles.explanation}>
          <div className={testStyles.explanationLabel}>Explicación</div>
          <div className={testStyles.explanationText}>{question.explanation}</div>
        </div>
      )}

      <div className={styles.matchHint}>
        Click en concepto izquierdo, luego en definición derecha para conectar
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/test/QuestionMatch.tsx src/components/test/QuestionMatch.module.css
git commit -m "feat(test): add QuestionMatch component with SVG line connections"
```

---

## Task 10: QuestionClassify

**Files:**
- Create: `src/components/test/QuestionClassify.tsx`
- Create: `src/components/test/QuestionClassify.module.css`

- [ ] **Step 1: Create the CSS**

```css
/* src/components/test/QuestionClassify.module.css */

.classifyContainer {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

/* ── Item pool (top) ── */
.pool {
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.poolLabel {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  margin-bottom: 0.5rem;
}

.poolItems {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dragItem {
  border: 1.5px solid rgba(128, 128, 128, 0.3);
  border-radius: 5px;
  padding: 0.4rem 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  cursor: grab;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
  user-select: none;
  -webkit-user-select: none;
}

.dragItem:hover {
  border-color: var(--ifm-color-primary);
}

.dragItemSelected {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.06);
  box-shadow: 0 0 12px rgba(74, 255, 160, 0.3);
  color: var(--ifm-color-primary);
}

.dragItemGhost {
  position: fixed;
  pointer-events: none;
  z-index: 100;
  transform: scale(1.05);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  background: var(--ifm-background-surface-color);
  border: 1.5px solid var(--ifm-color-primary);
  border-radius: 5px;
  padding: 0.4rem 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: var(--ifm-color-primary);
}

/* ── Category columns (bottom) ── */
.columns {
  display: grid;
  gap: 0.6rem;
}

.column {
  border: 1.5px dashed rgba(128, 128, 128, 0.3);
  border-radius: 8px;
  padding: 0.6rem;
  min-height: 80px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.columnHover {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.03);
}

.columnLabel {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  text-align: center;
  margin-bottom: 0.5rem;
}

.columnItems {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.placedItem {
  background: rgba(74, 255, 160, 0.08);
  border: 1px solid var(--ifm-color-primary);
  border-radius: 5px;
  padding: 0.35rem 0.6rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--ifm-color-primary);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.placedItem:hover {
  opacity: 0.7;
}

.placedItemCorrect {
  border-color: var(--ifm-color-primary);
  background: rgba(74, 255, 160, 0.12);
}

.placedItemIncorrect {
  border-color: #e74c3c;
  background: rgba(231, 76, 60, 0.08);
  color: #e74c3c;
}

.classifyHint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.5;
  text-align: center;
}

/* ── Mobile ── */
@media (max-width: 600px) {
  .columns {
    grid-template-columns: 1fr 1fr !important;
  }
}

@media (max-width: 400px) {
  .columns {
    grid-template-columns: 1fr !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dragItem,
  .column,
  .placedItem {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the component**

```tsx
// src/components/test/QuestionClassify.tsx
import React, { useState, useCallback } from 'react';
import type { Question, UserAnswer } from './types';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import styles from './QuestionClassify.module.css';
import testStyles from './Test.module.css';

interface QuestionClassifyProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

export default function QuestionClassify({ question, userAnswer, showFeedback, onAnswer }: QuestionClassifyProps) {
  const categories = question.categories!;
  const allItems = question.classifyItems!;

  // State: which items are placed in which category
  const [placements, setPlacements] = useState<Record<string, string>>(() => {
    if (!userAnswer?.classifiedItems) return {};
    const map: Record<string, string> = {};
    for (const ci of userAnswer.classifiedItems) {
      map[ci.text] = ci.category;
    }
    return map;
  });

  const emitAnswer = useCallback((newPlacements: Record<string, string>) => {
    onAnswer({
      questionId: question.id,
      answeredAt: new Date().toISOString(),
      timeSpentMs: 0,
      classifiedItems: Object.entries(newPlacements).map(([text, category]) => ({ text, category })),
    });
  }, [question.id, onAnswer]);

  const handleDrop = useCallback((itemId: string, targetId: string) => {
    if (showFeedback) return;
    const newPlacements = { ...placements };
    if (targetId === 'pool') {
      delete newPlacements[itemId];
    } else {
      newPlacements[itemId] = targetId;
    }
    setPlacements(newPlacements);
    emitAnswer(newPlacements);
  }, [placements, showFeedback, emitAnswer]);

  const { draggingId, dragPos, selectedId, dragOffset, handleDragStart, handleTapItem, handleTapTarget } = useDragAndDrop({ onDrop: handleDrop });

  // Items not yet placed
  const poolItems = allItems.filter(item => !placements[item.text]);
  // Items in each category
  const categoryItems = (cat: string) => allItems.filter(item => placements[item.text] === cat);

  const isItemCorrect = (text: string, category: string) => {
    return allItems.some(item => item.text === text && item.category === category);
  };

  const gridCols = categories.length <= 2 ? categories.length : categories.length <= 4 ? categories.length : 3;

  return (
    <div className={styles.classifyContainer}>
      {/* Pool of draggable items (top) */}
      <div className={styles.pool}>
        <div className={styles.poolLabel}>Arrastra cada elemento a su categoría</div>
        <div className={styles.poolItems} data-drop-target="pool" onClick={() => handleTapTarget('pool')}>
          {poolItems.map(item => (
            <div
              key={item.text}
              className={`${styles.dragItem} ${selectedId === item.text ? styles.dragItemSelected : ''}`}
              onMouseDown={e => handleDragStart(e, item.text)}
              onClick={e => { e.stopPropagation(); handleTapItem(item.text); }}
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') handleTapItem(item.text); }}
            >
              {item.text}
            </div>
          ))}
          {poolItems.length === 0 && !showFeedback && (
            <span style={{ opacity: 0.4, fontSize: '0.75rem' }}>Todos los elementos han sido clasificados</span>
          )}
        </div>
      </div>

      {/* Category columns (bottom) */}
      <div className={styles.columns} style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
        {categories.map(cat => (
          <div
            key={cat}
            className={styles.column}
            data-drop-target={cat}
            onClick={() => handleTapTarget(cat)}
          >
            <div className={styles.columnLabel}>{cat}</div>
            <div className={styles.columnItems}>
              {categoryItems(cat).map(item => {
                let itemClass = styles.placedItem;
                if (showFeedback) {
                  itemClass += isItemCorrect(item.text, cat)
                    ? ` ${styles.placedItemCorrect}`
                    : ` ${styles.placedItemIncorrect}`;
                }
                return (
                  <div
                    key={item.text}
                    className={itemClass}
                    onClick={e => {
                      e.stopPropagation();
                      if (!showFeedback) handleDrop(item.text, 'pool');
                    }}
                  >
                    {item.text}
                    {showFeedback && isItemCorrect(item.text, cat) && ' ✓'}
                    {showFeedback && !isItemCorrect(item.text, cat) && ' ✗'}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Ghost element during drag */}
      {draggingId && dragPos && (
        <div
          className={styles.dragItemGhost}
          style={{
            left: dragPos.x - dragOffset.x,
            top: dragPos.y - dragOffset.y,
          }}
        >
          {draggingId}
        </div>
      )}

      {showFeedback && Object.entries(placements).some(([text, cat]) => !isItemCorrect(text, cat)) && (
        <div className={testStyles.explanation}>
          <div className={testStyles.explanationLabel}>Explicación</div>
          <div className={testStyles.explanationText}>{question.explanation}</div>
        </div>
      )}

      {!showFeedback && (
        <div className={styles.classifyHint}>
          Desktop: arrastra y suelta · Mobile: toca elemento, luego toca columna
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/test/QuestionClassify.tsx src/components/test/QuestionClassify.module.css
git commit -m "feat(test): add QuestionClassify component with drag & drop"
```

---

## Task 11: QuestionRenderer

**Files:**
- Create: `src/components/test/QuestionRenderer.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/test/QuestionRenderer.tsx
import React from 'react';
import type { Question, UserAnswer } from './types';
import QuestionSelect from './QuestionSelect';
import QuestionMultiSelect from './QuestionMultiSelect';
import QuestionMatch from './QuestionMatch';
import QuestionClassify from './QuestionClassify';

interface QuestionRendererProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

export default function QuestionRenderer({ question, userAnswer, showFeedback, onAnswer }: QuestionRendererProps) {
  switch (question.type) {
    case 'select':
      return <QuestionSelect question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'multiselect':
      return <QuestionMultiSelect question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'match':
      return <QuestionMatch question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'classify':
      return <QuestionClassify question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/test/QuestionRenderer.tsx
git commit -m "feat(test): add QuestionRenderer switch component"
```

---

## Task 12: TestResults

**Files:**
- Create: `src/components/test/TestResults.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/test/TestResults.tsx
import React, { useState } from 'react';
import type { TestResult, TestConfig, Question, PointsType } from './types';
import styles from './Test.module.css';

interface TestResultsProps {
  result: TestResult;
  config: TestConfig;
  questions: Question[];
  onRetry: () => void;
  onReset: () => void;
}

function formatScore(score: number, maxScore: number, pointsType: PointsType): string {
  if (pointsType === 'percent') return `${Math.round((score / maxScore) * 100)}%`;
  return `${Math.round(score * 10) / 10}/${maxScore}`;
}

function formatTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TestResults({ result, config, questions, onRetry, onReset }: TestResultsProps) {
  const [showReview, setShowReview] = useState(false);
  const scoreDisplay = formatScore(result.score, result.maxScore, config.pointsType);

  // Stats by question type
  const typeStats: Record<string, { correct: number; total: number }> = {};
  for (const qr of result.questionResults) {
    const q = questions.find(q => q.id === qr.questionId);
    if (!q) continue;
    if (!typeStats[q.type]) typeStats[q.type] = { correct: 0, total: 0 };
    typeStats[q.type].total++;
    if (qr.correct) typeStats[q.type].correct++;
  }

  const avgTimeMs = result.questionResults.length > 0
    ? result.questionResults.reduce((sum, qr) => sum + qr.timeSpentMs, 0) / result.questionResults.length
    : 0;

  return (
    <div className={styles.resultsScreen}>
      {/* Summary */}
      <div className={styles.scoreBig}>{scoreDisplay}</div>
      <div className={`${styles.resultBadge} ${result.passed ? styles.passed : styles.failed}`}>
        {result.passed ? 'Aprobado' : 'Suspendido'}
      </div>
      <div className={styles.resultMeta}>
        Tiempo: {formatTime(result.totalTimeMs)} · Mínimo: {formatScore(config.minForPass, result.maxScore, config.pointsType)}
      </div>

      {/* Stats grid */}
      <div className={styles.statsGrid}>
        {Object.entries(typeStats).map(([type, { correct, total }]) => (
          <div key={type} className={styles.statCard}>
            <div className={styles.statLabel}>{type}</div>
            <div className={styles.statValue} style={{ color: correct === total ? 'var(--ifm-color-primary)' : '#e74c3c' }}>
              {correct}/{total}
            </div>
          </div>
        ))}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Tiempo medio</div>
          <div className={styles.statValue}>{formatTime(avgTimeMs)}</div>
        </div>
      </div>

      {/* Actions */}
      <div className={styles.resultActions}>
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setShowReview(!showReview)}>
          {showReview ? 'Ocultar respuestas' : 'Revisar respuestas'}
        </button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRetry}>
          Reintentar
        </button>
      </div>

      {/* Review */}
      {showReview && (
        <div className={styles.reviewSection}>
          {result.questionResults.map((qr, i) => {
            const q = questions.find(q => q.id === qr.questionId);
            if (!q) return null;
            return (
              <div key={qr.questionId} className={styles.reviewItem}>
                <div className={styles.reviewItemHeader}>
                  <span style={{ color: qr.correct ? 'var(--ifm-color-primary)' : '#e74c3c' }}>
                    {qr.correct ? '✓' : '✗'} {i + 1}. {q.title}
                  </span>
                  <span className={styles.reviewItemPoints}>
                    {qr.pointsEarned}/{qr.pointsPossible} pts · {formatTime(qr.timeSpentMs)}
                  </span>
                </div>
                {!qr.correct && (
                  <div className={styles.explanation} style={{ marginTop: '0.5rem' }}>
                    <div className={styles.explanationLabel}>Explicación</div>
                    <div className={styles.explanationText}>{q.explanation}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reset link */}
      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <button
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={onReset}
          style={{ fontSize: '0.72rem' }}
        >
          Borrar todo el historial
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/TestResults.tsx
git commit -m "feat(test): add TestResults component with stats and review"
```

---

## Task 13: Test orchestrator

**Files:**
- Create: `src/components/test/Test.tsx`

- [ ] **Step 1: Create the orchestrator**

```tsx
// src/components/test/Test.tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import type { TestConfig, Question, UserAnswer, TestResult, QuestionResult } from './types';
import { useTestStorage } from './hooks/useTestStorage';
import { useTestTimer } from './hooks/useTestTimer';
import TestProgressBar from './TestProgressBar';
import QuestionRenderer from './QuestionRenderer';
import TestResults from './TestResults';
import styles from './Test.module.css';

type TestState = 'idle' | 'in-progress' | 'time-up' | 'results';

interface TestProps {
  config: TestConfig;
}

function selectQuestions(questions: Question[], count: number): Question[] {
  if (count >= questions.length) return [...questions];
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function scoreTest(
  questions: Question[],
  answers: Record<string, UserAnswer>,
  config: TestConfig,
): { score: number; maxScore: number; questionResults: QuestionResult[] } {
  const totalPossible = questions.reduce((sum, q) => sum + q.points, 0);
  const questionResults: QuestionResult[] = questions.map(q => {
    const ua = answers[q.id];
    const earned = ua ? calculatePoints(q, ua) : 0;
    return {
      questionId: q.id,
      correct: earned === q.points,
      pointsEarned: earned,
      pointsPossible: q.points,
      timeSpentMs: ua?.timeSpentMs ?? 0,
      userAnswer: ua ?? { questionId: q.id, answeredAt: '', timeSpentMs: 0 },
    };
  });

  const rawEarned = questionResults.reduce((sum, qr) => sum + qr.pointsEarned, 0);
  const scaleMap = { over100: 100, over10: 10, over5: 5, percent: 100 };
  const scale = scaleMap[config.pointsType];
  const score = totalPossible > 0 ? (rawEarned / totalPossible) * scale : 0;
  const maxScore = scale;

  return { score, maxScore, questionResults };
}

function calculatePoints(q: Question, ua: UserAnswer): number {
  switch (q.type) {
    case 'select': {
      const correct = q.correctAnswer as number;
      return ua.selectedIndices?.[0] === correct ? q.points : 0;
    }
    case 'multiselect': {
      const correct = new Set(q.correctAnswer as number[]);
      const selected = new Set(ua.selectedIndices ?? []);
      if (selected.size !== correct.size) return 0;
      for (const i of selected) if (!correct.has(i)) return 0;
      return q.points;
    }
    case 'match': {
      if (!ua.matchedPairs || !q.matchPairs) return 0;
      const correctSet = new Set(q.matchPairs.map(p => `${p.left}::${p.right}`));
      const userSet = new Set(ua.matchedPairs.map(p => `${p.left}::${p.right}`));
      let correctCount = 0;
      for (const key of userSet) if (correctSet.has(key)) correctCount++;
      return correctCount === correctSet.size ? q.points : (correctCount / correctSet.size) * q.points;
    }
    case 'classify': {
      if (!ua.classifiedItems || !q.classifyItems) return 0;
      const correctMap = new Map(q.classifyItems.map(ci => [ci.text, ci.category]));
      let correctCount = 0;
      for (const ci of ua.classifiedItems) {
        if (correctMap.get(ci.text) === ci.category) correctCount++;
      }
      const total = q.classifyItems.length;
      return total > 0 ? (correctCount / total) * q.points : 0;
    }
  }
}

export default function Test({ config }: TestProps) {
  const { session, bestResult, saveSession, clearSession, addResult, clearAll } = useTestStorage(config.id);

  const [state, setState] = useState<TestState>(() => {
    if (session?.status === 'in-progress') return 'idle'; // show resume option
    return 'idle';
  });
  const [currentIndex, setCurrentIndex] = useState(session?.currentQuestionIndex ?? 0);
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>(session?.answers ?? {});
  const [selectedQuestions, setSelectedQuestions] = useState<Question[]>(() => {
    if (session?.selectedQuestionIds) {
      return session.selectedQuestionIds
        .map(id => config.questions.find(q => q.id === id))
        .filter((q): q is Question => q !== undefined);
    }
    return [];
  });
  const [result, setResult] = useState<TestResult | null>(null);
  const [timeUpWarning, setTimeUpWarning] = useState(false);
  const questionStartRef = useRef<number>(Date.now());

  const timerInitialMs = session?.status === 'in-progress'
    ? session.timeRemainingMs
    : config.time * 60 * 1000;

  const handleTimeUp = useCallback(() => {
    if (config.onTimeUp === 'submit') {
      finishTest();
    } else {
      setTimeUpWarning(true);
    }
  }, [config.onTimeUp]);

  const { remainingMs, display: timerDisplay, setTime } = useTestTimer({
    initialMs: timerInitialMs,
    running: state === 'in-progress',
    onTimeUp: handleTimeUp,
  });

  const totalTimeMs = config.time * 60 * 1000;
  const timerWarning = remainingMs < totalTimeMs * 0.2;

  const currentQuestion = selectedQuestions[currentIndex];

  function startTest(resume: boolean) {
    if (resume && session) {
      setSelectedQuestions(
        session.selectedQuestionIds
          .map(id => config.questions.find(q => q.id === id))
          .filter((q): q is Question => q !== undefined)
      );
      setAnswers(session.answers);
      setCurrentIndex(session.currentQuestionIndex);
      setTime(session.timeRemainingMs);
    } else {
      const qs = selectQuestions(config.questions, config.numberOfQuestions);
      setSelectedQuestions(qs);
      setAnswers({});
      setCurrentIndex(0);
      setTime(config.time * 60 * 1000);
      clearSession();
      saveSession({
        testId: config.id,
        selectedQuestionIds: qs.map(q => q.id),
        currentQuestionIndex: 0,
        answers: {},
        timeRemainingMs: config.time * 60 * 1000,
        startedAt: new Date().toISOString(),
        status: 'in-progress',
      });
    }
    questionStartRef.current = Date.now();
    setState('in-progress');
    setTimeUpWarning(false);
  }

  function handleAnswer(ua: UserAnswer) {
    const timeSpent = Date.now() - questionStartRef.current;
    const enriched = { ...ua, timeSpentMs: (answers[ua.questionId]?.timeSpentMs ?? 0) + timeSpent };
    const newAnswers = { ...answers, [ua.questionId]: enriched };
    setAnswers(newAnswers);
    questionStartRef.current = Date.now();

    saveSession({
      testId: config.id,
      selectedQuestionIds: selectedQuestions.map(q => q.id),
      currentQuestionIndex: currentIndex,
      answers: newAnswers,
      timeRemainingMs: remainingMs,
      startedAt: session?.startedAt ?? new Date().toISOString(),
      status: 'in-progress',
    });
  }

  function navigate(direction: number) {
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= selectedQuestions.length) return;
    setCurrentIndex(newIndex);
    questionStartRef.current = Date.now();

    saveSession({
      testId: config.id,
      selectedQuestionIds: selectedQuestions.map(q => q.id),
      currentQuestionIndex: newIndex,
      answers,
      timeRemainingMs: remainingMs,
      startedAt: session?.startedAt ?? new Date().toISOString(),
      status: 'in-progress',
    });
  }

  function finishTest() {
    const { score, maxScore, questionResults } = scoreTest(selectedQuestions, answers, config);
    const testResult: TestResult = {
      testId: config.id,
      completedAt: new Date().toISOString(),
      score,
      maxScore,
      passed: score >= config.minForPass,
      totalTimeMs: totalTimeMs - remainingMs,
      questionResults,
    };
    setResult(testResult);
    addResult(testResult);
    clearSession();
    setState('results');
  }

  function handleRetry() {
    setResult(null);
    setState('idle');
  }

  function handleReset() {
    clearAll();
    setResult(null);
    setState('idle');
  }

  // Determine if we should show feedback for the current question
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const showFeedback = currentAnswer !== undefined && state === 'in-progress';

  return (
    <div className="demo-wrapper">
      <div className="demo-header">
        <span className="demo-badge">✎ Test</span>
        <h3>{config.title}</h3>
      </div>
      <div className={`demo-body ${styles.testWrapper}`}>
        {/* IDLE */}
        {state === 'idle' && (
          <div className={styles.idleScreen}>
            <div className={styles.idleMeta}>
              {config.numberOfQuestions} preguntas · {config.time} min · Mínimo: {config.minForPass}/{
                { over100: 100, over10: 10, over5: 5, percent: 100 }[config.pointsType]
              }
            </div>
            <div className={styles.idleActions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => startTest(false)}>
                Comenzar
              </button>
              {session?.status === 'in-progress' && (
                <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => startTest(true)}>
                  Reanudar sesión
                </button>
              )}
            </div>
            {bestResult && (
              <div className={styles.idleLastResult}>
                Último mejor resultado: {Math.round(bestResult.score * 10) / 10}/{bestResult.maxScore} — {bestResult.passed ? 'Aprobado' : 'Suspendido'}
              </div>
            )}
          </div>
        )}

        {/* IN PROGRESS */}
        {state === 'in-progress' && currentQuestion && (
          <>
            <TestProgressBar
              current={currentIndex}
              total={selectedQuestions.length}
              timerDisplay={timerDisplay}
              timerWarning={timerWarning}
            />
            <div className={styles.questionTitle}>
              {currentQuestion.title}
            </div>
            <QuestionRenderer
              question={currentQuestion}
              userAnswer={currentAnswer}
              showFeedback={showFeedback}
              onAnswer={handleAnswer}
            />
            <div className={styles.questionNav}>
              <button
                className={`${styles.navBtn} ${currentIndex > 0 ? styles.navBtnActive : ''}`}
                onClick={() => navigate(-1)}
                disabled={currentIndex === 0}
              >
                ← Anterior
              </button>
              {currentIndex < selectedQuestions.length - 1 ? (
                <button className={`${styles.navBtn} ${styles.navBtnActive}`} onClick={() => navigate(1)}>
                  Siguiente →
                </button>
              ) : (
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={finishTest}>
                  Enviar test
                </button>
              )}
            </div>
          </>
        )}

        {/* TIME UP overlay (warn mode) */}
        {timeUpWarning && state === 'in-progress' && (
          <div className={styles.timeUpOverlay}>
            <div className={styles.timeUpText}>Tiempo agotado</div>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={finishTest}>
              Enviar respuestas
            </button>
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setTimeUpWarning(false)}
              style={{ marginTop: '0.5rem' }}
            >
              Continuar respondiendo
            </button>
          </div>
        )}

        {/* RESULTS */}
        {state === 'results' && result && (
          <TestResults
            result={result}
            config={config}
            questions={selectedQuestions}
            onRetry={handleRetry}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/test/Test.tsx
git commit -m "feat(test): add Test orchestrator with state machine and scoring"
```

---

## Task 14: ModuleTest

**Files:**
- Create: `src/components/test/ModuleTest.tsx`
- Create: `src/components/test/ModuleTest.module.css`

- [ ] **Step 1: Create the CSS**

```css
/* src/components/test/ModuleTest.module.css */

.moduleTest {
  margin: 1.5rem 0;
}

.moduleHeader {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.moduleTitle {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ifm-color-primary);
  opacity: 0.7;
}

.progressInfo {
  display: flex;
  justify-content: space-between;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.6;
}

.progressTrack {
  background: var(--ifm-background-color);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.progressFill {
  background: var(--ifm-color-primary);
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.testList {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.testItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 0.9rem;
  background: var(--ifm-background-color);
  border-radius: 6px;
  border-left: 3px solid rgba(128, 128, 128, 0.3);
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.testItem:hover {
  border-left-color: var(--ifm-color-primary);
}

.testItemPassed {
  border-left-color: var(--ifm-color-primary);
}

.testItemFailed {
  border-left-color: #e74c3c;
}

.testItemTitle {
  font-size: 0.88rem;
  font-weight: 500;
}

.testItemMeta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  opacity: 0.6;
  margin-top: 0.15rem;
}

.testItemStatus {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
}

.statusPassed {
  color: var(--ifm-color-primary);
}

.statusFailed {
  color: #e74c3c;
}

.statusPending {
  opacity: 0.4;
}

.expandedTest {
  margin-top: 0.5rem;
}

@media (prefers-reduced-motion: reduce) {
  .progressFill,
  .testItem {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the component**

```tsx
// src/components/test/ModuleTest.tsx
import React, { useState } from 'react';
import type { ModuleTestEntry, TestResult } from './types';
import Test from './Test';
import styles from './ModuleTest.module.css';

interface ModuleTestProps {
  title?: string;
  tests: ModuleTestEntry[];
}

function getResults(testId: string): TestResult[] {
  try {
    const raw = localStorage.getItem(`test-results-${testId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getBestResult(results: TestResult[]): TestResult | null {
  if (results.length === 0) return null;
  return results.reduce((best, r) => r.score > best.score ? r : best);
}

export default function ModuleTest({ title = 'Tests del módulo', tests }: ModuleTestProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const testStatuses = tests.map(t => {
    const results = getResults(t.id);
    const best = getBestResult(results);
    return { ...t, results, best, passed: best?.passed ?? false };
  });

  const passedCount = testStatuses.filter(t => t.passed).length;
  const percent = tests.length > 0 ? Math.round((passedCount / tests.length) * 100) : 0;

  const handleToggle = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    // Force re-read localStorage when collapsing (results may have changed)
    forceUpdate(n => n + 1);
  };

  return (
    <div className="demo-wrapper">
      <div className="demo-header">
        <span className="demo-badge">✎ Tests</span>
        <h3>{title}</h3>
      </div>
      <div className="demo-body">
        <div className={styles.moduleHeader}>
          <div className={styles.progressInfo}>
            <span>{passedCount} de {tests.length} aprobados</span>
            <span>{percent}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className={styles.testList}>
          {testStatuses.map(t => (
            <div key={t.id}>
              <div
                className={`${styles.testItem} ${t.passed ? styles.testItemPassed : t.best && !t.passed ? styles.testItemFailed : ''}`}
                onClick={() => handleToggle(t.id)}
              >
                <div>
                  <div className={styles.testItemTitle}>{t.title}</div>
                  <div className={styles.testItemMeta}>
                    {t.best
                      ? `${Math.round(t.best.score * 10) / 10}/${t.best.maxScore}`
                      : 'Sin intentos'}
                  </div>
                </div>
                <div className={`${styles.testItemStatus} ${t.passed ? styles.statusPassed : t.best ? styles.statusFailed : styles.statusPending}`}>
                  {t.passed ? 'Aprobado' : t.best ? 'Suspendido' : 'Pendiente'}
                </div>
              </div>
              {expandedId === t.id && (
                <div className={styles.expandedTest}>
                  <Test config={t.config} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/test/ModuleTest.tsx src/components/test/ModuleTest.module.css
git commit -m "feat(test): add ModuleTest container with aggregated progress"
```

---

## Task 15: Sample test data & MDX integration

**Files:**
- Create: `docs/terraform/tests/test-data.ts`
- Modify: `docs/terraform/tests/tests.mdx`

- [ ] **Step 1: Create sample test data**

```typescript
// docs/terraform/tests/test-data.ts
import type { TestConfig } from '@site/src/components/test/types';

export const testIntroduction: TestConfig = {
  id: 'tf-intro',
  title: 'Introducción a Terraform',
  numberOfQuestions: 5,
  time: 10,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'intro-1',
      title: '¿Cuál es la función principal de terraform plan?',
      type: 'select',
      points: 2,
      explanation: 'terraform plan genera un plan de ejecución que muestra qué acciones tomará Terraform sin aplicar cambios reales.',
      answers: [
        'Aplicar cambios en la infraestructura',
        'Mostrar una preview de los cambios sin aplicarlos',
        'Destruir todos los recursos',
        'Inicializar el directorio de trabajo',
      ],
      correctAnswer: 1,
    },
    {
      id: 'intro-2',
      title: '¿Qué archivos utiliza Terraform para definir infraestructura?',
      type: 'select',
      points: 2,
      explanation: 'Terraform utiliza archivos con extensión .tf escritos en HCL (HashiCorp Configuration Language).',
      answers: [
        'Archivos .yaml',
        'Archivos .tf',
        'Archivos .json exclusivamente',
        'Archivos .xml',
      ],
      correctAnswer: 1,
    },
    {
      id: 'intro-3',
      title: '¿Cuáles son ventajas de Infrastructure as Code? (Selecciona todas las correctas)',
      type: 'multiselect',
      points: 3,
      explanation: 'IaC permite versionado, reproducibilidad y automatización de la infraestructura.',
      answers: [
        'Versionado con Git',
        'Reproducibilidad entre entornos',
        'Requiere acceso manual al portal cloud',
        'Automatización en pipelines CI/CD',
      ],
      correctAnswer: [0, 1, 3],
    },
    {
      id: 'intro-4',
      title: 'Une cada comando de Terraform con su función',
      type: 'match',
      points: 4,
      explanation: 'init descarga providers, plan muestra preview, apply ejecuta cambios, destroy elimina recursos.',
      matchPairs: [
        { left: 'terraform init', right: 'Descarga providers y módulos' },
        { left: 'terraform plan', right: 'Muestra preview de cambios' },
        { left: 'terraform apply', right: 'Ejecuta los cambios' },
        { left: 'terraform destroy', right: 'Elimina todos los recursos' },
      ],
    },
    {
      id: 'intro-5',
      title: 'Clasifica cada elemento en su categoría',
      type: 'classify',
      points: 4,
      explanation: 'hashicorp/aws y hashicorp/google son providers, lifecycle y dynamic son reserved keywords, plan y apply son commands.',
      categories: ['Providers', 'Reserved Keywords', 'Commands'],
      classifyItems: [
        { text: 'hashicorp/aws', category: 'Providers' },
        { text: 'hashicorp/google', category: 'Providers' },
        { text: 'lifecycle', category: 'Reserved Keywords' },
        { text: 'dynamic', category: 'Reserved Keywords' },
        { text: 'plan', category: 'Commands' },
        { text: 'apply', category: 'Commands' },
      ],
    },
  ],
};
```

- [ ] **Step 2: Update the tests.mdx page**

```mdx
---
sidebar_position: 1
title: "Autoevaluación y tests"
description: "Ejercicios prácticos y tests para evaluar tus conocimientos en Terraform: desde fundamentos hasta patrones avanzados."
---

import ModuleTest from '@site/src/components/test/ModuleTest';
import { testIntroduction } from './test-data';

# Tests de Terraform

Evalúa tus conocimientos con estos tests interactivos. Tu progreso se guarda automáticamente en el navegador.

<ModuleTest tests={[
  { id: 'tf-intro', title: 'Introducción a Terraform', config: testIntroduction },
]} />
```

- [ ] **Step 3: Run dev server and verify**

Run: `cd /Users/salva/Documents/WORKING/materials && bun run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add docs/terraform/tests/test-data.ts docs/terraform/tests/tests.mdx
git commit -m "feat(test): add sample Terraform test data and MDX page"
```

---

## Task 16: Visual verification & polish

- [ ] **Step 1: Start dev server**

Run: `cd /Users/salva/Documents/WORKING/materials && bun run start`
Expected: Dev server starts on localhost:3000

- [ ] **Step 2: Manual verification checklist**

Open `http://localhost:3000/materials/terraform/tests/tests` and verify:

1. ModuleTest card renders with progress bar (0/1 pending)
2. Click test → expands inline with Test component
3. Click "Comenzar" → questions render with timer
4. Select answer → option highlights
5. Navigate between questions → progress bar updates
6. Answer all → click "Enviar test" → Results screen shows
7. Results: score, stats grid, "Revisar respuestas" expands review
8. "Reintentar" → back to IDLE
9. Close tab → reopen → "Reanudar sesión" button appears
10. Light/dark mode toggle → colors follow CSS variables

- [ ] **Step 3: Fix any issues found during verification**

Address any visual or functional issues found in step 2.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(test): visual polish from manual verification"
```
