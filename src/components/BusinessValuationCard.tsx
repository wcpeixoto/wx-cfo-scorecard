import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  BusinessValuationResult,
  DriverGrade,
  LeaseRunwayGrade,
  Range,
  ValuationDriverImpact,
} from '../lib/kpis/businessValuation';
import {
  // Still imported because RangeEditor's allowEmpty=false branch references
  // it (dead branch now that the inline multiple editor is gone, but the
  // editor function is still in this file for the replacement-cost path).
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

interface Props {
  result: BusinessValuationResult;
  onReplacementCostChange: (range: Range | null) => void;
  onDriverGradeChange: (key: DriverKey, grade: DriverGrade) => void;
}

// ── Display copy ───────────────────────────────────────────────────────────

// Per-driver base description (the V1 "what this driver means" sentence).
// Render-time appends a current-grade + contribution suffix via
// driverTooltipText() so the tooltip always reflects the live impact.
const DRIVER_BASE_TOOLTIPS: Record<DriverKey, string> = {
  recurringRevenue:
    'How reliable and recurring the business income is.',
  financialClarity:
    'How organized and trustworthy the business financial reporting is.',
  churnTracking:
    'How well member retention and cancellations are monitored.',
  coachDepth:
    'How strong the coaching bench is beyond the owner.',
  ownerIndependence:
    'How much the business depends on the owner operationally.',
  brandStrength:
    'How strong the academy identity/community is beyond one individual.',
};

const LEASE_BASE_TOOLTIP =
  'How secure and stable the physical location is long-term. Auto-graded from your lease dates in Settings.';
const LEASE_BASE_TOOLTIP_NOT_TRACKED =
  'How secure and stable the physical location is long-term. Add lease dates in Settings to grade this driver.';

const SDE_METHOD_TOOLTIP_PARAGRAPHS: string[] = [
  'This estimates what your business could sell for.',
  'It starts with owner cash flow from the last 12 months, then adjusts based on buyer risk. The starting point is 2.25× owner cash flow.',
  'Value goes up when the business can run without you, has recurring revenue, a strong lease, good coaches, clean books, churn tracking, and a transferable brand. Value goes down when those drivers are weak or missing.',
  'Final value stays between 1.5× and 3.0× owner cash flow.',
  'This is not an official appraisal, just a practical benchmark to show what improves — or hurts — business value.',
];

const MULTIPLE_CLIP_TOOLTIP = 'Range narrowed by the 1.5×–3.0× cap.';

interface DriverRowConfig {
  key: DriverKey | 'leaseRunway';
  label: string;
}

// Display order matches `DRIVER_IMPACT_ORDER` in the selector so the
// impact-list index aligns with the rendered row order.
const DRIVER_ROWS: DriverRowConfig[] = [
  { key: 'recurringRevenue',  label: 'Recurring revenue' },
  { key: 'leaseRunway',       label: 'Lease runway' },
  { key: 'coachDepth',        label: 'Coach depth' },
  { key: 'ownerIndependence', label: 'Owner independence' },
  { key: 'financialClarity',  label: 'Financial clarity' },
  { key: 'churnTracking',     label: 'Churn tracking' },
  { key: 'brandStrength',     label: 'Brand strength' },
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
  // 2-decimal precision matches the derived multiple's 0.05× granularity.
  return `${value.toFixed(2)}×`;
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

// Impact column display. Returns null for needs_input / not_tracked so the
// column slot renders blank. Uses Unicode minus (−) for visual consistency
// with the en-dash range separator elsewhere in the card.
function formatContribution(impact: ValuationDriverImpact): string | null {
  if (impact.grade === 'needs_input' || impact.grade === 'not_tracked') {
    return null;
  }
  if (impact.grade === 'mixed') return '0.00×';
  const magnitude = Math.abs(impact.contribution).toFixed(2);
  const sign = impact.contribution > 0 ? '+' : '−';
  return `${sign}${magnitude}×`;
}

// Per-driver tooltip — base description + dynamic current-grade/contribution
// suffix. Lease and other drivers diverge on the suffix copy.
function driverTooltipText(
  impact: ValuationDriverImpact,
  rowKey: DriverKey | 'leaseRunway'
): string {
  if (rowKey === 'leaseRunway') {
    if (impact.grade === 'not_tracked') return LEASE_BASE_TOOLTIP_NOT_TRACKED;
    const contribution = formatContribution(impact) ?? '0.00×';
    const gradeLabel = leaseGradeLabel(impact.grade as LeaseRunwayGrade);
    return `${LEASE_BASE_TOOLTIP} Currently ${gradeLabel}, contributing ${contribution} to your multiple.`;
  }

  const baseText = DRIVER_BASE_TOOLTIPS[rowKey];
  const gradeLabel = driverGradeLabel(impact.grade as DriverGrade);
  if (impact.grade === 'needs_input') {
    return `${baseText} Currently ${gradeLabel}. Click to set this driver's grade.`;
  }
  const contribution = formatContribution(impact) ?? '0.00×';
  return `${baseText} Currently ${gradeLabel}, contributing ${contribution} to your multiple. Click to change.`;
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
  onReplacementCostChange,
  onDriverGradeChange,
}: Props) {
  const [editing, setEditing] = useState<
    | { kind: 'replacementCost' }
    | { kind: 'driver'; driver: DriverKey }
    | null
  >(null);
  const sdeTooltipId = useId();

  const closeEditor = useCallback(() => setEditing(null), []);

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

  const multipleDisplay = formatMultipleRange(result.displayMultipleRange);

  // Owner Independence resolves which note / value the Replacement Cost row
  // shows. Strong forces effective $0 (no editor change; persisted value
  // preserved). Needs input shows "Needs input" REGARDLESS of persisted value
  // — TV and Gap are blocked until OI is graded, so the cost row reflects
  // the same "ungraded" state. Mixed/Weak with blank → default $60K applied;
  // with a persisted nonzero, the persisted value renders.
  const ownerIndependenceGrade = result.driverGrades.ownerIndependence;
  const isOwnerIndependenceStrong = ownerIndependenceGrade === 'strong';
  const isOwnerIndependenceNeedsInput = ownerIndependenceGrade === 'needs_input';
  const replacementDisplay = isOwnerIndependenceStrong
    ? formatK(0)
    : isOwnerIndependenceNeedsInput
      ? 'Needs input'
      : result.replacementCostDefaultApplied && result.effectiveReplacementCost
        ? formatMoneyRange(result.effectiveReplacementCost)
        : result.replacementCost === null
          ? 'Needs input'
          : formatMoneyRange(result.replacementCost);
  // Muted when the row displays "Needs input" — covers (a) Needs input OI
  // (regardless of persisted) and (b) blank persisted under Mixed/Weak with
  // no default applied (which shouldn't happen since default kicks in, but
  // defensive).
  const isReplacementMuted =
    isOwnerIndependenceNeedsInput ||
    (result.replacementCost === null && !result.replacementCostDefaultApplied);

  return (
    <div className="ta-card bv-card">
      {/* Header — Pattern B (title + subtitle).
          The "SDE method" subtitle is the anchor for the card-level
          explainer tooltip. Hover/focus reveals the wide panel. No info
          icon, no new button — the subtitle text itself is interactive. */}
      <div className="bv-header">
        <h3 className="bv-title">Business Valuation</h3>
        <span className="db-tooltip-wrap bv-card-tooltip-wrap">
          <p
            className="bv-subtitle bv-subtitle--tooltip"
            tabIndex={0}
            aria-describedby={sdeTooltipId}
          >
            SDE method
          </p>
          <span
            id={sdeTooltipId}
            role="tooltip"
            className="db-tooltip-panel is-wide bv-card-tooltip-panel"
          >
            {SDE_METHOD_TOOLTIP_PARAGRAPHS.map((para, idx) => (
              <p
                key={idx}
                className="bv-card-tooltip-paragraph"
              >
                {para}
              </p>
            ))}
          </span>
        </span>
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
        {result.transferableValue === null && (
          <p className="bv-hero-note">
            {ownerIndependenceGrade === 'needs_input'
              ? 'Set Owner Independence to see Transferable Value.'
              : 'Set Replacement Cost to see Transferable Value.'}
          </p>
        )}

        <div className="bv-hero-row">
          <span className="bv-hero-label">Transferability Gap</span>
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
        {isOwnerIndependenceStrong && result.gap !== null ? (
          <p className="bv-teaching-line bv-teaching-line--strong">
            Your business already operates independently of you. Strong work.
          </p>
        ) : (
          <p className="bv-teaching-line">
            The smaller this gap, the more the business can run without you.
          </p>
        )}
      </div>

      {/* Drivers — impacts list in canonical render order. Each row shows
          grade (left), label (middle), contribution (right). Lease is
          auto-graded and read-only with an "(auto)" suffix. Other drivers
          are owner-set, click-to-edit. */}
      <div className="bv-drivers">
        <h4 className="bv-drivers-title">Drivers</h4>
        <ul className="bv-drivers-list">
          {DRIVER_ROWS.map((row, idx) => {
            const impact = result.driverImpacts[idx];
            const contribution = formatContribution(impact);
            const tooltipText = driverTooltipText(impact, row.key);

            if (row.key === 'leaseRunway') {
              const leaseGrade = result.leaseRunway;
              return (
                <li key={row.key} className="bv-driver-row">
                  <ReadOnlyValue
                    displayText={leaseGradeLabel(leaseGrade)}
                    tooltipText={tooltipText}
                    isMuted={leaseGrade === 'not_tracked'}
                  />
                  <span className="bv-driver-sep">·</span>
                  <span className="bv-driver-label">
                    {row.label}
                    <span className="bv-driver-auto"> (auto)</span>
                  </span>
                  {contribution !== null && (
                    <span className="bv-impact-cell">{contribution}</span>
                  )}
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
                    tooltipText={tooltipText}
                    isMuted={grade === 'needs_input'}
                    onActivate={() =>
                      setEditing({ kind: 'driver', driver: driverKey })
                    }
                  />
                )}
                <span className="bv-driver-sep">·</span>
                <span className="bv-driver-label">{row.label}</span>
                {contribution !== null && (
                  <span className="bv-impact-cell">{contribution}</span>
                )}
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

        {/* Derived Multiple — static (PR-A removed the inline editor).
            Subtitle "Derived from drivers" is the only affordance. When the
            display range was clipped against the 1.5×–3.0× cap, a tooltip
            on the value explains the asymmetric narrowing. */}
        <div className="bv-footer-row">
          <span className="bv-footer-label">Derived Multiple</span>
          <div className="bv-multiple-wrap">
            {result.wasClipped ? (
              <ReadOnlyValue
                displayText={multipleDisplay}
                tooltipText={MULTIPLE_CLIP_TOOLTIP}
              />
            ) : (
              <span className="bv-multiple-display">{multipleDisplay}</span>
            )}
            <span className="bv-multiple-derived-label">
              Derived from drivers
            </span>
          </div>
        </div>

        {/* Replacement Cost — editor unchanged from V1 for Mixed/Weak/Needs
            input. When Owner Independence is Strong, the field still shows
            but reflects effective $0 in math (persisted value preserved on
            the result for switch-back). When the $60K default applies
            (Mixed/Weak + blank), a note explains the source. */}
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
                replacementDisplay === 'Needs input' ? 'needs input' : replacementDisplay
              }`}
              isMuted={isReplacementMuted}
              onActivate={() => setEditing({ kind: 'replacementCost' })}
            />
          )}
        </div>
        {result.replacementCostDefaultApplied && (
          <p className="bv-footer-note">
            Defaulted to $60K estimated GM/lead coach replacement. Adjust to your local market.
          </p>
        )}
      </div>
    </div>
  );
}
