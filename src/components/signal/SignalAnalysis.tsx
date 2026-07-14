// 분석 — 기기 선택 + 기간, RSRP·SINR 이중축 시계열 차트(chart.js), 측정 구간 리플레이(재생/일시정지).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchHistory, fetchMeasurements, fetchSessions } from '../../api/signalApi';
import type { HistoryPoint, SessionSummary, SignalMeasurement } from '../../types/signal';
import type { GradeThresholds } from '../../utils/signal';
import {
  DEFAULT_THRESHOLDS,
  fmtTime,
  gradeColor,
  measurementCellScore,
  measurementGrade,
  rangeToFromTo,
  TIME_RANGES,
} from '../../utils/signal';
import { ESRI_LABELS, ESRI_SATELLITE, InvalidateOnResize, makeSignalIcon, SEOUL } from './mapShared';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const RSRP_COLOR = '#38bdf8'; // sky
const SINR_COLOR = '#f59e0b'; // amber

// 다크 테마 색상을 기존 CSS 변수에서 읽는다 (없으면 폴백).
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// x축 눈금용 짧은 시각 라벨 — 1h~7d 어느 기간에서도 식별되게 월/일 + 시:분.
function fmtTickLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 세션 셀렉트 라벨: "7/15 14:02 ~ 14:31 · 214건"
function fmtSessionLabel(s: SessionSummary): string {
  const a = new Date(s.startedAt);
  const b = new Date(s.endedAt);
  const d = a.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const t1 = a.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const t2 = b.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${d} ${t1} ~ ${t2} · ${s.count}건`;
}

// RSRP(좌축)·SINR(우축) 이중축 라인 차트 — chart.js + react-chartjs-2.
// 포인트 클릭 시 onPointClick(버킷 인덱스) — 리플레이가 해당 시각으로 이동한다.
function TrendChart({
  points,
  onPointClick,
}: {
  points: HistoryPoint[];
  onPointClick?: (index: number) => void;
}) {
  const data = useMemo<ChartData<'line', (number | null)[], string>>(
    () => ({
      labels: points.map((p) => fmtTickLabel(p.t)),
      datasets: [
        {
          label: 'RSRP (dBm)',
          data: points.map((p) => p.rsrp),
          borderColor: RSRP_COLOR,
          backgroundColor: RSRP_COLOR,
          yAxisID: 'yRsrp',
          borderWidth: 1.8,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0,
          spanGaps: false,
        },
        {
          label: 'SINR (dB)',
          data: points.map((p) => p.sinr),
          borderColor: SINR_COLOR,
          backgroundColor: SINR_COLOR,
          yAxisID: 'ySinr',
          borderWidth: 1.8,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0,
          spanGaps: false,
        },
      ],
    }),
    [points],
  );

  const options = useMemo<ChartOptions<'line'>>(() => {
    const text = cssVar('--text-secondary', '#94a3b8');
    const textStrong = cssVar('--text-primary', '#f8fafc');
    const grid = cssVar('--border', '#475569');
    const card = cssVar('--bg-card', '#334155');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_event, elements) => {
        if (elements.length > 0) onPointClick?.(elements[0].index);
      },
      plugins: {
        legend: { labels: { color: textStrong, boxWidth: 14, boxHeight: 3 } },
        tooltip: {
          backgroundColor: card,
          titleColor: textStrong,
          bodyColor: text,
          borderColor: grid,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: text, maxTicksLimit: 6, maxRotation: 0, autoSkip: true },
          grid: { color: grid },
        },
        yRsrp: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'RSRP (dBm)', color: RSRP_COLOR },
          ticks: { color: RSRP_COLOR },
          grid: { color: grid },
        },
        ySinr: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'SINR (dB)', color: SINR_COLOR },
          ticks: { color: SINR_COLOR },
          grid: { drawOnChartArea: false },
        },
      },
    };
  }, [onPointClick]);

  return (
    <div className="signal-chart-wrap">
      {points.length === 0 ? (
        <div className="signal-empty-overlay static">데이터 없음 · 서버 연결을 확인하세요</div>
      ) : (
        <Line data={data} options={options} />
      )}
    </div>
  );
}

// 리플레이 마커 위치로 지도 중심 이동.
function ReplayCenter({ target }: { target: LatLngExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, Math.max(map.getZoom(), 16), { animate: true });
  }, [target, map]);
  return null;
}

interface Props {
  storeDeviceIds: string[];
  thresholds?: GradeThresholds;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function SignalAnalysis({ storeDeviceIds, thresholds = DEFAULT_THRESHOLDS }: Props) {
  const [deviceIds, setDeviceIds] = useState<string[]>(storeDeviceIds);
  const [deviceId, setDeviceId] = useState<string | null>(storeDeviceIds[0] ?? null);
  // 조회 기준: 측정 회차(기본 — 시작~중지 한 번이 하나의 세션) 또는 기간.
  const [queryMode, setQueryMode] = useState<'session' | 'range'>('session');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rangeValue, setRangeValue] = useState<string>('24h');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [chartState, setChartState] = useState<LoadState>('idle');

  const [replay, setReplay] = useState<SignalMeasurement[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // 측정 세션 목록 로드 (기기 변경 시).
  useEffect(() => {
    if (!deviceId) {
      setSessions([]);
      setSessionId(null);
      return;
    }
    let cancelled = false;
    fetchSessions(deviceId)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setSessionId((prev) =>
          prev && list.some((s) => s.sessionId === prev) ? prev : (list[0]?.sessionId ?? null),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSessions([]);
        setSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // 조회 구간 — 측정 회차(세션 시작~종료 ±2초 버퍼) 또는 상대 기간/직접 설정.
  const fromTo = useMemo(() => {
    if (queryMode === 'session') {
      const s = sessions.find((x) => x.sessionId === sessionId);
      if (!s) return null;
      const from = new Date(new Date(s.startedAt).getTime() - 2_000).toISOString();
      const to = new Date(new Date(s.endedAt).getTime() + 2_000).toISOString();
      return { from, to };
    }
    if (rangeValue === 'custom') {
      const f = customFrom ? new Date(customFrom) : null;
      const t = customTo ? new Date(customTo) : null;
      if (f && t && !Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && f < t) {
        return { from: f.toISOString(), to: t.toISOString() };
      }
      return null;
    }
    const ms = TIME_RANGES.find((r) => r.value === rangeValue)?.ms ?? null;
    return rangeToFromTo(ms);
  }, [queryMode, sessions, sessionId, rangeValue, customFrom, customTo]);

  // 기기 목록: 스토어 + measurements distinct 병합.
  useEffect(() => {
    let cancelled = false;
    const { from, to } = rangeToFromTo(7 * 86_400_000);
    fetchMeasurements({ from, to, limit: 2000 })
      .then((list) => {
        if (cancelled) return;
        const ids = new Set<string>([...storeDeviceIds]);
        for (const m of list) ids.add(m.deviceId);
        const arr = Array.from(ids).sort();
        setDeviceIds(arr);
        setDeviceId((prev) => prev ?? (arr[0] ?? null));
      })
      .catch(() => {
        if (cancelled) return;
        const arr = [...storeDeviceIds].sort();
        setDeviceIds(arr);
        setDeviceId((prev) => prev ?? (arr[0] ?? null));
      });
    return () => {
      cancelled = true;
    };
    // storeDeviceIds 변화 시 목록 갱신
  }, [storeDeviceIds]);

  // 히스토리(차트) 로드.
  useEffect(() => {
    if (!deviceId || !fromTo) {
      setHistory([]);
      setChartState('empty');
      return;
    }
    let cancelled = false;
    setChartState('loading');
    const { from, to } = fromTo;
    fetchHistory({ deviceId, from, to, bucketSeconds: 60 })
      .then((res) => {
        if (cancelled) return;
        setHistory(res.points);
        setChartState(res.points.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        setHistory([]);
        setChartState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, fromTo]);

  // 리플레이용 실외 측정 구간 로드.
  useEffect(() => {
    if (!deviceId || !fromTo) {
      setReplay([]);
      return;
    }
    let cancelled = false;
    setPlaying(false);
    setReplayIdx(0);
    const { from, to } = fromTo;
    fetchMeasurements({ deviceId, environment: 'OUTDOOR', from, to, limit: 2000 })
      .then((list) => {
        if (cancelled) return;
        setReplay(list.filter((m) => m.latitude != null && m.longitude != null));
      })
      .catch(() => {
        if (!cancelled) setReplay([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, fromTo]);

  // 재생 타이머.
  useEffect(() => {
    if (!playing || replay.length === 0) return;
    const t = window.setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replay.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 600);
    return () => clearInterval(t);
  }, [playing, replay.length]);

  const current = replay[Math.min(replayIdx, Math.max(0, replay.length - 1))] ?? null;
  const currentPos = useMemo<LatLngExpression | null>(
    () => (current ? [current.latitude!, current.longitude!] : null),
    [current],
  );
  const currentIcon = useMemo(
    () => (current ? makeSignalIcon(gradeColor(measurementGrade(current, thresholds)), true) : null),
    [current, thresholds],
  );

  const togglePlay = useCallback(() => {
    if (replay.length === 0) return;
    setPlaying((p) => {
      if (!p && replayIdx >= replay.length - 1) setReplayIdx(0);
      return !p;
    });
  }, [replay.length, replayIdx]);

  // 차트 포인트 클릭 → 해당 시각과 가장 가까운 리플레이 레코드로 이동.
  const handleChartPoint = useCallback(
    (index: number) => {
      const t = history[index]?.t;
      if (!t || replay.length === 0) return;
      const target = new Date(t).getTime();
      let best = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < replay.length; i++) {
        const diff = Math.abs(new Date(replay[i].recordedAt).getTime() - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      setPlaying(false);
      setReplayIdx(best);
    },
    [history, replay],
  );

  return (
    <div className="signal-analysis">
      <div className="signal-controls">
        <label className="signal-field">
          <span>기기</span>
          <select
            value={deviceId ?? ''}
            onChange={(e) => setDeviceId(e.target.value || null)}
          >
            {deviceIds.length === 0 && <option value="">기기 없음</option>}
            {deviceIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <div className="signal-seg">
          <button
            className={`signal-seg-btn ${queryMode === 'session' ? 'active' : ''}`}
            onClick={() => setQueryMode('session')}
          >
            측정 회차
          </button>
          <button
            className={`signal-seg-btn ${queryMode === 'range' ? 'active' : ''}`}
            onClick={() => setQueryMode('range')}
          >
            기간
          </button>
        </div>

        {queryMode === 'session' && (
          <label className="signal-field">
            <span>회차</span>
            <select
              value={sessionId ?? ''}
              onChange={(e) => setSessionId(e.target.value || null)}
            >
              {sessions.length === 0 && <option value="">회차 없음 (새 앱으로 측정 필요)</option>}
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {fmtSessionLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}

        {queryMode === 'range' && (
          <>
            <label className="signal-field">
              <span>기간</span>
              <select value={rangeValue} onChange={(e) => setRangeValue(e.target.value)}>
                {TIME_RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
                <option value="custom">직접 설정</option>
              </select>
            </label>
            {rangeValue === 'custom' && (
              <>
                <label className="signal-field">
                  <span>시작</span>
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label className="signal-field">
                  <span>종료</span>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
                {!fromTo && (
                  <span className="signal-field-note">시작·종료를 모두 선택하세요 (시작 &lt; 종료)</span>
                )}
              </>
            )}
          </>
        )}
      </div>

      <section className="signal-section">
        <h4>RSRP · SINR 시계열</h4>
        {chartState === 'error' ? (
          <div className="signal-empty-overlay static">데이터 없음 · 서버 연결을 확인하세요</div>
        ) : (
          <TrendChart points={chartState === 'ready' ? history : []} onPointClick={handleChartPoint} />
        )}
        <p className="signal-field-note">그래프의 특정 지점을 클릭하면 아래 리플레이가 해당 시각으로 이동합니다</p>
      </section>

      <section className="signal-section">
        <h4>이동 리플레이</h4>
        <div className="signal-replay">
          <div className="signal-replay-map">
            {replay.length === 0 && (
              <div className="signal-empty-overlay">실외 측정 데이터 없음</div>
            )}
            <MapContainer center={currentPos ?? SEOUL} zoom={16} maxZoom={22} className="signal-leaflet" zoomControl={false}>
              <TileLayer url={ESRI_SATELLITE} attribution="Tiles &copy; Esri" maxZoom={22} maxNativeZoom={19} />
              <TileLayer url={ESRI_LABELS} maxZoom={22} maxNativeZoom={19} />
              <InvalidateOnResize />
              <ReplayCenter target={currentPos} />
              {currentPos && currentIcon && <Marker position={currentPos} icon={currentIcon} />}
            </MapContainer>
          </div>
          <div className="signal-replay-controls">
            <button className="signal-play-btn" onClick={togglePlay} disabled={replay.length === 0}>
              {playing ? '⏸ 일시정지' : '▶ 재생'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, replay.length - 1)}
              value={Math.min(replayIdx, Math.max(0, replay.length - 1))}
              onChange={(e) => {
                setPlaying(false);
                setReplayIdx(Number(e.target.value));
              }}
              disabled={replay.length === 0}
            />
            <div className="signal-replay-meta">
              {current ? (
                <>
                  {replayIdx + 1} / {replay.length} · 점수 {measurementCellScore(current) ?? '-'} · {fmtTime(current.recordedAt)}
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
