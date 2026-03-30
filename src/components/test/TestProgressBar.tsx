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
