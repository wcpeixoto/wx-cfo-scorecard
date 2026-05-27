import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  BusinessValuationResult,
  DriverGrade,
  LeaseRunwayGrade,
  Range,
} from '../lib/kpis/businessValuation';
import {
  validateMultipleRange,
  validateReplacementCostRange,
} from '../lib/kpis/businessValuation';

// ── Types ──────────────────────────────────────────────────────────────────

type DriverKey =
  | 'recurringRevenue'
  | 'financialClarity'
  | 'churnTracking'
  | 'coachDepth'
  | 'ownerIndependence'
  | 'brandStrength';

interface DriverRowConfig {
  key: DriverKey | 'leaseRunway';
  label: string;
  tooltip: string;
}

interface Props {
  result: BusinessValuationResult;
  onMultipleRangeChange: (lower: number, upper: number) => void;
  onReplacementCostChange: (range: Range | null) => void;
  onDriverGradeChange: (key: DriverKey, grade: DriverGrade) => void;
}

// ── Display copy ───────────────────────────────────────────────────────────

const DRIVER_TOOLTIPS: Record<DriverKey, string> = {
  recurringRevenue:
    'How reliable and recurring the business income is. Click to set its grade.',
  financialClarity:
    'How organized and trustworthy the business financial reporting is. Click to set its grade.',
  churnTracking:
    'How well member retention and cancellations are monitored. Click to set its grade.',
  coachDepth:
    'How strong the coaching bench is beyond the owner. Click to set its grade.',
  ownerIndependence:
    'How much the business depends on the owner operationally. Click to set its grade.',
  brandStrength:
    'How strong the academy identity/community is beyond one individual. Click to set its grade.',
};

const LEASE_TOOLTIP_WITH_DATA =
  'How secure and stable the physical location is long-term. Calculated from your lease dates in Settings.';
const LEASE_TOOLTIP_NOT_TRACKED =
  'How secure and stable the physical location is long-term. Enter your lease dates in Settings to track this driver.';

const DRIVER_ROWS: DriverRowConfig[] = [
  {
    key: 'recurringRevenue',
    label: 'Recurring revenue',
    tooltip: DRIVER_TOOLTIPS.recurringRevenue,
  },
  {
    key: 'financialClarity',
    label: 'Financial clarity',
    tooltip: DRIVER_TOOLTIPS.financialClarity,
  },
  {
    key: 'churnTracking',
    label: 'Churn tracking',
    tooltip: DRIVER_TOOLTIPS.churnTracking,
  },
  { key: 'leaseRunway', label: 'Lease runway', tooltip: '' },
  {
    key: 'coachDepth',
    label: 'Coach depth',
    tooltip: DRIVER_TOOLTIPS.coachDepth,
  },
  {
    key: 'ownerIndependence',
    label: 'Owner independence',
    tooltip: DRIVER_TOOLTIPS.ownerIndependence,
  },
  {
    key: 'brandStrength',
    label: 'Brand strength',
    tooltip: DRIVER_TOOLTIPS.brandStrength,
  },
];

const GRADE_OPTIONS: { value: DriverGrade; label: string }[] = [
  { value: 'needs_input', label: 'Needs input' },
  { value: 'weak', label: 'Weak' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'strong', label: 'Strong' },
];

// ── Formatters ─────────────────────────────────────────────────────────────

