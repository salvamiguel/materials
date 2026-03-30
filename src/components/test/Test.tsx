import React, { useState, useCallback, useRef } from 'react';
import { VscChecklist } from 'react-icons/vsc';
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
  onClose?: () => void;
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

export default function Test({ config, onClose }: TestProps) {
  const { session, bestResult, saveSession, clearSession, addResult, clearAll } = useTestStorage(config.id);

  const [state, setState] = useState<TestState>('idle');
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
  const [confirmedQuestions, setConfirmedQuestions] = useState<Set<string>>(new Set());
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
    setConfirmedQuestions(new Set());
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
    // Mark current question as confirmed (enables feedback on revisit)
    if (currentQuestion && answers[currentQuestion.id]) {
      setConfirmedQuestions(prev => new Set(prev).add(currentQuestion.id));
    }
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

  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const showFeedback = currentQuestion !== undefined && confirmedQuestions.has(currentQuestion.id) && state === 'in-progress';

  return (
    <div className="demo-wrapper">
      <div className="demo-header">
        <span className="demo-badge"><VscChecklist /> Test</span>
        <h3>{config.title}</h3>
      </div>
      <div className={`demo-body ${styles.testWrapper}`}>
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

        {state === 'results' && result && (
          <TestResults
            result={result}
            config={config}
            questions={selectedQuestions}
            onRetry={handleRetry}
            onReset={handleReset}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
