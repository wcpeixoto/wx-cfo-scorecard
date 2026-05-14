import { useEffect, useRef, useState } from 'react';
import type { Signal, PriorityHistoryRow } from '../lib/priorities/types';
import { getFallbackCopy } from '../lib/priorities/copy';
import { getAIProse, type AIProse } from '../lib/priorities/ai';
import { getLastPriorityHistory } from '../lib/data/sharedPersistence';

interface HeroPriorityCardProps {
  signal: Signal;
}

function severityLabel(severity: Signal['severity']): string {
  switch (severity) {
    case 'critical': return 'Needs attention';
    case 'warning': return 'Watch';
    case 'healthy': return 'Healthy';
  }
}

// Single-layer fade: on prose update, briefly drop opacity to 0, swap
// content, then restore opacity to 1. 100ms out + 100ms in = 200ms total.
// No DOM duplication, no cross-fade — just one element with an opacity class.
const FADE_OUT_MS = 100;

export function HeroPriorityCard({ signal }: HeroPriorityCardProps) {
  const [prose, setProse] = useState<AIProse>(() => getFallbackCopy(signal));
  const [isFading, setIsFading] = useState(false);

  // Guard against StrictMode double-invoke: ensure the network/AI fetch runs
  // at most once per hero signal type. The cancelled flag gates only state
  // updates — the async chain always runs to completion so getAIProse fires
  // exactly once per stable signal type.
  const didRunRef = useRef<string | null>(null);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (didRunRef.current === signal.type) return;
    didRunRef.current = signal.type;

    let cancelled = false;

    async function run() {
      let history: PriorityHistoryRow | null = null;
      try {
        history = await getLastPriorityHistory(signal.type);
      } catch {
        history = null;
      }

      // Keep async work running even if cancelled — StrictMode's
      // pseudo-unmount sets cancelled=true between the two awaits, and
      // short-circuiting would prevent getAIProse from being called.
      // Only gate state updates (and the fade) on cancelled.
      if (!cancelled) swapProse(getFallbackCopy(signal, history ?? undefined));

      const ai = await getAIProse(signal, history ?? undefined);
      if (!cancelled) swapProse(ai);
    }

    function swapProse(next: AIProse) {
      if (isFirstRenderRef.current) {
        isFirstRenderRef.current = false;
        setProse(next);
        return;
      }
      setIsFading(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setProse(next);
        setIsFading(false);
      }, FADE_OUT_MS);
    }

    run();
    return () => { cancelled = true; };
  }, [signal.type]);

  return (
    <article className="today-hero-card">
      <div className={isFading ? 'today-hero-body is-fading' : 'today-hero-body'}>
        {/* Card label */}
        <p className="today-hero-eyebrow">Top Financial Priority</p>

        {/* Header row: headline left, severity pill right */}
        <div className="hero-card-header">
          <h2 className="today-hero-headline">{prose.headline}</h2>
          <span className={`today-severity-pill is-${signal.severity}`}>
            <span className="today-severity-dot" aria-hidden="true" />
            {severityLabel(signal.severity)}
          </span>
        </div>

        {/* 3. Action block — dominant, visually emphasized */}
        <div className="hero-action-block">
          <p className="hero-action-label">What to do</p>
          <p className="hero-action-text">{prose.action}</p>
        </div>

        {/* 4. Why this matters */}
        <div className="today-hero-section">
          <p className="today-hero-label">Why this matters</p>
          <p className="today-hero-text">{prose.why}</p>
        </div>

        {/* 5. Where you are now */}
        <div className="today-hero-section">
          <p className="today-hero-label">Where you are now</p>
          <p className="today-hero-text">{prose.currentState}</p>
        </div>
      </div>
    </article>
  );
}
