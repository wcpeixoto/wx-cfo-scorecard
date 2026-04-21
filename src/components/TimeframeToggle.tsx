import { useEffect, useRef, useState } from 'react';

export type TimeframeOption = { value: string; label: string };

type TimeframeToggleProps = {
  options: TimeframeOption[];
  selected: string;
  onChange: (value: string) => void;
  /** How many options to show as inline pills before overflow goes into "More ▾". Defaults to 3. */
  visibleCount?: number;
};

export default function TimeframeToggle({ options, selected, onChange, visibleCount = 3 }: TimeframeToggleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleOptions = options.slice(0, visibleCount);
  const overflowOptions = options.slice(visibleCount);
  const overflowIsActive = overflowOptions.some((o) => o.value === selected);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="kpi-timeframe-toggle" role="group" aria-label="Timeframe selector">
      {visibleOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={selected === option.value ? 'is-active' : ''}
          onClick={() => {
            onChange(option.value);
            setIsOpen(false);
          }}
        >
          {option.label}
        </button>
      ))}

      {overflowOptions.length > 0 && (
        <div className="timeframe-menu" ref={menuRef}>
          <button
            type="button"
            className={`timeframe-trigger${overflowIsActive ? ' is-active' : ''}`}
            onClick={() => setIsOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
          >
            {overflowIsActive ? (options.find((o) => o.value === selected)?.label ?? 'More') : 'More'} ▾
          </button>
          {isOpen && (
            <ul className="timeframe-list" role="menu" aria-label="Select timeframe">
              {overflowOptions.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected === option.value}
                    className={selected === option.value ? 'is-active' : ''}
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
