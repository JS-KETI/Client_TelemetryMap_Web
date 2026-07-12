// 등급 임계값 설정 패널 — 헤더의 설정 버튼으로 슬라이드 다운.
// 양호/보통/불량 판정 기준 점수를 조정한다 (localStorage 유지, 이 브라우저에만 적용).
import { useEffect, useState } from 'react';
import type { GradeThresholds } from '../../utils/signal';
import { DEFAULT_THRESHOLDS, GRADE_COLORS } from '../../utils/signal';

interface Props {
  thresholds: GradeThresholds;
  onChange: (t: GradeThresholds) => void;
}

export function ThresholdSettings({ thresholds, onChange }: Props) {
  const [good, setGood] = useState(String(thresholds.good));
  const [fair, setFair] = useState(String(thresholds.fair));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGood(String(thresholds.good));
    setFair(String(thresholds.fair));
  }, [thresholds]);

  const apply = (goodStr: string, fairStr: string) => {
    const g = Number(goodStr);
    const f = Number(fairStr);
    if (!Number.isFinite(g) || !Number.isFinite(f)) {
      setError('숫자를 입력하세요');
      return;
    }
    if (f < 0 || g > 100 || f >= g) {
      setError('0 ≤ 보통 기준 < 양호 기준 ≤ 100 이어야 합니다');
      return;
    }
    setError(null);
    onChange({ good: g, fair: f });
  };

  return (
    <div className="threshold-panel">
      <div className="threshold-fields">
        <label className="threshold-field">
          <span className="threshold-chip" style={{ background: GRADE_COLORS.GOOD }} />
          양호: 점수 ≥
          <input
            type="number"
            min={1}
            max={100}
            value={good}
            onChange={(e) => {
              setGood(e.target.value);
              apply(e.target.value, fair);
            }}
          />
        </label>
        <label className="threshold-field">
          <span className="threshold-chip" style={{ background: GRADE_COLORS.FAIR }} />
          보통: 점수 ≥
          <input
            type="number"
            min={0}
            max={99}
            value={fair}
            onChange={(e) => {
              setFair(e.target.value);
              apply(good, e.target.value);
            }}
          />
        </label>
        <span className="threshold-field threshold-readonly">
          <span className="threshold-chip" style={{ background: GRADE_COLORS.POOR }} />
          불량: 점수 &lt; {Number.isFinite(Number(fair)) ? fair : '-'}
        </span>
        <button
          className="threshold-reset"
          onClick={() => {
            setError(null);
            onChange({ ...DEFAULT_THRESHOLDS });
          }}
        >
          기본값 복원
        </button>
      </div>
      {error ? (
        <p className="threshold-note threshold-error">{error}</p>
      ) : (
        <p className="threshold-note">
          점수(0~100) 기준으로 지도 마커·히트맵 격자 색이 즉시 갱신됩니다. 이 브라우저에만 저장됩니다.
        </p>
      )}
    </div>
  );
}
