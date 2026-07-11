# Client_TelemetryMap_Web — 신호 품질 대시보드

네트워크 신호 품질 히트맵 시스템(TelemetryMap)의 웹 대시보드. React 19 + TypeScript + Vite + Leaflet + Chart.js.

## 탭 구성

| 탭 | 내용 |
|---|---|
| 실시간 지도 | 단말별 최신 실외 측정 위치 마커(색=품질 등급), 클릭 팝업(RSRP/RSRQ/SINR/WiFi/Score), 우측 디바이스 패널 |
| 히트맵 | 실외(15m 격자 GeoJSON) / 실내(층 선택 + 도면 셀) 토글, 메트릭·기간 선택, 범례 |
| 분석 | Chart.js RSRP·SINR 시계열(이중축), 단말·기간 선택, replay 슬라이더 |

## 개발

```bash
npm install
npm run dev     # http://localhost:5173  (/api, /ws → localhost:8080 프록시)
npm run build   # tsc -b && vite build
```

백엔드는 `Server_TelemetryMap`(기본 포트 8080)을 먼저 띄운다. 서버 없이도 화면은 뜨며 빈 상태("데이터 없음")로 표시된다.

품질 등급/색상·API 계약은 `../plan/telemetry-map-contract.md` 참조.

> 참고: Node 20.x + npm 조합에서 rolldown 네이티브 바인딩이 누락되는 npm 버그가 있어 `@rolldown/binding-win32-x64-msvc`를 optionalDependencies로 명시해 두었다. Vite는 Node 20.13에서 검증된 8.0.1로 고정.
