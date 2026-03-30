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
