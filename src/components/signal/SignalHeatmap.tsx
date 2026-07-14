// 히트맵 — 실외(Leaflet GeoJSON 폴리곤) / 실내(층 이미지 + 정규화 좌표 셀 사각형) 토글.
// 실외 지도에는 라이브 디바이스 마커를 겹쳐 표시하고, 셀 집계는 주기적으로 자동 갱신한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchCells, fetchFloors, floorImageUrl } from '../../api/signalApi';
import type { DeviceLatest } from '../../hooks/useSignalStore';
import type {
  CellFeatureCollection,
  CellFeatureProperties,
  Environment,
  Grade,
  Metric,
  SignalFloor,
} from '../../types/signal';
import type { GradeThresholds } from '../../utils/signal';
import {
  DEFAULT_THRESHOLDS,
  fmtNum,
  gradeColor,
  gradeFill,
  GRADE_LABELS,
  GRADE_ORDER,
  gradeOfScore,
  measurementCellScore,
  measurementGrade,
  METRIC_OPTIONS,
  rangeToFromTo,
  TIME_RANGES,
} from '../../utils/signal';
import { ESRI_LABELS, ESRI_SATELLITE, InvalidateOnResize, makeSignalIcon, SEOUL } from './mapShared';
import { MapSearch } from './MapSearch';

const CELLS_REFRESH_MS = 15_000; // 측정 진행 중 격자가 실시간으로 채워지도록 주기 갱신

// 서버 집계 격자와 동일한 수식 (contract §2) — 가상 격자선 렌더용.
const CELL_SIZE_M = 15;
const REF_LAT = 37.5665;
const LAT_STEP = CELL_SIZE_M / 111_320;
const LNG_STEP = CELL_SIZE_M / (111_320 * Math.cos((REF_LAT * Math.PI) / 180));
const GRID_MIN_ZOOM = 16; // 셀이 수 px 이하로 뭉개지는 저줌에서는 생략

// 가상 격자선 — 위도 0°×경도 0° 절대 원점 격자를 뷰포트에 미리 그려서
// 측정 셀이 "이미 그려진 칸을 채우는" 느낌을 준다. 팬/줌마다 다시 그린다.
function VirtualGrid() {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const style: L.PolylineOptions = {
      color: '#94a3b8',
      weight: 0.6,
      opacity: 0.35,
      interactive: false,
    };
    const redraw = () => {
      group.clearLayers();
      if (map.getZoom() < GRID_MIN_ZOOM) return;
      const b = map.getBounds().pad(0.15);
      const south = Math.floor(b.getSouth() / LAT_STEP) * LAT_STEP;
      const west = Math.floor(b.getWest() / LNG_STEP) * LNG_STEP;
      let guard = 0;
      for (let lat = south; lat <= b.getNorth() && guard < 500; lat += LAT_STEP, guard++) {
        L.polyline([[lat, b.getWest()], [lat, b.getEast()]], style).addTo(group);
      }
      guard = 0;
      for (let lng = west; lng <= b.getEast() && guard < 500; lng += LNG_STEP, guard++) {
        L.polyline([[b.getSouth(), lng], [b.getNorth(), lng]], style).addTo(group);
      }
    };
    redraw();
    map.on('moveend zoomend', redraw);
    return () => {
      map.off('moveend zoomend', redraw);
      group.remove();
    };
  }, [map]);
  return null;
}

type LGeoJsonArg = Parameters<typeof L.geoJSON>[0];
const round1 = (v: number): number => Math.round(v * 10) / 10;

// 실외 GeoJSON 폴리곤을 명령형으로 렌더(등급색 채움 + 값/표본 tooltip). data 변경 시 교체.
function OutdoorGeoJson({
  data,
  thresholds,
}: {
  data: CellFeatureCollection;
  thresholds: GradeThresholds;
}) {
  const map = useMap();
  const fitted = useRef(false); // 최초 1회만 fitBounds — 주기 갱신 때 시점(줌/팬) 유지
  useEffect(() => {
    const layer = L.geoJSON(data as unknown as LGeoJsonArg, {
      style: (feature) => {
        // 사용자 임계값 반영을 위해 서버 grade 대신 score 에서 재계산.
        const p = feature?.properties as CellFeatureProperties | undefined;
        const g: Grade = p?.score != null ? gradeOfScore(p.score, thresholds) : ((p?.grade ?? 'NONE') as Grade);
        return {
          color: '#0f172a',
          weight: 1,
          fillColor: gradeColor(g),
          fillOpacity: g === 'NONE' ? 0.35 : 0.55,
        };
      },
      onEachFeature: (feature, lyr) => {
        const p = feature.properties as CellFeatureProperties;
        lyr.bindTooltip(`값 ${round1(p.value)} · 표본 ${p.sampleCount}`, { sticky: true });
      },
    }).addTo(map);
    if (!fitted.current) {
      try {
        const b = layer.getBounds();
        if (b.isValid()) {
          map.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
          fitted.current = true;
        }
      } catch {
        /* 빈 컬렉션이면 무시 */
      }
    }
    return () => {
      layer.remove();
    };
  }, [data, map, thresholds]);
  return null;
}

