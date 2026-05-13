import { useEffect, useRef, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';

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
    <div className="action-dropdown" ref={containerRef}>
      <button
        type="button"
        className="action-dropdown-trigger"
        onClick={() => setIsOpen((c) => !c)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Period: ${selectedLabel}`}
      >
        <span className="action-dropdown-label">{selectedLabel}</span>
        <FiChevronDown
          className={`action-dropdown-caret${isOpen ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <ul className="action-dropdown-menu" role="menu">
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
