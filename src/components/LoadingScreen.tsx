import { useEffect, useState } from 'react';
import primaryLogo from '../assets/wx-estates-primary.png';

type Props = {
  isFading: boolean;
};

const STATUS_MESSAGES = [
  'Pulling balances',
  'Reconciling cash flow',
  'Scoring the month',
  'Building your scorecard',
] as const;

const HEADLINE_BEFORE = 'Your business ';
const HEADLINE_EMPHASIS = 'clarity';
const HEADLINE_AFTER = ' is loading.';

// Pinned to light; the rest of the app is light-only, so an auto
// (prefers-color-scheme) loader would flash dark→light on boot.
// When the app supports dark mode end-to-end: flip THEME to a matchMedia
// hook AND restore the reverse-logo import + <img class="is-reverse"> so
// the cross-fade has something to fade to. CSS tokens already in place.
const THEME = 'light' as const;

export default function LoadingScreen({ isFading }: Props) {
  const total = STATUS_MESSAGES.length;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((prev) => (prev + 1) % total);
    }, 2200);
    return () => clearInterval(id);
  }, [total]);

  const rollClass = (i: number) => {
    if (i === idx) return 'loading-screen__roll-item is-current';
    if (i === (idx - 1 + total) % total) return 'loading-screen__roll-item is-previous';
    return 'loading-screen__roll-item is-next';
  };

  const stageClass =
    `loading-screen theme-${THEME}` + (isFading ? ' loading-screen--fading' : '');

  return (
    <div className={stageClass}>
      <div className="loading-screen__brand">
        <div className="loading-screen__logo">
          <img
            className="loading-screen__logo-img is-primary"
            src={primaryLogo}
            alt="Wx Estates"
          />
        </div>
        <div className="loading-screen__tag">CFO Scorecard</div>
      </div>

      <div className="loading-screen__center">
        <div className="loading-screen__ticker" aria-live="polite">
          <div className="loading-screen__ticker-line">
            <span className="loading-screen__spinner" aria-hidden="true" />
            <span className="loading-screen__roll">
              {STATUS_MESSAGES.map((m, i) => (
                <span key={i} className={rollClass(i)}>
                  {m}…
                </span>
              ))}
            </span>
          </div>
        </div>

        <h1 className="loading-screen__headline">
          {HEADLINE_BEFORE}
          <em>{HEADLINE_EMPHASIS}</em>
          {HEADLINE_AFTER}
        </h1>
      </div>

      <div className="loading-screen__footer">
        <span className="loading-screen__rule" />
        Built on cash flow
        <span className="loading-screen__rule" />
      </div>
    </div>
  );
}
