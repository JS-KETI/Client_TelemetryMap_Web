// Signal Quality Map — 독립 실행 대시보드 진입점.
// /ws/signal 소켓과 저장소를 이 레벨에서 소유하고, 최상위 탭(실시간 지도/히트맵/분석)을 전환한다.
// (구 MoQ 관제 페이지 SignalMapTab 의 역할을 앱 루트로 승격 — 서브탭이 최상위 탭이 된다.)
// 비활성 탭은 언마운트 → 지도가 보이게 될 때 새로 마운트되어 blank 방지(계약 §8).
import { useState } from 'react';
import { useSignalSocket } from './hooks/useSignalSocket';
import type { SignalSocketStatus } from './hooks/useSignalSocket';
import { useSignalStore } from './hooks/useSignalStore';
import { SignalLiveMap } from './components/signal/SignalLiveMap';
import { SignalHeatmap } from './components/signal/SignalHeatmap';
import { SignalAnalysis } from './components/signal/SignalAnalysis';
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

function App() {
  const { deviceIds, deviceLatest, handleSnapshot, handleUpsert } = useSignalStore();
  const [tab, setTab] = useState<Tab>('live');

  const { status } = useSignalSocket({
    url: SIGNAL_WS_URL,
    onSnapshot: handleSnapshot,
    onUpsert: handleUpsert,
  });

  return (
    <div className="app">
      <header className="app-header">
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
      </header>

      <main className="app-main">
        <div className="signal-tab">
          <div className="signal-subtab-body">
            {tab === 'live' && <SignalLiveMap deviceLatest={deviceLatest} />}
            {tab === 'heatmap' && <SignalHeatmap deviceLatest={deviceLatest} />}
            {tab === 'analysis' && <SignalAnalysis storeDeviceIds={deviceIds} />}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
