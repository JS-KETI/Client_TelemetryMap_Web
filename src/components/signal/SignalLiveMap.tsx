// 실시간 지도 — 기기별 최신 실외 측정 위치에 등급색 마커. 우측 패널에 기기 목록/상세.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DeviceLatest } from '../../hooks/useSignalStore';
import type { SignalMeasurement } from '../../types/signal';
import type { GradeThresholds } from '../../utils/signal';
import {
  DEFAULT_THRESHOLDS,
  fmtNum,
  fmtTime,
  gradeColor,
  GRADE_LABELS,
  measurementCellScore,
  measurementGrade,
} from '../../utils/signal';
import { ESRI_LABELS, ESRI_SATELLITE, InvalidateOnResize, makeSignalIcon, SEOUL } from './mapShared';
import { MapSearch } from './MapSearch';

interface Props {
  deviceLatest: DeviceLatest[];
  thresholds?: GradeThresholds;
}

interface Located {
  deviceId: string;
  position: LatLngExpression;
  measurement: SignalMeasurement;
}

// 새 기기가 나타나면 전체가 보이도록 fitBounds (MapPip MapEffects 패턴).
function FitOnNew({ located }: { located: Located[] }) {
  const map = useMap();
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (located.length === 0) {
      seen.current = new Set();
      return;
    }
    const fresh = located.some((d) => !seen.current.has(d.deviceId));
    seen.current = new Set(located.map((d) => d.deviceId));
    if (fresh) {
      map.fitBounds(L.latLngBounds(located.map((d) => d.position)), {
        maxZoom: 17,
        padding: [40, 40],
      });
    }
  }, [located, map]);
  return null;
}

// 선택된 기기로 부드럽게 이동.
function FlyToSelected({ target }: { target: LatLngExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, Math.max(map.getZoom(), 16), { animate: true });
  }, [target, map]);
  return null;
}

export function SignalLiveMap({ deviceLatest, thresholds = DEFAULT_THRESHOLDS }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const located = useMemo<Located[]>(
    () =>
      deviceLatest
        .filter((d) => d.latestOutdoor != null)
        .map((d) => ({
          deviceId: d.deviceId,
          position: [d.latestOutdoor!.latitude!, d.latestOutdoor!.longitude!] as LatLngExpression,
          measurement: d.latestOutdoor!,
        })),
    [deviceLatest],
  );

  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    for (const d of deviceLatest) {
      map.set(d.deviceId, makeSignalIcon(gradeColor(measurementGrade(d.latest, thresholds))));
    }
    return map;
  }, [deviceLatest, thresholds]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const selected = selectedId ? deviceLatest.find((d) => d.deviceId === selectedId) ?? null : null;
  const selectedPos = useMemo<LatLngExpression | null>(() => {
    const loc = located.find((l) => l.deviceId === selectedId);
    return loc ? loc.position : null;
  }, [located, selectedId]);

  const center = located.length > 0 ? located[0].position : (SEOUL as LatLngExpression);

  return (
    <div className="signal-live">
      <div className="signal-live-map">
        <MapContainer center={center} zoom={15} className="signal-leaflet" zoomControl={false}>
          <TileLayer url={ESRI_SATELLITE} attribution="Tiles &copy; Esri" />
          <TileLayer url={ESRI_LABELS} />
          <InvalidateOnResize />
          <MapSearch />
          <FitOnNew located={located} />
          <FlyToSelected target={selectedPos} />
          {located.map((d) => {
            const m = d.measurement;
            const score = measurementCellScore(m);
            const grade = measurementGrade(
              deviceLatest.find((x) => x.deviceId === d.deviceId)!.latest,
              thresholds,
            );
            return (
              <Marker
                key={d.deviceId}
                position={d.position}
                icon={icons.get(d.deviceId) ?? makeSignalIcon(gradeColor(grade))}
                eventHandlers={{ click: () => setSelectedId(d.deviceId) }}
              >
                <Tooltip permanent direction="top" className="signal-tag">
                  {d.deviceId}
                </Tooltip>
                <Popup>
                  <div className="signal-popup">
                    <strong>{d.deviceId}</strong>
                    <div className="signal-popup-grade" style={{ color: gradeColor(grade) }}>
                      {GRADE_LABELS[grade]} · 점수 {fmtNum(score)}
                    </div>
                    <dl>
                      <dt>RSRP</dt><dd>{fmtNum(m.rsrp, ' dBm')}</dd>
                      <dt>RSRQ</dt><dd>{fmtNum(m.rsrq, ' dB')}</dd>
                      <dt>SINR</dt><dd>{fmtNum(m.sinr, ' dB')}</dd>
                      <dt>WiFi</dt><dd>{fmtNum(m.wifiRssi, ' dBm')}</dd>
                      <dt>망</dt><dd>{m.networkType ?? '-'}</dd>
                      <dt>시각</dt><dd>{fmtTime(m.recordedAt)}</dd>
                    </dl>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <aside className="signal-live-panel">
        <div className="signal-panel-head">기기 {deviceLatest.length}대</div>
        <div className="signal-device-list">
          {deviceLatest.length === 0 && <div className="signal-panel-empty">데이터 없음</div>}
          {deviceLatest.map((d) => {
            const grade = measurementGrade(d.latest, thresholds);
            return (
              <button
                key={d.deviceId}
                className={`signal-device-row ${selectedId === d.deviceId ? 'active' : ''}`}
                onClick={() => handleSelect(d.deviceId)}
              >
                <span className="signal-dot" style={{ background: gradeColor(grade) }} />
                <span className="signal-device-id">{d.deviceId}</span>
                <span className="signal-device-score">{fmtNum(measurementCellScore(d.latest))}</span>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="signal-device-detail">
            <div className="signal-detail-title">{selected.deviceId}</div>
            <dl>
              <dt>RSRP</dt><dd>{fmtNum(selected.latest.rsrp, ' dBm')}</dd>
              <dt>SINR</dt><dd>{fmtNum(selected.latest.sinr, ' dB')}</dd>
              <dt>Score</dt><dd>{fmtNum(measurementCellScore(selected.latest))}</dd>
              <dt>networkType</dt><dd>{selected.latest.networkType ?? '-'}</dd>
            </dl>
            {selected.latestOutdoor == null && (
              <div className="signal-detail-note">실외 측정 없음 (지도 마커 없음)</div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
