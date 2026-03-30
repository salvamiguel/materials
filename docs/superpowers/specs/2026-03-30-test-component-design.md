# Test & ModuleTest Component System — Design Spec

**Date:** 2026-03-30
**Approach:** Composable modular (Approach B)
**Stack:** React 19, TypeScript, CSS Modules, localStorage

---

## Overview

A quiz/test system for the Docusaurus documentation site. Two main components:

- **`<ModuleTest>`** — inline card that groups N tests, shows aggregated progress from localStorage.
- **`<Test>`** — full test engine: timer, question navigation, scoring, persistence, results with statistics.

Supports 4 question types: `select`, `multiselect`, `match` (connect pairs via lines), `classify` (drag items to columns). Full touch + mouse support.

---

## Data Model

### Types

```typescript
type QuestionType = 'select' | 'multiselect' | 'match' | 'classify';
type PointsType = 'over100' | 'over10' | 'over5' | 'percent';
type OnTimeUp = 'submit' | 'warn';
```

### Question

```typescript
interface Question {
  id: string;
  title: string;
  type: QuestionType;
  points: number;
  explanation: string;

  // select / multiselect
  answers?: string[];
  correctAnswer?: number | number[];    // index(es) into answers[]

  // match
  matchPairs?: { left: string; right: string }[];

  // classify
  categories?: string[];                // e.g. ["Providers", "Reserved Keywords", "Commands"]
  classifyItems?: {
    text: string;
    category: string;                   // correct category
  }[];
}
```

### TestConfig (props passed to `<Test>`)

```typescript
interface TestConfig {
  id: string;
  title: string;
  questions: Question[];
  numberOfQuestions: number;            // if < questions.length → random selection
  time: number;                         // minutes
  pointsType: PointsType;
  minForPass: number;                   // in pointsType scale
  onTimeUp: OnTimeUp;
}
```

### TestSession (persisted in localStorage during test)

```typescript
interface TestSession {
  testId: string;
  selectedQuestionIds: string[];        // the randomly chosen subset
  currentQuestionIndex: number;         // last viewed question
  answers: Record<string, UserAnswer>;
  timeRemainingMs: number;
  startedAt: string;                    // ISO timestamp
  status: 'in-progress' | 'completed';
}
```

### UserAnswer

```typescript
interface UserAnswer {
  questionId: string;
  answeredAt: string;
  timeSpentMs: number;

  // select / multiselect
  selectedIndices?: number[];

  // match
  matchedPairs?: { left: string; right: string }[];

  // classify
  classifiedItems?: { text: string; category: string }[];
}
```

### TestResult (persisted in localStorage after completion)

```typescript
interface TestResult {
  testId: string;
  completedAt: string;
  score: number;                        // in pointsType scale
  maxScore: number;
  passed: boolean;
  totalTimeMs: number;
  questionResults: QuestionResult[];
}

interface QuestionResult {
  questionId: string;
  correct: boolean;
  pointsEarned: number;
  pointsPossible: number;
  timeSpentMs: number;
  userAnswer: UserAnswer;
}
```

### Scoring

Sum of earned points scaled to the `pointsType`. Example: total possible = 50 raw points, user earns 35, pointsType = `over10` → score = `35/50 * 10 = 7/10`.

---

## Component Architecture

### File Structure

```
src/components/test/
├── ModuleTest.tsx
├── ModuleTest.module.css
├── Test.tsx
├── Test.module.css
├── TestProgressBar.tsx
├── QuestionRenderer.tsx
├── QuestionSelect.tsx
├── QuestionMultiSelect.tsx
├── QuestionMatch.tsx
├── QuestionClassify.tsx
├── TestResults.tsx
├── hooks/
│   ├── useTestTimer.ts
│   ├── useTestStorage.ts
│   └── useDragAndDrop.ts
└── types.ts
```

### Component Tree

```
<ModuleTest>                  — card with aggregated progress of N tests
  <Test>                      — orchestrator: timer, navigation, state, localStorage
    <TestProgressBar />       — progress bar + countdown timer
    <QuestionRenderer />      — switch by type → correct question component
      <QuestionSelect />      — radio buttons
      <QuestionMultiSelect /> — checkboxes
      <QuestionMatch />       — connect pairs via SVG lines (touch + mouse)
      <QuestionClassify />    — drag items into columns (touch + mouse)
    <TestResults />           — score + review + statistics
```

