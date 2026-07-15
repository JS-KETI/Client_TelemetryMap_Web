// 신호 품질 히트맵(Telemetry Map) 웹 대시보드용 타입.
// telemetry-map-contract.md 의 DTO/GeoJSON/WS 계약을 그대로 미러링한다.

export type Environment = 'OUTDOOR' | 'INDOOR';

// 계약 §1 등급. NONE = 미측정.
export type Grade = 'GOOD' | 'FAIR' | 'POOR' | 'NONE';

// 계약 §4.2 metric 파라미터.
export type Metric = 'cellularScore' | 'wifiScore' | 'rsrp' | 'sinr' | 'wifiRssi';

// 공통 응답 봉투 (기존 엔드포인트와 동일: {success, data, error, timestamp}).
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | string | null;
  timestamp: string;
}

export interface ApiError {
  code?: string;
  message?: string;
}

// 계약 §4.3 — 측정 raw 포인트 DTO. 서버가 id/cellularScore/wifiScore/grade 를 추가한다.
export interface SignalMeasurement {
  id: number;
  clientRecordId?: string | null;
  deviceId: string;
  recordedAt: string;
  environment: Environment;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  floorId: number | null;
  xNorm: number | null;
  yNorm: number | null;
  networkType: string | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
  wifiRssi: number | null;
  wifiLinkMbps: number | null;
  cellularScore: number | null;
  wifiScore: number | null;
  grade: Grade;
}

// 계약 §3 / §4.5 — 실내 층 DTO.
export interface SignalFloor {
  id: number;
  name: string;
  sortOrder: number;
  imagePath?: string | null;
  imageWidthPx?: number | null;
  imageHeightPx?: number | null;
  metersPerPx?: number | null;
  cellSizeM: number;
}

// 계약 §10 — 측정 세션(회차) 요약.
export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  count: number;
  outdoorCount: number;
}

// 계약 §11 — 측정 이력이 있는 기기 요약 (분석 탭 기기 목록용).
export interface DeviceSummary {
  deviceId: string;
  lastRecordedAt: string;
  count: number;
  sessionCount: number;
}

// 계약 §4.4 — 차트용 시계열.
export interface HistoryPoint {
  t: string;
  rsrp: number | null;
  sinr: number | null;
  wifiRssi: number | null;
  cellularScore: number | null;
  wifiScore: number | null;
  sampleCount: number;
}

export interface HistoryResponse {
  points: HistoryPoint[];
}

// 계약 §4.2 — 히트맵 집계 GeoJSON.
// OUTDOOR: 폴리곤 좌표 = [lng, lat]. INDOOR: 폴리곤 좌표 = [xNorm, yNorm] (0..1).
export interface CellFeatureProperties {
  value: number;
  score: number;
  grade: Grade;
  sampleCount: number;
  cellLatIdx?: number;
  cellLngIdx?: number;
  cellXIdx?: number;
  cellYIdx?: number;
  floorId?: number;
}

export interface CellFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: CellFeatureProperties;
}

export interface CellFeatureCollection {
  type: 'FeatureCollection';
  features: CellFeature[];
}

// 계약 §5 — WS 봉투. signal_device_stop 은 측정 종료 신호 (payload = {deviceId}).
export type SignalWsType = 'signal_snapshot' | 'signal_upsert' | 'signal_device_stop';

export interface SignalWsMessage {
  type: SignalWsType;
  payload: { measurements?: SignalMeasurement[]; deviceId?: string };
  timestamp: string;
}
