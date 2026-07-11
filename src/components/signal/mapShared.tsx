// 신호 지도들이 공유하는 Leaflet 유틸 — MapPip 패턴 재사용(Esri 위성 타일 + 라벨,
// 탭 전환 시 blank 방지용 invalidateSize).
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export const ESRI_SATELLITE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const SEOUL: [number, number] = [37.5665, 126.978];

// 컨테이너 크기 변화 시 Leaflet 재정렬. 탭/서브탭이 보이게 될 때 지도가 빈 화면으로
// 뜨는 문제를 막는다(계약 §8, MapPip InvalidateOnResize 동일 패턴).
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    // 최초 마운트 직후에도 한 번 강제 정렬.
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [map]);
  return null;
}

// 등급 색상 기반 원형 마커(이미지 에셋 없이 자체 완결 SVG divIcon).
export function makeSignalIcon(color: string, highlighted = false): L.DivIcon {
  const ring = highlighted ? '#f8fafc' : color;
  return L.divIcon({
    className: 'signal-marker',
    html: `
      <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="11" cy="11" r="9" fill="${color}" fill-opacity="0.85"
                stroke="${ring}" stroke-width="2"/>
        <circle cx="11" cy="11" r="3.2" fill="#0f172a" fill-opacity="0.55"/>
      </svg>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
    tooltipAnchor: [0, -10],
  });
}