function formatK(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function formatMoneyRange(range: Range): string {
  if (range.lower === range.upper) return formatK(range.lower);
  return `${formatK(range.lower)} – ${formatK(range.upper)}`;
}

function formatMultiple(value: number): string {
  return `${value.toFixed(1)}×`;
}

function formatMultipleRange(range: Range): string {
  if (range.lower === range.upper) return formatMultiple(range.lower);
  return `${formatMultiple(range.lower)} – ${formatMultiple(range.upper)}`;
}

function driverGradeLabel(grade: DriverGrade): string {
  switch (grade) {
    case 'needs_input':
      return 'Needs input';
    case 'weak':
      return 'Weak';
    case 'mixed':
      return 'Mixed';
    case 'strong':
      return 'Strong';
  }
}

function leaseGradeLabel(grade: LeaseRunwayGrade): string {
  switch (grade) {
    case 'strong':
      return 'Strong';
    case 'mixed':
      return 'Mixed';
    case 'weak':
      return 'Weak';
    case 'not_tracked':
      return 'Not tracked';
  }
}

// ── Inline editor — range (two numeric inputs) ─────────────────────────────

interface RangeEditorProps {
  initialLower: number | null;
  initialUpper: number | null;
  helperText: string;
  // 'dollarK' scales input × 1000 on save and ÷ 1000 on edit-open. The "K"
  // suffix in the input wrap signals the unit. 'multiple' is unitless (×).
  unit: 'dollarK' | 'multiple';
  allowEmpty: boolean;
  onSave: (range: Range | null) => void;
  onCancel: () => void;
  inputStep?: string;
}

const SCALE_FACTOR_BY_UNIT: Record<RangeEditorProps['unit'], number> = {
  dollarK: 1000,
  multiple: 1,
};

function RangeEditor({
  initialLower,
  initialUpper,
  helperText,
  unit,
  allowEmpty,
  onSave,
  onCancel,
  inputStep,
}: RangeEditorProps) {
  const scale = SCALE_FACTOR_BY_UNIT[unit];
  const formatForInput = (storedValue: number | null): string => {
    if (storedValue === null) return '';
    const inUnit = storedValue / scale;
    return String(inUnit);
  };
  const [lower, setLower] = useState<string>(formatForInput(initialLower));
  const [upper, setUpper] = useState<string>(formatForInput(initialUpper));
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const handleSave = useCallback(() => {
    const lowerVal = parse(lower);
    const upperVal = parse(upper);

    // Hard NaN guard: typed non-numeric text.
    if (Number.isNaN(lowerVal as number) || Number.isNaN(upperVal as number)) {
      setError('Use numbers only.');
      return;
    }

    const result = allowEmpty
      ? validateReplacementCostRange(lowerVal, upperVal)
      : validateMultipleRange(lowerVal, upperVal);

    if (!result.ok) {
      if (result.reason === 'empty' && allowEmpty) {
        // Replacement cost: clearing reverts to "Needs input".
        onSave(null);
        return;
      }
      if (result.reason === 'empty') setError('Enter a value.');
      else if (result.reason === 'negative') setError('No negative values.');
      else if (result.reason === 'min_gt_max') setError('Low must be ≤ high.');
      else setError('Use numbers only.');
      return;
    }
    // Scale input units to storage units (× 1000 for dollarK, identity for
    // multiple). Result.range carries the editor's literal values; we
    // multiply here at the persistence boundary so downstream selectors
    // always see raw dollars.
    onSave({
      lower: result.range.lower * scale,
      upper: result.range.upper * scale,
    });
  }, [lower, upper, allowEmpty, onSave, scale]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const suffix = unit === 'multiple' ? '×' : 'K';
  const prefix = unit === 'dollarK' ? '$' : '';

  return (
    <div className="bv-editor" onKeyDown={handleKeyDown}>
      <div className="bv-editor-inputs">
        <label className="bv-editor-field">
          <span className="bv-editor-label">Low</span>
          <span className="bv-editor-input-wrap">
            {prefix && <span className="bv-editor-prefix">{prefix}</span>}
            <input
              ref={firstInputRef}
              type="number"
              step={inputStep ?? 'any'}
              min="0"
              value={lower}
              onChange={(e) => {
                setLower(e.target.value);
                setError(null);
              }}
              className="bv-editor-input"
              aria-label="Range low value"
            />
            {suffix && <span className="bv-editor-suffix">{suffix}</span>}
          </span>
        </label>
        <span className="bv-editor-dash">–</span>
        <label className="bv-editor-field">
          <span className="bv-editor-label">High</span>
          <span className="bv-editor-input-wrap">
            {prefix && <span className="bv-editor-prefix">{prefix}</span>}
            <input
              type="number"
              step={inputStep ?? 'any'}
              min="0"
              value={upper}
              onChange={(e) => {
                setUpper(e.target.value);
                setError(null);
              }}
              className="bv-editor-input"
              aria-label="Range high value"
            />
            {suffix && <span className="bv-editor-suffix">{suffix}</span>}
          </span>
        </label>
      </div>
      <p className="bv-editor-helper">{helperText}</p>
      {error && (
        <p className="bv-editor-error" role="alert">
          {error}
        </p>
      )}
      <div className="bv-editor-actions">
        <button
          type="button"
          className="bv-editor-save"
          onClick={handleSave}
        >
          Save
        </button>
        <button
          type="button"
          className="bv-editor-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Inline picker — driver grade ───────────────────────────────────────────

interface GradePickerProps {
  current: DriverGrade;
  onPick: (grade: DriverGrade) => void;
  onCancel: () => void;
}

function GradePicker({ current, onPick, onCancel }: GradePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onCancel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      ref={containerRef}
      className="bv-picker"
      role="menu"
      onKeyDown={handleKeyDown}
    >
      {GRADE_OPTIONS.map((opt, i) => (
        <button
          key={opt.value}
          ref={i === 0 ? firstButtonRef : undefined}
          type="button"
          role="menuitem"
          className={
            opt.value === current
              ? 'bv-picker-item bv-picker-item--active'
              : 'bv-picker-item'
          }
          onClick={() => onPick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Editable value (text affordance + tooltip) ─────────────────────────────

interface EditableValueProps {
  displayText: string;
  ariaLabel: string;
  tooltipText?: string;
  isMuted?: boolean;
  onActivate: () => void;
}

function EditableValue({
  displayText,
  ariaLabel,
  tooltipText,
  isMuted,
  onActivate,
}: EditableValueProps) {
  const tooltipId = useId();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  const valueNode = (
    <span
      role="button"
      tabIndex={0}
      className={
        isMuted
          ? 'bv-editable bv-editable--muted'
          : 'bv-editable'
      }
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      aria-describedby={tooltipText ? tooltipId : undefined}
    >
      {displayText}
    </span>
  );

  if (!tooltipText) return valueNode;

  return (
    <span className="db-tooltip-wrap bv-tooltip-wrap">
      {valueNode}
      <span
        id={tooltipId}
        role="tooltip"
        className="db-tooltip-panel bv-driver-tooltip-panel"
      >
        {tooltipText}
      </span>
    </span>
  );
}

// ── Read-only value (no edit affordance) — Lease runway ────────────────────

interface ReadOnlyValueProps {
  displayText: string;
  tooltipText: string;
  isMuted?: boolean;
}

function ReadOnlyValue({ displayText, tooltipText, isMuted }: ReadOnlyValueProps) {
  const tooltipId = useId();
  return (
    <span className="db-tooltip-wrap bv-tooltip-wrap">
      <span
        tabIndex={0}
        className={isMuted ? 'bv-readonly bv-readonly--muted' : 'bv-readonly'}
        aria-describedby={tooltipId}
      >
        {displayText}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className="db-tooltip-panel bv-driver-tooltip-panel"
      >
        {tooltipText}
      </span>
    </span>
  );
}

// ── Main card ──────────────────────────────────────────────────────────────

export function BusinessValuationCard({
  result,
  onMultipleRangeChange,
  onReplacementCostChange,
  onDriverGradeChange,
}: Props) {
  const [editing, setEditing] = useState<
    | { kind: 'multiple' }
    | { kind: 'replacementCost' }
    | { kind: 'driver'; driver: DriverKey }
    | null
  >(null);

  const closeEditor = useCallback(() => setEditing(null), []);

  const handleMultipleSave = useCallback(
    (range: Range | null) => {
      // Multiple range never accepts empty.
      if (range === null) return;
      onMultipleRangeChange(range.lower, range.upper);
      closeEditor();
    },
    [onMultipleRangeChange, closeEditor]
  );

  const handleReplacementCostSave = useCallback(
    (range: Range | null) => {
      onReplacementCostChange(range);
      closeEditor();
    },
    [onReplacementCostChange, closeEditor]
  );

  const handleGradePick = useCallback(
    (driver: DriverKey, grade: DriverGrade) => {
      onDriverGradeChange(driver, grade);
      closeEditor();
    },
    [onDriverGradeChange, closeEditor]
  );

  const oovDisplay =
    result.ownerOperatorValue === null
      ? 'Needs input'
      : formatMoneyRange(result.ownerOperatorValue);

  const tvDisplay =
    result.transferableValue === null
      ? 'Needs input'
      : formatMoneyRange(result.transferableValue);

  const gapDisplay =
    result.gap === null ? 'Needs input' : formatK(Math.abs(result.gap));

  const ttmSdeDisplay =
    result.ttmSde === null ? 'Needs input' : formatK(result.ttmSde);

  const multipleDisplay = formatMultipleRange(result.multipleRange);

  const replacementDisplay =
    result.replacementCost === null
      ? 'Needs input'
      : formatMoneyRange(result.replacementCost);

  return (
    <div className="ta-card bv-card">
      {/* Header — Pattern B (title + subtitle) */}
      <div className="bv-header">
        <h3 className="bv-title">Business Valuation</h3>
        <p className="bv-subtitle">SDE method</p>
      </div>

      {/* Hero rows: Owner-Operator Value / Transferable Value / Gap */}
      <div className="bv-hero">
        <div className="bv-hero-row">
          <span className="bv-hero-label">Owner-Operator Value</span>
          <span
            className={
              result.ownerOperatorValue === null
                ? 'bv-hero-value bv-hero-value--muted'
                : 'bv-hero-value'
            }
          >
            {oovDisplay}
          </span>
        </div>

        <div className="bv-hero-row">
          <span className="bv-hero-label">Transferable Value</span>
          <span
            className={
              result.transferableValue === null
                ? 'bv-hero-value bv-hero-value--muted'
                : 'bv-hero-value'
            }
          >
            {tvDisplay}
          </span>
        </div>
        {result.replacementCost === null && (
          <p className="bv-hero-note">
            Set Replacement Cost to see Transferable Value.
          </p>
        )}

        <div className="bv-hero-row">
          <span className="bv-hero-label">Gap</span>
          <span
            className={
              result.gap === null
                ? 'bv-hero-value bv-hero-value--muted'
                : 'bv-hero-value'
            }
          >
            {gapDisplay}
          </span>
        </div>
        <p className="bv-teaching-line">
          The smaller this gap gets, the more the business can run without you.
        </p>
      </div>

      {/* Drivers */}
      <div className="bv-drivers">
        <h4 className="bv-drivers-title">Drivers</h4>
        <ul className="bv-drivers-list">
          {DRIVER_ROWS.map((row) => {
            if (row.key === 'leaseRunway') {
              const grade = result.leaseRunway;
              const tooltip =
                grade === 'not_tracked'
                  ? LEASE_TOOLTIP_NOT_TRACKED
                  : LEASE_TOOLTIP_WITH_DATA;
              return (
                <li key={row.key} className="bv-driver-row">
                  <ReadOnlyValue
                    displayText={leaseGradeLabel(grade)}
                    tooltipText={tooltip}
                    isMuted={grade === 'not_tracked'}
                  />
                  <span className="bv-driver-sep">·</span>
                  <span className="bv-driver-label">{row.label}</span>
                </li>
              );
            }

            const driverKey = row.key;
            const grade = result.driverGrades[driverKey];
            const isEditing =
              editing !== null &&
              editing.kind === 'driver' &&
              editing.driver === driverKey;

            return (
              <li key={driverKey} className="bv-driver-row">
                {isEditing ? (
                  <GradePicker
                    current={grade}
                    onPick={(g) => handleGradePick(driverKey, g)}
                    onCancel={closeEditor}
                  />
                ) : (
                  <EditableValue
                    displayText={driverGradeLabel(grade)}
                    ariaLabel={`${row.label} grade — currently ${driverGradeLabel(grade)}`}
                    tooltipText={row.tooltip}
                    isMuted={grade === 'needs_input'}
                    onActivate={() =>
                      setEditing({ kind: 'driver', driver: driverKey })
                    }
                  />
                )}
                <span className="bv-driver-sep">·</span>
                <span className="bv-driver-label">{row.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Bottom rows: TTM SDE / Multiple Range / Replacement Cost */}
      <div className="bv-footer">
        <div className="bv-footer-row">
          <span className="bv-footer-label">TTM SDE</span>
          <span
            className={
              result.ttmSde === null
                ? 'bv-footer-value bv-footer-value--muted'
                : 'bv-footer-value'
            }
          >
            {ttmSdeDisplay}
          </span>
        </div>
        {result.allAddBacksBlank && result.ttmSde !== null && (
          <p className="bv-footer-note">
            Add SDE add-backs in Settings for full accuracy.
          </p>
        )}

        <div className="bv-footer-row">
          <span className="bv-footer-label">Multiple Range</span>
          {editing !== null && editing.kind === 'multiple' ? (
            <RangeEditor
              initialLower={result.multipleRange.lower}
              initialUpper={result.multipleRange.upper}
              helperText="Use a range when you're unsure."
              unit="multiple"
              allowEmpty={false}
              inputStep="0.1"
              onSave={handleMultipleSave}
              onCancel={closeEditor}
            />
          ) : (
            <EditableValue
              displayText={multipleDisplay}
              ariaLabel={`Multiple range — currently ${multipleDisplay}`}
              onActivate={() => setEditing({ kind: 'multiple' })}
            />
          )}
        </div>

        <div className="bv-footer-row">
          <span className="bv-footer-label">Replacement Cost</span>
          {editing !== null && editing.kind === 'replacementCost' ? (
            <RangeEditor
              initialLower={result.replacementCost?.lower ?? null}
              initialUpper={result.replacementCost?.upper ?? null}
              helperText="Use a range when you're unsure."
              unit="dollarK"
              allowEmpty
              onSave={handleReplacementCostSave}
              onCancel={closeEditor}
            />
          ) : (
            <EditableValue
              displayText={replacementDisplay}
              ariaLabel={`Replacement cost — ${
                result.replacementCost === null ? 'needs input' : replacementDisplay
              }`}
              isMuted={result.replacementCost === null}
              onActivate={() => setEditing({ kind: 'replacementCost' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
