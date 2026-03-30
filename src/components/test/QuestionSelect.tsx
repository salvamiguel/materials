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
      timeSpentMs: 0,
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
