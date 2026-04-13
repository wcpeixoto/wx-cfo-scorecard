import { useEffect, useState } from 'react';

type Props = {
  isFading: boolean;
};

export default function LoadingScreen({ isFading }: Props) {
  const [showTimeout, setShowTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowTimeout(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`loading-screen${isFading ? ' loading-screen--fading' : ''}`}>
      <div className="loading-screen__content">
        <span className="loading-screen__brand">Wx CFO Scorecard</span>
        <div className="loading-screen__bars">
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
          <span className="loading-screen__bar" />
        </div>
        <h2 className="loading-screen__headline">Loading your dashboard</h2>
        {showTimeout && (
          <p className="loading-screen__timeout">
            Still working… this is taking longer than usual.
          </p>
        )}
      </div>
    </div>
  );
}
