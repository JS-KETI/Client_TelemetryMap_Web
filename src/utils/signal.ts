// 신호 등급/점수/색상 유틸 — 계약 §1 공식·색상·라벨을 단일 출처로 구현.
import type { Grade, Metric, SignalMeasurement } from '../types/signal';

// 계약 §1 등급 색상 (web CSS).
export const GRADE_COLORS: Record<Grade, string> = {
  GOOD: '#22c55e',
  FAIR: '#f59e0b',
  POOR: '#ef4444',
  NONE: '#64748b',
};

// 계약 §9 한국어 라벨.
export const GRADE_LABELS: Record<Grade, string> = {
  GOOD: '양호',
  FAIR: '보통',
  POOR: '불량',
  NONE: '미측정',
};

// NONE(미측정) 은 §1 에 따라 35% 불투명도로 렌더.
export const NONE_OPACITY = 0.35;

export const GRADE_ORDER: Grade[] = ['GOOD', 'FAIR', 'POOR', 'NONE'];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// 계약 §1 점수 공식 (서버가 단일 출처지만 즉시 UI 표시용으로 클라도 동일 계산 가능).
export function rsrpScore(rsrp: number): number {
  return clamp((rsrp + 120) * 2.5, 0, 100);
}
export function sinrScore(sinr: number): number {
  return clamp((sinr + 10) * 2.5, 0, 100);
}
export function cellularScoreOf(rsrp: number, sinr: number | null): number {
  const r = rsrpScore(rsrp);
  if (sinr == null) return Math.round(r);
  return Math.round(0.7 * r + 0.3 * sinrScore(sinr));
}
export function wifiScoreOf(wifiRssi: number): number {
  return Math.round(clamp((wifiRssi + 95) * 2.5, 0, 100));
}

// 등급 임계값 — 기본은 계약 §1 구간(양호 ≥60, 보통 ≥25). 설정 패널에서 조정 가능, localStorage 유지.
export interface GradeThresholds {
  good: number; // score >= good → GOOD
  fair: number; // score >= fair → FAIR, 미만 → POOR
}

export const DEFAULT_THRESHOLDS: GradeThresholds = { good: 60, fair: 25 };

const THRESHOLDS_STORAGE_KEY = 'signal.thresholds';

export function loadThresholds(): GradeThresholds {
  try {
    const raw = localStorage.getItem(THRESHOLDS_STORAGE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    const parsed = JSON.parse(raw) as Partial<GradeThresholds>;
    const good = Number(parsed.good);
    const fair = Number(parsed.fair);
    if (!Number.isFinite(good) || !Number.isFinite(fair)) return DEFAULT_THRESHOLDS;
    if (fair < 0 || good > 100 || fair >= good) return DEFAULT_THRESHOLDS;
    return { good, fair };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function saveThresholds(t: GradeThresholds): void {
  try {
    localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* storage 불가 환경이면 세션 한정 적용 */
  }
}

// 점수 → 등급. null/미측정 → NONE. 임계값은 조정 가능(설정 패널).
export function gradeOfScore(
  score: number | null | undefined,
  t: GradeThresholds = DEFAULT_THRESHOLDS,
): Grade {
  if (score == null || Number.isNaN(score)) return 'NONE';
  if (score >= t.good) return 'GOOD';
  if (score >= t.fair) return 'FAIR';
  return 'POOR';
}

export function gradeColor(grade: Grade): string {
  return GRADE_COLORS[grade];
}

// 히트맵 폴리곤/사각형 채움색. NONE 은 35% 불투명 회색으로.
export function gradeFill(grade: Grade, opacity = 0.55): string {
  const hex = GRADE_COLORS[grade];
  const eff = grade === 'NONE' ? NONE_OPACITY : opacity;
  return hexToRgba(hex, eff);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 측정 포인트의 셀룰러 점수 — 서버값 우선, 없으면 로컬 계산.
export function measurementCellScore(m: SignalMeasurement): number | null {
  if (m.cellularScore != null) return m.cellularScore;
  if (m.rsrp != null) return cellularScoreOf(m.rsrp, m.sinr);
  return null;
}

// WiFi 점수 — 서버값 우선, 없으면 로컬 계산.
export function measurementWifiScore(m: SignalMeasurement): number | null {
  if (m.wifiScore != null) return m.wifiScore;
  if (m.wifiRssi != null) return wifiScoreOf(m.wifiRssi);
  return null;
}

// 라이브 지도 마커 색상 기준 등급 (계약 §8: 최신 cellularScore 의 등급).
// 사용자 조정 임계값을 반영하기 위해 서버 grade 대신 항상 점수에서 로컬 계산한다.
export function measurementGrade(
  m: SignalMeasurement,
  t: GradeThresholds = DEFAULT_THRESHOLDS,
): Grade {
  return gradeOfScore(measurementCellScore(m), t);
}

export interface MetricOption {
  value: Metric;
  label: string;
}

export const METRIC_OPTIONS: MetricOption[] = [
  { value: 'cellularScore', label: '셀룰러 점수' },
  { value: 'wifiScore', label: 'WiFi 점수' },
  { value: 'rsrp', label: 'RSRP (dBm)' },
  { value: 'sinr', label: 'SINR (dB)' },
  { value: 'wifiRssi', label: 'WiFi RSSI (dBm)' },
];

export interface TimeRangeOption {
  value: string;
  label: string;
  ms: number | null; // null = 전체
}

export const TIME_RANGES: TimeRangeOption[] = [
  { value: '1h', label: '1시간', ms: 3600_000 },
  { value: '24h', label: '24시간', ms: 86_400_000 },
  { value: '7d', label: '7일', ms: 7 * 86_400_000 },
  { value: 'all', label: '전체', ms: null },
];

// 시간 범위 → ISO from/to. 전체(null)는 epoch 부터.
export function rangeToFromTo(rangeMs: number | null): { from: string; to: string } {
  const to = new Date();
  const from = rangeMs == null ? new Date(0) : new Date(to.getTime() - rangeMs);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export function fmtNum(v: number | null | undefined, unit = ''): string {
  if (v == null || Number.isNaN(v)) return '-';
  return `${v}${unit}`;
}