// 실내 히트맵 — 층 이미지 위에 정규화 좌표(0..1) 셀을 렌더 크기로 환산해 사각형 배치.
function IndoorHeat({
  floorId,
  cells,
  thresholds,
}: {
  floorId: number;
  cells: CellFeatureCollection | null;
  thresholds: GradeThresholds;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [floorId]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [floorId]);

  const rects = useMemo(() => {
    if (!cells || size.w === 0 || size.h === 0) return [];
    return cells.features.map((f, i) => {
      const ring = f.geometry.coordinates[0] ?? [];
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      for (const pt of ring) {
        const x = pt[0];
        const y = pt[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return {
        key: i,
        left: minX * size.w,
        top: minY * size.h,
        width: Math.max(0, (maxX - minX) * size.w),
        height: Math.max(0, (maxY - minY) * size.h),
        grade:
          f.properties.score != null
            ? gradeOfScore(f.properties.score, thresholds)
            : f.properties.grade,
        value: f.properties.value,
        sampleCount: f.properties.sampleCount,
      };
    });
  }, [cells, size, thresholds]);

  return (
    <div className="signal-indoor-wrap">
      {imgError ? (
        <div className="signal-empty-overlay static">층 이미지를 불러올 수 없습니다</div>
      ) : (
        <div className="signal-indoor-stage">
          <img
            ref={imgRef}
            src={floorImageUrl(floorId)}
            className="signal-floor-img"
            alt="floor plan"
            onError={() => setImgError(true)}
            onLoad={() => {
              const el = imgRef.current;
              if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
            }}
          />
          {rects.map((r) => (
            <div
              key={r.key}
              className="signal-cell-rect"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                background: gradeFill(r.grade),
              }}
              title={`값 ${round1(r.value)} · 표본 ${r.sampleCount}`}
            />
          ))}
          {(!cells || cells.features.length === 0) && (
            <div className="signal-indoor-note">측정 데이터 없음</div>
          )}
        </div>
      )}
    </div>
  );
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

// 기기 리스트에서 선택한 기기 위치로 부드럽게 이동.
function FlyTo({ target }: { target: LatLngExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, Math.max(map.getZoom(), 17), { animate: true });
  }, [target, map]);
  return null;
}

