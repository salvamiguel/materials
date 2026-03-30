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
