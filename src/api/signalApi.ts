// 신호 히트맵 REST 클라이언트 — 계약 §4.2~§4.5.
// 모든 호출은 ApiResponse 봉투를 벗겨 data 를 돌려주며, 실패 시 throw 한다.
// (호출부는 try/catch 로 감싸 빈 상태를 표시하고 절대 크래시하지 않는다.)
import type {
  ApiResponse,
  CellFeatureCollection,
  Environment,
  HistoryResponse,
  Metric,
  SignalFloor,
  SignalMeasurement,
} from '../types/signal';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  if (!body || body.success !== true || body.data == null) {
    throw new Error('empty response');
  }
  return body.data;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface CellsQuery {
  environment: Environment;
  metric?: Metric;
  from?: string;
  to?: string;
  floorId?: number;
  deviceId?: string;
  /** avg = 기간 내 평균(기본) · latest = 셀별 최신 측정값(현재 상태 보기) */
  agg?: 'avg' | 'latest';
}

// §4.2 GET /api/signal/cells → GeoJSON FeatureCollection
export function fetchCells(q: CellsQuery): Promise<CellFeatureCollection> {
  return getJson<CellFeatureCollection>(
    `/api/signal/cells${qs({
      environment: q.environment,
      metric: q.metric,
      from: q.from,
      to: q.to,
      floorId: q.floorId,
      deviceId: q.deviceId,
      agg: q.agg,
    })}`,
  );
}

export interface MeasurementsQuery {
  from?: string;
  to?: string;
  deviceId?: string;
  environment?: Environment;
  floorId?: number;
  limit?: number;
}

// §4.3 GET /api/signal/measurements → 측정 포인트 배열
export function fetchMeasurements(q: MeasurementsQuery): Promise<SignalMeasurement[]> {
  return getJson<SignalMeasurement[]>(
    `/api/signal/measurements${qs({
      from: q.from,
      to: q.to,
      deviceId: q.deviceId,
      environment: q.environment,
      floorId: q.floorId,
      limit: q.limit,
    })}`,
  );
}

export interface HistoryQuery {
  deviceId: string;
  from?: string;
  to?: string;
  bucketSeconds?: number;
}

// §4.4 GET /api/signal/history → 시계열 points
export function fetchHistory(q: HistoryQuery): Promise<HistoryResponse> {
  return getJson<HistoryResponse>(
    `/api/signal/history${qs({
      deviceId: q.deviceId,
      from: q.from,
      to: q.to,
      bucketSeconds: q.bucketSeconds,
    })}`,
  );
}

// §4.5 GET /api/signal/floors → 층 목록
export function fetchFloors(): Promise<SignalFloor[]> {
  return getJson<SignalFloor[]>('/api/signal/floors');
}

// §4.5 층 이미지(바이너리) URL — <img src> 로 직접 사용.
export function floorImageUrl(floorId: number): string {
  return `/api/signal/floors/${floorId}/image`;
}
