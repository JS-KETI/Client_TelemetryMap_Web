// 신호 측정 저장소 — deviceId 별 링 버퍼(전체 최대 ~5000 포인트).
// snapshot 은 전체 교체, upsert 는 병합(중복 제거)한다.
import { useCallback, useMemo, useReducer } from 'react';
import type { SignalMeasurement } from '../types/signal';

const MAX_TOTAL = 5000;
const MAX_PER_DEVICE = 2000;

export type SignalState = Map<string, SignalMeasurement[]>; // deviceId → recordedAt 오름차순

type Action =
  | { type: 'SNAPSHOT'; measurements: SignalMeasurement[] }
  | { type: 'UPSERT'; measurements: SignalMeasurement[] }
  | { type: 'REMOVE_DEVICE'; deviceId: string };

function keyOf(m: SignalMeasurement): string {
  if (m.id != null) return `id:${m.id}`;
  if (m.clientRecordId) return `c:${m.clientRecordId}`;
  return `t:${m.deviceId}:${m.recordedAt}`;
}

function byRecordedAt(a: SignalMeasurement, b: SignalMeasurement): number {
  return a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0;
}

// 전체 포인트 수가 MAX_TOTAL 을 넘으면 가장 오래된 것부터 제거.
function enforceTotalCap(map: SignalState): void {
  let total = 0;
  for (const arr of map.values()) total += arr.length;
  if (total <= MAX_TOTAL) return;

  const flat: SignalMeasurement[] = [];
  for (const arr of map.values()) flat.push(...arr);
  flat.sort(byRecordedAt);
  const keep = new Set<string>(flat.slice(flat.length - MAX_TOTAL).map(keyOf));

  for (const [dev, arr] of map) {
    const trimmed = arr.filter((m) => keep.has(keyOf(m)));
    if (trimmed.length > 0) map.set(dev, trimmed);
    else map.delete(dev);
  }
}

function ingest(base: SignalState, incoming: SignalMeasurement[]): SignalState {
  const next: SignalState = new Map(base);
  const touched = new Set<string>();

  for (const m of incoming) {
    if (!m || !m.deviceId) continue;
    if (!touched.has(m.deviceId)) {
      next.set(m.deviceId, [...(next.get(m.deviceId) ?? [])]);
      touched.add(m.deviceId);
    }
    next.get(m.deviceId)!.push(m);
  }

  for (const dev of touched) {
    const byKey = new Map<string, SignalMeasurement>();
    for (const m of next.get(dev)!) byKey.set(keyOf(m), m); // 마지막 것이 우선(중복 제거)
    const dedup = Array.from(byKey.values()).sort(byRecordedAt);
    next.set(dev, dedup.length > MAX_PER_DEVICE ? dedup.slice(dedup.length - MAX_PER_DEVICE) : dedup);
  }

  enforceTotalCap(next);
  return next;
}

function reducer(state: SignalState, action: Action): SignalState {
  switch (action.type) {
    case 'SNAPSHOT':
      return ingest(new Map(), action.measurements);
    case 'UPSERT':
      return ingest(state, action.measurements);
    case 'REMOVE_DEVICE': {
      if (!state.has(action.deviceId)) return state;
      const next = new Map(state);
      next.delete(action.deviceId);
      return next;
    }
    default:
      return state;
  }
}

export interface DeviceLatest {
  deviceId: string;
  latest: SignalMeasurement; // 가장 최근 측정 (환경 무관)
  latestOutdoor: SignalMeasurement | null; // 최신 실외(위경도 有) 측정
  count: number;
}

export function useSignalStore() {
  const [measurements, dispatch] = useReducer(reducer, new Map() as SignalState);

  const handleSnapshot = useCallback((list: SignalMeasurement[]) => {
    dispatch({ type: 'SNAPSHOT', measurements: list });
  }, []);

  const handleUpsert = useCallback((list: SignalMeasurement[]) => {
    dispatch({ type: 'UPSERT', measurements: list });
  }, []);

  // 측정 종료 신호 — 해당 기기를 라이브 뷰에서 즉시 제거 (서버 이력·히트맵은 유지).
  const handleDeviceStop = useCallback((deviceId: string) => {
    dispatch({ type: 'REMOVE_DEVICE', deviceId });
  }, []);

  // deviceId 목록 (정렬)
  const deviceIds = useMemo(() => Array.from(measurements.keys()).sort(), [measurements]);

  // 기기별 최신 요약 (라이브 지도/패널용)
  const deviceLatest = useMemo<DeviceLatest[]>(() => {
    const out: DeviceLatest[] = [];
    for (const [deviceId, arr] of measurements) {
      if (arr.length === 0) continue;
      const latest = arr[arr.length - 1];
      let latestOutdoor: SignalMeasurement | null = null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        if (m.latitude != null && m.longitude != null) {
          latestOutdoor = m;
          break;
        }
      }
      out.push({ deviceId, latest, latestOutdoor, count: arr.length });
    }
    return out.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }, [measurements]);

  return { measurements, deviceIds, deviceLatest, handleSnapshot, handleUpsert, handleDeviceStop };
}
