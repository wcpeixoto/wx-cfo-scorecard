import { useEffect, useRef, useState } from 'react';

export type PeriodOption = { value: string; label: string };

type PeriodDropdownProps = {
  value: string;
  options: PeriodOption[];
  onChange: (value: string) => void;
};

export default function PeriodDropdown({ value, options, onChange }: PeriodDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="period-dropdown" ref={containerRef}>
      <button
        type="button"
        className="period-dropdown-trigger"
        onClick={() => setIsOpen((c) => !c)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {selectedLabel} <span className="period-dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <ul className="period-dropdown-menu" role="menu">
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                className={option.value === value ? 'is-active' : ''}
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
  );
}
