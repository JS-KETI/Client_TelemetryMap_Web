// 지도 위치 검색 컨트롤 — Nominatim(OpenStreetMap) 지오코딩, API 키 불필요.
// 검색 결과 선택 시 지도를 해당 좌표로 flyTo 한다. MapContainer 내부에서만 사용.
import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface SearchResult {
  lat: number;
  lng: number;
  label: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function MapSearch() {
  const map = useMap();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 컨트롤 위 클릭/스크롤이 지도 드래그·줌으로 전파되지 않게 차단.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        format: 'json',
        limit: '5',
        'accept-language': 'ko',
        countrycodes: 'kr',
        q,
      });
      const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const rows = (await res.json()) as NominatimRow[];
      setResults(
        rows.map((r) => ({
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          label: r.display_name,
        })),
      );
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
      setOpen(true);
    }
  };

  const goTo = (r: SearchResult) => {
    map.flyTo([r.lat, r.lng], 17);
    setOpen(false);
  };

  return (
    <div className="signal-map-search" ref={rootRef}>
      <div className="signal-map-search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="위치 검색 (예: 판교 KETI)"
        />
        <button onClick={() => void search()} disabled={busy}>
          {busy ? '…' : '검색'}
        </button>
      </div>
      {open && (
        <ul className="signal-map-search-results">
          {results.length === 0 && <li className="signal-map-search-empty">결과 없음</li>}
          {results.map((r, i) => (
            <li key={i} onClick={() => goTo(r)}>
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