export function SignalHeatmap({
  deviceLatest,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  deviceLatest?: DeviceLatest[];
  thresholds?: GradeThresholds;
}) {
  const [env, setEnv] = useState<Environment>('OUTDOOR');
  const [metric, setMetric] = useState<Metric>('cellularScore');
  // 기본 '전체' = 셀별 최신 측정값 기준 "현재 상태" 보기. 기간 선택 시 해당 기간 평균(작업 구역 파악용).
  const [rangeValue, setRangeValue] = useState<string>('all');
  const [floors, setFloors] = useState<SignalFloor[]>([]);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [cells, setCells] = useState<CellFeatureCollection | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [tick, setTick] = useState(0);
  const [flyTarget, setFlyTarget] = useState<LatLngExpression | null>(null);
  const cellsRef = useRef<CellFeatureCollection | null>(null);
  const envKeyRef = useRef<string>('');

  const rangeMs = useMemo(
    () => TIME_RANGES.find((r) => r.value === rangeValue)?.ms ?? null,
    [rangeValue],
  );

  // 주기 갱신 타이머 — 측정이 진행되는 동안 격자가 실시간으로 채워진다.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), CELLS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // 층 목록 로드(실내 토글용). 실패해도 조용히 빈 목록.
  useEffect(() => {
    let cancelled = false;
    fetchFloors()
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
        setFloors(sorted);
        setFloorId((prev) => prev ?? (sorted.length > 0 ? sorted[0].id : null));
      })
      .catch(() => {
        if (!cancelled) setFloors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 셀 집계 로드. 환경/층이 바뀌면 좌표 공간이 달라지므로 기존 데이터를 비우고,
  // 같은 화면 내 주기 갱신(tick)·지표/기간 변경 때는 기존 격자를 유지한 채 조용히 교체한다.
  useEffect(() => {
    let cancelled = false;
    if (env === 'INDOOR' && floorId == null) {
      cellsRef.current = null;
      setCells(null);
      setStatus('empty');
      return;
    }
    const envKey = `${env}:${floorId ?? ''}`;
    if (envKeyRef.current !== envKey) {
      envKeyRef.current = envKey;
      cellsRef.current = null;
      setCells(null);
    }
    if (!cellsRef.current) setStatus('loading');
    const { from, to } = rangeToFromTo(rangeMs);
    fetchCells({
      environment: env,
      metric,
      from,
      to,
      floorId: env === 'INDOOR' ? floorId ?? undefined : undefined,
      agg: rangeValue === 'all' ? 'latest' : 'avg',
    })
      .then((fc) => {
        if (cancelled) return;
        cellsRef.current = fc;
        setCells(fc);
        setStatus(fc.features.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        if (!cellsRef.current) {
          setCells(null);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [env, metric, rangeMs, floorId, tick]);

  return (
    <div className="signal-heatmap">
      <div className="signal-controls">
        <div className="signal-seg">
          {(['OUTDOOR', 'INDOOR'] as Environment[]).map((e) => (
            <button
              key={e}
              className={`signal-seg-btn ${env === e ? 'active' : ''}`}
              onClick={() => setEnv(e)}
            >
              {e === 'OUTDOOR' ? '실외' : '실내'}
            </button>
          ))}
        </div>

        <label className="signal-field">
          <span>지표</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="signal-field">
          <span>기간</span>
          <select value={rangeValue} onChange={(e) => setRangeValue(e.target.value)}>
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value === 'all' ? '전체 (최신 상태)' : r.label}
              </option>
            ))}
          </select>
        </label>

        <div className="signal-legend">
          {GRADE_ORDER.map((g) => {
            const range =
              g === 'GOOD'
                ? ` ≥${thresholds.good}`
                : g === 'FAIR'
                  ? ` ${thresholds.fair}~${thresholds.good - 1}`
                  : g === 'POOR'
                    ? ` <${thresholds.fair}`
                    : '';
            return (
              <span key={g} className="signal-legend-item">
                <span className="signal-legend-dot" style={{ background: gradeColor(g), opacity: g === 'NONE' ? 0.35 : 1 }} />
                {GRADE_LABELS[g]}
                {range}
              </span>
            );
          })}
        </div>
      </div>

      {env === 'INDOOR' && (
        <div className="signal-floor-chips">
          {floors.length === 0 && <span className="signal-panel-empty">층 정보 없음</span>}
          {floors.map((f) => (
            <button
              key={f.id}
              className={`signal-chip ${floorId === f.id ? 'active' : ''}`}
              onClick={() => setFloorId(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="signal-heatmap-main">
      <div className="signal-heatmap-body">
        {status === 'error' && (
          <div className="signal-empty-overlay static">데이터 없음 · 서버 연결을 확인하세요</div>
        )}
        {status === 'empty' && env === 'OUTDOOR' && (
          <div className="signal-empty-overlay static">측정 데이터 없음</div>
        )}

        {env === 'OUTDOOR' ? (
          <MapContainer
            center={SEOUL}
            zoom={15}
            maxZoom={22}
            className="signal-leaflet"
            zoomControl={false}
          >
            <TileLayer url={ESRI_SATELLITE} attribution="Tiles &copy; Esri" maxZoom={22} maxNativeZoom={19} />
            <TileLayer url={ESRI_LABELS} maxZoom={22} maxNativeZoom={19} />
            <InvalidateOnResize />
            <MapSearch />
            <FlyTo target={flyTarget} />
            <VirtualGrid />
            {cells && status === 'ready' && <OutdoorGeoJson data={cells} thresholds={thresholds} />}
            {deviceLatest
              ?.filter((d) => d.latestOutdoor)
              .map((d) => {
                const m = d.latestOutdoor!;
                const grade = measurementGrade(m, thresholds);
                return (
                  <Marker
                    key={d.deviceId}
                    position={[m.latitude!, m.longitude!]}
                    icon={makeSignalIcon(gradeColor(grade))}
                  >
                    <Tooltip direction="top">{d.deviceId}</Tooltip>
                  </Marker>
                );
              })}
          </MapContainer>
        ) : floorId != null ? (
          <IndoorHeat floorId={floorId} cells={cells} thresholds={thresholds} />
        ) : (
          <div className="signal-empty-overlay static">층을 선택하세요</div>
        )}
      </div>

      <aside className="signal-live-panel">
        <div className="signal-panel-head">기기 {deviceLatest?.length ?? 0}대</div>
        <div className="signal-device-list">
          {(!deviceLatest || deviceLatest.length === 0) && (
            <div className="signal-panel-empty">활성 기기 없음</div>
          )}
          {deviceLatest?.map((d) => {
            const grade = measurementGrade(d.latest, thresholds);
            return (
              <div key={d.deviceId} className="signal-device-row signal-device-row-plain">
                <span className="signal-dot" style={{ background: gradeColor(grade) }} />
                <span className="signal-device-id">{d.deviceId}</span>
                <span className="signal-device-score">{fmtNum(measurementCellScore(d.latest))}</span>
                <button
                  className="signal-device-go"
                  disabled={!d.latestOutdoor}
                  title="이 기기 위치로 지도 이동"
                  onClick={() => {
                    const m = d.latestOutdoor;
                    if (m) {
                      setEnv('OUTDOOR');
                      setFlyTarget([m.latitude!, m.longitude!]);
                    }
                  }}
                >
                  이동
                </button>
              </div>
            );
          })}
        </div>
      </aside>
      </div>
    </div>
  );
}
