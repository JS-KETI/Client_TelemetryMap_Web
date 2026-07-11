// 히트맵 — 실외(Leaflet GeoJSON 폴리곤) / 실내(층 이미지 + 정규화 좌표 셀 사각형) 토글.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchCells, fetchFloors, floorImageUrl } from '../../api/signalApi';
import type {
  CellFeatureCollection,
  CellFeatureProperties,
  Environment,
  Grade,
  Metric,
  SignalFloor,
} from '../../types/signal';
import {
  gradeColor,
  gradeFill,
  GRADE_LABELS,
  GRADE_ORDER,
  METRIC_OPTIONS,
  rangeToFromTo,
  TIME_RANGES,
} from '../../utils/signal';
import { ESRI_LABELS, ESRI_SATELLITE, InvalidateOnResize, SEOUL } from './mapShared';

type LGeoJsonArg = Parameters<typeof L.geoJSON>[0];
const round1 = (v: number): number => Math.round(v * 10) / 10;

// 실외 GeoJSON 폴리곤을 명령형으로 렌더(등급색 채움 + 값/표본 tooltip). data 변경 시 교체.
function OutdoorGeoJson({ data }: { data: CellFeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(data as unknown as LGeoJsonArg, {
      style: (feature) => {
        const g = (feature?.properties?.grade ?? 'NONE') as Grade;
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
    try {
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
    } catch {
      /* 빈 컬렉션이면 무시 */
    }
    return () => {
      layer.remove();
    };
  }, [data, map]);
  return null;
}

// 실내 히트맵 — 층 이미지 위에 정규화 좌표(0..1) 셀을 렌더 크기로 환산해 사각형 배치.
function IndoorHeat({ floorId, cells }: { floorId: number; cells: CellFeatureCollection | null }) {
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
        grade: f.properties.grade,
        value: f.properties.value,
        sampleCount: f.properties.sampleCount,
      };
    });
  }, [cells, size]);

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

export function SignalHeatmap() {
  const [env, setEnv] = useState<Environment>('OUTDOOR');
  const [metric, setMetric] = useState<Metric>('cellularScore');
  const [rangeValue, setRangeValue] = useState<string>('24h');
  const [floors, setFloors] = useState<SignalFloor[]>([]);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [cells, setCells] = useState<CellFeatureCollection | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const rangeMs = useMemo(
    () => TIME_RANGES.find((r) => r.value === rangeValue)?.ms ?? null,
    [rangeValue],
  );

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

  // 셀 집계 로드.
  useEffect(() => {
    let cancelled = false;
    if (env === 'INDOOR' && floorId == null) {
      setCells(null);
      setStatus('empty');
      return;
    }
    setStatus('loading');
    const { from, to } = rangeToFromTo(rangeMs);
    fetchCells({
      environment: env,
      metric,
      from,
      to,
      floorId: env === 'INDOOR' ? floorId ?? undefined : undefined,
    })
      .then((fc) => {
        if (cancelled) return;
        setCells(fc);
        setStatus(fc.features.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        setCells(null);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [env, metric, rangeMs, floorId]);

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
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <div className="signal-legend">
          {GRADE_ORDER.map((g) => (
            <span key={g} className="signal-legend-item">
              <span className="signal-legend-dot" style={{ background: gradeColor(g), opacity: g === 'NONE' ? 0.35 : 1 }} />
              {GRADE_LABELS[g]}
            </span>
          ))}
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
            className="signal-leaflet"
            zoomControl={false}
          >
            <TileLayer url={ESRI_SATELLITE} attribution="Tiles &copy; Esri" />
            <TileLayer url={ESRI_LABELS} />
            <InvalidateOnResize />
            {cells && status === 'ready' && <OutdoorGeoJson data={cells} />}
          </MapContainer>
        ) : floorId != null ? (
          <IndoorHeat floorId={floorId} cells={cells} />
        ) : (
          <div className="signal-empty-overlay static">층을 선택하세요</div>
        )}
      </div>
    </div>
  );
}
