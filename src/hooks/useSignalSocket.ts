// /ws/signal 구독 훅 — /ws/monitoring 과 동일한 raw-WebSocket + 봉투 스타일.
// 접속 시 signal_snapshot, 이후 signal_upsert 를 수신하며, 끊기면 3초 후 재접속.
// (표준 이식 대비 유일한 추가: 헤더 연결 상태 표시용 status 를 반환한다.)
import { useEffect, useRef, useState } from 'react';
import type { SignalMeasurement, SignalWsMessage } from '../types/signal';

export type SignalSocketStatus = 'connecting' | 'open' | 'closed';

interface UseSignalSocketOptions {
  url: string;
  onSnapshot: (measurements: SignalMeasurement[]) => void;
  onUpsert: (measurements: SignalMeasurement[]) => void;
}

export function useSignalSocket({ url, onSnapshot, onUpsert }: UseSignalSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const handlersRef = useRef({ onSnapshot, onUpsert });
  const [status, setStatus] = useState<SignalSocketStatus>('connecting');

  useEffect(() => {
    handlersRef.current = { onSnapshot, onUpsert };
  }, [onSnapshot, onUpsert]);

  useEffect(() => {
    intentionalCloseRef.current = false;

    const connect = () => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      setStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('open');
        console.log('[SignalWS] Connected to', url);
      };

      ws.onmessage = (event) => {
        try {
          const msg: SignalWsMessage = JSON.parse(event.data);
          const h = handlersRef.current;
          const measurements = msg.payload?.measurements ?? [];
          switch (msg.type) {
            case 'signal_snapshot':
              h.onSnapshot(measurements);
              break;
            case 'signal_upsert':
              h.onUpsert(measurements);
              break;
          }
        } catch (e) {
          console.error('[SignalWS] Parse error:', e);
        }
      };

      ws.onclose = () => {
        setStatus('closed');
        if (!intentionalCloseRef.current) {
          console.log('[SignalWS] Disconnected, reconnecting in 3s...');
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[SignalWS] Error:', err);
      };
    };

    connect();

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  return { status };
}
