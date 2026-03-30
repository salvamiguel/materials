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
