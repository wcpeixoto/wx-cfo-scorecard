import { useEffect, useMemo, useState } from 'react';

const QUOTES = [
  'A goal is a dream with a deadline.',
  'Patience, persistence and perspiration make an unbeatable combination for success.',
  "Don't wait. The time will never be just right.",
  'Whatever the mind can conceive and believe, it can achieve.',
  'Every adversity carries with it the seed of an equal or greater benefit.',
  'The starting point of all achievement is desire.',
  'Victory is always possible for the person who refuses to stop fighting.',
  'Self-discipline begins with the mastery of your thoughts.',
];

type Props = {
  isFading: boolean;
};

export default function LoadingScreen({ isFading }: Props) {
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);
  const [showTimeout, setShowTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowTimeout(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`loading-screen${isFading ? ' loading-screen--fading' : ''}`}>
      <div className="loading-screen__content">
        <span className="loading-screen__brand">Wx CFO Scorecard</span>
        <h2 className="loading-screen__headline">Loading your dashboard</h2>
        <p className="loading-screen__subline">
          Pulling together your transactions, trends, and forecast
        </p>
        <div className="loading-screen__bars">
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
        </div>
        {showTimeout && (
          <p className="loading-screen__timeout">
            Still working… this is taking longer than usual.
          </p>
        )}
        <p className="loading-screen__quote">"{quote}"</p>
        <p className="loading-screen__attribution">— Napoleon Hill</p>
      </div>
    </div>
  );
}