### Hooks

| Hook | Responsibility |
|------|---------------|
| `useTestTimer` | Countdown with configurable duration. Auto-pauses on `visibilitychange` (tab hidden). Resumes on return. Fires `onTimeUp` callback. |
| `useTestStorage` | Read/write `TestSession` and `TestResult[]` to localStorage. Key pattern: `test-session-{id}`, `test-results-{id}`. Reset by testId. |
| `useDragAndDrop` | Shared by QuestionMatch and QuestionClassify. Handles mousedown/mousemove/mouseup + touchstart/touchmove/touchend. Snap-to-target. Visual feedback during drag. |

---

## State Machine

```
IDLE → IN_PROGRESS → RESULTS
                  ↗
         TIME_UP →  (onTimeUp: 'submit' → auto-submits)
                  ↘
                    IN_PROGRESS  (onTimeUp: 'warn' → shows warning, lets user continue)

IN_PROGRESS ↔ PAUSED  (automatic: tab hidden / page navigation → saves to localStorage)

RESULTS → IDLE  (reset button)
```

---

## Screens

### 1. IDLE (start screen)

- Test title, metadata: N questions, time limit, minimum passing score
- **"Comenzar"** button (primary)
- **"Reanudar sesión"** button (secondary) — visible only if a `TestSession` with `status: 'in-progress'` exists in localStorage
- Last attempt result if a `TestResult` exists: score + passed/failed

### 2. IN_PROGRESS (active question)

- **Progress bar** at top: question X/N on the left, countdown timer on the right
- Bar fills proportionally (question index / total)
- Timer shows `MM:SS`, turns warning color when < 20% time remaining
- **Question area**: title + type-specific input component
- **Navigation**: "← Anterior" / "Siguiente →" buttons. "Enviar test" button on last question.
- User can navigate freely between questions

### 3. Feedback (after answering — inline, not a separate screen)

When the user answers incorrectly and navigates away:
- Wrong answer highlighted in red with ✗
- Correct answer highlighted in primary color with ✓
- Explanation panel: left border in info color, contains the `explanation` text
- For correct answers: brief confirmation with ✓, no explanation shown

### 4. TIME_UP

- If `onTimeUp: 'submit'`: automatically submits all answered questions, unanswered count as 0 points → transitions to RESULTS
- If `onTimeUp: 'warn'`: overlay warning "Tiempo agotado", timer shows 00:00 in red, user can still answer and submit manually. Results will show a "fuera de tiempo" badge.

### 5. RESULTS

Three sub-sections:

**Summary:**
- Large score display (e.g., "8/10")
- Passed/failed badge
- Time spent, minimum required score

**Statistics:**
- Accuracy % by question type (grid of 4 cards: Select, MultiSelect, Match, Classify)
- Average time per question
- Score vs minForPass visual comparison

**Review:**
- "Revisar respuestas" button expands a scrollable list
- Each question shows: title, user's answer, correct answer, explanation, points earned/possible, time spent
- Color-coded: green for correct, red for incorrect

**Actions:**
- "Reintentar" button → resets session, new random selection if applicable, back to IDLE
- "Reset" link → clears all localStorage data for this test

---

## Question Types Detail

### Select

- Radio button list, single selection
- Options displayed as bordered cards (not native radio inputs)
- Selected option gets primary border + subtle background
- Correct answer: single index in `correctAnswer`

### MultiSelect

- Checkbox list, multiple selection
- Same card style as Select but with checkbox indicator
- Hint text: "Selecciona todas las correctas"
- Correct answer: array of indices in `correctAnswer`

### Match (connect pairs)

**Layout:**
- Two columns of boxes with circle connectors on edges
- Left column: concepts (circles on right edge)
- Right column: definitions (circles on left edge)
- Right column items are displayed in shuffled order

**Interaction — Desktop:**
- Click left circle → circle fills with primary color, "drawing" state active
- Click right circle → SVG line drawn between the two circles
- Line positions calculated dynamically with `getBoundingClientRect()`
- Lines redraw on window resize
- Click an existing line to remove it

**Interaction — Mobile (tap-to-select):**
- Tap left box → box highlights with primary glow
- Tap right box → connection made
- Tap connected pair to disconnect

**Visual feedback:**
- Connected pairs: both boxes get primary border + background, line in primary color
- Active/selected source: neon glow (box-shadow with primary color)
- Unconnected: default border

