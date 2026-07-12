// Signal Quality Map — 독립 실행 대시보드 진입점.
// /ws/signal 소켓과 저장소를 이 레벨에서 소유하고, 최상위 탭(실시간 지도/히트맵/분석)을 전환한다.
// (구 MoQ 관제 페이지 SignalMapTab 의 역할을 앱 루트로 승격 — 서브탭이 최상위 탭이 된다.)
// 비활성 탭은 언마운트 → 지도가 보이게 될 때 새로 마운트되어 blank 방지(계약 §8).
import { useEffect, useMemo, useState } from 'react';
import { useSignalSocket } from './hooks/useSignalSocket';
import type { SignalSocketStatus } from './hooks/useSignalSocket';
import { useSignalStore } from './hooks/useSignalStore';
import { SignalLiveMap } from './components/signal/SignalLiveMap';
import { SignalHeatmap } from './components/signal/SignalHeatmap';
import { SignalAnalysis } from './components/signal/SignalAnalysis';
import { ThresholdSettings } from './components/signal/ThresholdSettings';
import type { GradeThresholds } from './utils/signal';
import { loadThresholds, saveThresholds } from './utils/signal';
import './components/signal/signal.css';
import './App.css';

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const SIGNAL_WS_URL = `${WS_PROTOCOL}://${window.location.host}/ws/signal`;

type Tab = 'live' | 'heatmap' | 'analysis';

const TABS: { key: Tab; label: string }[] = [
  { key: 'live', label: '실시간 지도' },
  { key: 'heatmap', label: '히트맵' },
  { key: 'analysis', label: '분석' },
];

const CONN_LABEL: Record<SignalSocketStatus, string> = {
  connecting: '연결 중',
  open: '실시간 연결됨',
  closed: '연결 끊김',
};

// 라이브 뷰 활성 기준: 최근 10분 내 측정 수신이 없는 기기는 지도 마커/기기 목록에서 제외.
// (히트맵 격자·분석 탭은 이력 데이터라서 영향 없음)
const ACTIVE_WINDOW_MS = 10 * 60_000;

function App() {
  const { deviceIds, deviceLatest, handleSnapshot, handleUpsert } = useSignalStore();
  const [tab, setTab] = useState<Tab>('live');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thresholds, setThresholds] = useState<GradeThresholds>(() => loadThresholds());

  const { status } = useSignalSocket({
    url: SIGNAL_WS_URL,
    onSnapshot: handleSnapshot,
    onUpsert: handleUpsert,
  });

  const handleThresholds = (t: GradeThresholds) => {
    setThresholds(t);
    saveThresholds(t);
  };

  // 30초마다 활성 여부 재평가 — 측정이 끊긴 기기는 라이브 뷰에서 자동으로 사라진다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const activeDeviceLatest = useMemo(
    () =>
      deviceLatest.filter((d) => {
        const t = new Date(d.latest.recordedAt).getTime();
        return Number.isFinite(t) && nowMs - t <= ACTIVE_WINDOW_MS;
      }),
    [deviceLatest, nowMs],
  );

  return (
    <div className="app">
      <header className="app-header">
        <img className="app-logo" src="/keti_logo.jpg" alt="KETI" />
        <h1>Signal Quality Map</h1>
        <nav className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className={`app-conn app-conn-${status}`}>
          <span className="app-conn-dot" />
          {CONN_LABEL[status]}
        </div>
        <button
          className={`app-settings-btn ${settingsOpen ? 'active' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title="등급 임계값 설정"
        >
          ⚙ 설정
        </button>
      </header>

      <div className={`settings-drawer ${settingsOpen ? 'open' : ''}`}>
        <ThresholdSettings thresholds={thresholds} onChange={handleThresholds} />
      </div>

      <main className="app-main">
        <div className="signal-tab">
          <div className="signal-subtab-body">
            {tab === 'live' && <SignalLiveMap deviceLatest={activeDeviceLatest} thresholds={thresholds} />}
            {tab === 'heatmap' && <SignalHeatmap deviceLatest={activeDeviceLatest} thresholds={thresholds} />}
            {tab === 'analysis' && <SignalAnalysis storeDeviceIds={deviceIds} thresholds={thresholds} />}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
