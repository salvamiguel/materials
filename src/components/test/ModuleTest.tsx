import React, { useState } from 'react';
import { VscChecklist } from 'react-icons/vsc';
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
    forceUpdate(n => n + 1);
  };

  return (
    <div className="demo-wrapper">
      <div className="demo-header">
        <span className="demo-badge"><VscChecklist /> Tests</span>
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
          {testStatuses.map(t => {
            if (expandedId && expandedId !== t.id) return null;
            return (
              <div key={t.id}>
                {!expandedId && (
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
                )}
                {expandedId === t.id && (
                  <div className={styles.expandedTest}>
                    <Test config={t.config} onClose={() => handleToggle(t.id)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
