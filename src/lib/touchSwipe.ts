import { useRef, type TouchEvent } from 'react';

export const SWIPE_MIN_DISTANCE_PX = 50;
export const SWIPE_DIRECTION_RATIO = 1.5;

export function detectHorizontalSwipe(
  deltaX: number,
  deltaY: number
): 'next' | 'prev' | null {
  if (
    Math.abs(deltaX) >= SWIPE_MIN_DISTANCE_PX &&
    Math.abs(deltaX) >= Math.abs(deltaY) * SWIPE_DIRECTION_RATIO
  ) {
    return deltaX < 0 ? 'next' : 'prev';
  }
  return null;
}

export function useHorizontalSwipe(
  onSwipeNext: () => void,
  onSwipePrev: () => void
) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: TouchEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'input[type="range"], select, textarea, .piano-roll-scroll, .drag-handle'
      )
    ) {
      startRef.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e: TouchEvent<HTMLElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const dir = detectHorizontalSwipe(deltaX, deltaY);
    if (dir === 'next') {
      onSwipeNext();
    } else if (dir === 'prev') {
      onSwipePrev();
    }
  };

  return { onTouchStart, onTouchEnd };
}
