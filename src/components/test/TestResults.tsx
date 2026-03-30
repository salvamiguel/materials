import React, { useState } from 'react';
import type { TestResult, TestConfig, Question, PointsType } from './types';
import styles from './Test.module.css';

interface TestResultsProps {
  result: TestResult;
  config: TestConfig;
  questions: Question[];
  onRetry: () => void;
  onReset: () => void;
  onClose?: () => void;
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

export default function TestResults({ result, config, questions, onRetry, onReset, onClose }: TestResultsProps) {
  const [showReview, setShowReview] = useState(false);
  const scoreDisplay = formatScore(result.score, result.maxScore, config.pointsType);

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
      <div className={styles.scoreBig}>{scoreDisplay}</div>
      <div className={`${styles.resultBadge} ${result.passed ? styles.passed : styles.failed}`}>
        {result.passed ? 'Aprobado' : 'Suspendido'}
      </div>
      <div className={styles.resultMeta}>
        Tiempo: {formatTime(result.totalTimeMs)} · Mínimo: {formatScore(config.minForPass, result.maxScore, config.pointsType)}
      </div>

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

      <div className={styles.resultActions}>
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setShowReview(!showReview)}>
          {showReview ? 'Ocultar respuestas' : 'Revisar respuestas'}
        </button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRetry}>
          Reintentar
        </button>
        {onClose && (
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
            ← Volver
          </button>
        )}
      </div>

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
