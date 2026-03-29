import { useEffect, useRef } from 'react';
import type { WsPayload } from '@shared/types';
import { useAppStore } from '../store/appStore';

export const useEipWebSocket = () => {
  const updateFromPayload = useAppStore((s) => s.updateFromPayload);
  const setWsStatus = useAppStore((s) => s.setWsStatus);

  const attemptsRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    destroyedRef.current = false;

    const connect = () => {
      if (destroyedRef.current) return;

      setWsStatus('connecting');
      const ws = new WebSocket(`ws://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyedRef.current) { ws.close(); return; }
        attemptsRef.current = 0;
        setWsStatus('open');
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(e.data) as WsPayload;
          updateFromPayload(payload);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (destroyedRef.current) return;
        setWsStatus('closed');
        // exponential backoff: 1s, 2s, 4s, 8s, 16s max
        const delay = Math.min(1000 * 2 ** attemptsRef.current, 16_000);
        attemptsRef.current++;
        timeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      destroyedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      wsRef.current?.close();
    };
  }, [updateFromPayload, setWsStatus]);
};
