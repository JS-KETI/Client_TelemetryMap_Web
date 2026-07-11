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
import { fetchHistory, fetchMeasurements } from '../../api/signalApi';
import type { HistoryPoint, SignalMeasurement } from '../../types/signal';
import {
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

// RSRP(좌축)·SINR(우축) 이중축 라인 차트 — chart.js + react-chartjs-2.
function TrendChart({ points }: { points: HistoryPoint[] }) {
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
  }, []);

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
}

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function SignalAnalysis({ storeDeviceIds }: Props) {
  const [deviceIds, setDeviceIds] = useState<string[]>(storeDeviceIds);
  const [deviceId, setDeviceId] = useState<string | null>(storeDeviceIds[0] ?? null);
  const [rangeValue, setRangeValue] = useState<string>('24h');

  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [chartState, setChartState] = useState<LoadState>('idle');

  const [replay, setReplay] = useState<SignalMeasurement[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const rangeMs = useMemo(
    () => TIME_RANGES.find((r) => r.value === rangeValue)?.ms ?? null,
    [rangeValue],
  );

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
    if (!deviceId) {
      setHistory([]);
      setChartState('empty');
      return;
    }
    let cancelled = false;
    setChartState('loading');
    const { from, to } = rangeToFromTo(rangeMs);
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
  }, [deviceId, rangeMs]);

  // 리플레이용 실외 측정 구간 로드.
  useEffect(() => {
    if (!deviceId) {
      setReplay([]);
      return;
    }
    let cancelled = false;
    setPlaying(false);
    setReplayIdx(0);
    const { from, to } = rangeToFromTo(rangeMs);
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
  }, [deviceId, rangeMs]);

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
    () => (current ? makeSignalIcon(gradeColor(measurementGrade(current)), true) : null),
    [current],
  );

  const togglePlay = useCallback(() => {
    if (replay.length === 0) return;
    setPlaying((p) => {
      if (!p && replayIdx >= replay.length - 1) setReplayIdx(0);
      return !p;
    });
  }, [replay.length, replayIdx]);

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
        <label className="signal-field">
          <span>기간</span>
          <select value={rangeValue} onChange={(e) => setRangeValue(e.target.value)}>
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="signal-section">
        <h4>RSRP · SINR 시계열</h4>
        {chartState === 'error' ? (
          <div className="signal-empty-overlay static">데이터 없음 · 서버 연결을 확인하세요</div>
        ) : (
          <TrendChart points={chartState === 'ready' ? history : []} />
        )}
      </section>

      <section className="signal-section">
        <h4>이동 리플레이</h4>
        <div className="signal-replay">
          <div className="signal-replay-map">
            {replay.length === 0 && (
              <div className="signal-empty-overlay">실외 측정 데이터 없음</div>
            )}
            <MapContainer center={currentPos ?? SEOUL} zoom={16} className="signal-leaflet" zoomControl={false}>
              <TileLayer url={ESRI_SATELLITE} attribution="Tiles &copy; Esri" />
              <TileLayer url={ESRI_LABELS} />
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