### Classify (drag to columns)

**Layout:**
- **Top:** pool of draggable items (flex-wrap row)
- **Bottom:** category columns (CSS grid, equal width)
- Columns have dashed border, category label at top

**Interaction — Desktop:**
- Drag item from pool → drop on column
- Item snaps into column, styled with primary border
- Items can be dragged between columns or back to pool

**Interaction — Mobile (tap-to-select):**
- Tap item in pool → item highlights with primary glow
- Tap target column → item moves there
- Tap item in column → returns to pool (or tap another column to move)

**Visual feedback:**
- Dragging: item follows cursor/finger with slight scale + shadow
- Drop target: column border changes from dashed gray to dashed primary when hovering over
- Placed items: primary border + background inside the column

---

## Styling

All components use the project's existing design system:

- **Container:** `.demo-wrapper` with primary border and neon glow (`box-shadow: 0 0 X rgba(primary)`)
- **Badge:** `.demo-badge` style for "TEST" label
- **Colors:** exclusively CSS variables — `--ifm-color-primary`, `--ifm-background-surface-color`, `--ifm-font-color-base`, etc.
- **Fonts:** Syne for headings, Inter for body, JetBrains Mono for labels/code/badges
- **Buttons:** follow `LabActions` pattern — `.btnPrimary` (filled), `.btnSecondary` (outlined)
- **Border radius:** 6px buttons, 8-10px panels
- **Transitions:** 0.15s ease for interactions, 0.1s ease for transforms
- **Dark/Light mode:** automatic via CSS variables, no hardcoded colors
- **Reduced motion:** respect `prefers-reduced-motion` media query

---

## Persistence (localStorage)

### Keys

| Key | Value | Lifecycle |
|-----|-------|-----------|
| `test-session-{id}` | `TestSession` | Created on start, updated on every answer/navigation, deleted on completion |
| `test-results-{id}` | `TestResult[]` | Array of all attempts, persists indefinitely |

### Session Persistence

- On every answer: save updated `TestSession` (answers + timeRemainingMs)
- On tab hidden (`visibilitychange`): save current timeRemainingMs
- On tab visible: restore session, resume timer from saved timeRemainingMs
- On "Reanudar sesión": load full session, restore question index, answers, timer

### Reset

- "Reintentar" button: deletes current session, keeps result history, starts fresh
- "Reset completo": deletes both session and all results for this testId

---

## ModuleTest Component

### Props

```typescript
interface ModuleTestProps {
  title?: string;                       // default: "Tests del módulo"
  tests: {
    id: string;
    title: string;
    config: TestConfig;
  }[];
}
```

### Behavior

- Reads `test-results-{id}` from localStorage for each test
- Shows aggregated progress bar: N of M tests passed
- List of tests with: title, best score, status (Aprobado/Suspendido/Pendiente)
- Clicking a test expands it inline to show the `<Test>` component
- Border-left color per test: primary = passed, muted = pending, red = failed

### MDX Usage

```mdx
import ModuleTest from '@site/src/components/test/ModuleTest';
import { testVariables, testState, testModulos } from './test-data';

<ModuleTest tests={[
  { id: 'tf-variables', title: 'Variables y Outputs', config: testVariables },
  { id: 'tf-state', title: 'State y Backends', config: testState },
  { id: 'tf-modulos', title: 'Módulos', config: testModulos },
]} />
```

---

## Accessibility

- All interactive elements are keyboard navigable (Tab, Enter, Space, Arrow keys)
- Match: arrow keys to move between circles, Enter to connect
- Classify: arrow keys to select items, Enter to place in focused column
- ARIA roles: `role="radiogroup"` for Select, `role="group"` for MultiSelect
- Progress bar: `role="progressbar"` with `aria-valuenow`
- Timer: `aria-live="polite"` region, `aria-live="assertive"` when < 20% time
- Focus indicators visible on all interactive elements
- `prefers-reduced-motion`: disable animations, instant transitions

---

## Mobile Responsiveness

- Match: columns stack vertically on screens < 480px, tap-to-connect replaces line drawing
- Classify: columns reduce to 2-column grid on mobile, 1-column on very small screens
- Progress bar and timer remain fixed at top during scroll
- Touch targets minimum 44x44px
- `useDragAndDrop` detects `'ontouchstart' in window` to switch between drag and tap-to-select modes
