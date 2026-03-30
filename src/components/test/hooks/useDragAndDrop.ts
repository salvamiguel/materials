import { useState, useRef, useCallback, useEffect } from 'react';

export interface DragItem {
  id: string;
  text: string;
}

interface Position {
  x: number;
  y: number;
}

interface UseDragAndDropProps {
  onDrop: (itemId: string, targetId: string) => void;
}

export function useDragAndDrop({ onDrop }: UseDragAndDropProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<Position | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });
  const isTouchRef = useRef(false);

  useEffect(() => {
    isTouchRef.current = 'ontouchstart' in window;
  }, []);

  const handleTapItem = useCallback((itemId: string) => {
    if (!isTouchRef.current) return;
    setSelectedId(prev => prev === itemId ? null : itemId);
  }, []);

  const handleTapTarget = useCallback((targetId: string) => {
    if (!isTouchRef.current || !selectedId) return;
    onDrop(selectedId, targetId);
    setSelectedId(null);
  }, [selectedId, onDrop]);

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, itemId: string) => {
    if (isTouchRef.current) return;
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    setDraggingId(itemId);
    setDragPos({ x: clientX, y: clientY });
  }, []);

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      setDragPos({ x: clientX, y: clientY });
    };

    const handleEnd = (e: MouseEvent | TouchEvent) => {
      const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
      const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;

      const elements = document.elementsFromPoint(clientX, clientY);
      const target = elements.find(el => el.hasAttribute('data-drop-target'));
      if (target) {
        const targetId = target.getAttribute('data-drop-target')!;
        onDrop(draggingId, targetId);
      }

      setDraggingId(null);
      setDragPos(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [draggingId, onDrop]);

  return {
    draggingId,
    dragPos,
    selectedId,
    dragOffset: dragOffsetRef.current,
    isTouchDevice: isTouchRef.current,
    handleDragStart,
    handleTapItem,
    handleTapTarget,
  };
}
