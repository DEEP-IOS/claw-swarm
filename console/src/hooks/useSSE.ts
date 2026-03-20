import { useEffect, useCallback, useRef } from 'react';
import { sseManager } from '../api/sse-manager';

/**
 * Subscribe to SSE events by topic pattern.
 * Supports wildcards: 'agent.lifecycle.*' matches all agent lifecycle events.
 */
export function useSSE(pattern: string, handler: (data: unknown, topic: string) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((data: unknown, topic: string) => {
    handlerRef.current(data, topic);
  }, []);

  useEffect(() => {
    return sseManager.subscribe(pattern, stableHandler);
  }, [pattern, stableHandler]);
}
