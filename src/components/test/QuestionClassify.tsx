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

  const poolItems = allItems.filter(item => !placements[item.text]);
  const categoryItems = (cat: string) => allItems.filter(item => placements[item.text] === cat);

  const isItemCorrect = (text: string, category: string) => {
    return allItems.some(item => item.text === text && item.category === category);
  };

  const gridCols = categories.length <= 2 ? categories.length : categories.length <= 4 ? categories.length : 3;

  return (
    <div className={styles.classifyContainer}>
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
