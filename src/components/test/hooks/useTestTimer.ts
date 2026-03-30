import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTestTimerProps {
  initialMs: number;
  running: boolean;
  onTimeUp: () => void;
}

export function useTestTimer({ initialMs, running, onTimeUp }: UseTestTimerProps) {
  const [remainingMs, setRemainingMs] = useState(initialMs);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const setTime = useCallback((ms: number) => {
    setRemainingMs(ms);
    lastTickRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!running) {
      stop();
      return;
    }

    lastTickRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      setRemainingMs(prev => {
        const next = Math.max(0, prev - elapsed);
        if (next === 0) {
          stop();
          setTimeout(() => onTimeUpRef.current(), 0);
        }
        return next;
      });
    }, 250);

    return stop;
  }, [running, stop]);

  useEffect(() => {
    if (!running) return;

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        lastTickRef.current = Date.now();
        if (!intervalRef.current) {
          setRemainingMs(prev => prev);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [running, stop]);

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { remainingMs, display, setTime, stop };
}
