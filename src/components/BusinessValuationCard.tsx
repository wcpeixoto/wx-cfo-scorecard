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

// Tooltips for the single-hero layout (Phase 2 redesign). Six rows carry
// tooltips: BV hero, range subtitle, Buyer-Ready Value, Owner Dependence Gap,
// TTM SDE, Derived Multiple. Replacement Cost retains its existing inline
// helper text (PR-B owns the rename + new tooltip copy).
const BV_HERO_TOOLTIP =
  'What the business is worth today with you running it. Based on the last 12 months of cash flow (TTM SDE) times the valuation multiple.';
const BV_RANGE_TOOLTIP =
  'The low and high estimate. The headline number is the midpoint of this range.';
const BUYER_READY_TOOLTIP =
  "What the business is worth to a buyer after paying someone to do your day-to-day job. If this is low, the business still leans heavily on you.";
const OWNER_DEPENDENCE_GAP_TOOLTIP =
  "Value that exists only because you're running things. The smaller this gap, the more the business can run without you — and the easier it is to sell.";
const TTM_SDE_TOOLTIP =
  "Trailing twelve-month Seller's Discretionary Earnings — the business's annual cash flow before accounting for the cost of replacing you.";
const DERIVED_MULTIPLE_TOOLTIP =
  'The valuation multiple built from seven business-quality drivers: recurring revenue, lease runway, coach depth, owner independence, financial clarity, churn tracking, and brand strength.';

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
  const bvHeroTooltipId = useId();
  const bvRangeTooltipId = useId();
  const buyerReadyTooltipId = useId();
  const ownerDepGapTooltipId = useId();
  const ttmSdeTooltipId = useId();
  const derivedMultipleTooltipId = useId();

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

  // Hero = midpoint of the OOV range. Uses the same formatter as the range
  // endpoints (formatK) so rounding stays consistent on screen — a viewer
  // mentally computing midpoint of the visible range will land on the same
  // value as the hero (within K-rounding).
  const heroMidpoint =
    result.ownerOperatorValue === null
      ? null
      : (result.ownerOperatorValue.lower + result.ownerOperatorValue.upper) / 2;
  const heroDisplay = heroMidpoint === null ? 'Needs input' : formatK(heroMidpoint);

  const rangeSubtitleDisplay =
    result.ownerOperatorValue === null
      ? null
      : formatMoneyRange(result.ownerOperatorValue);

  // Buyer-Ready Value: midpoint of the TV range (single value per the
  // range-display rule — only the hero shows a range).
  const buyerReadyMidpoint =
    result.transferableValue === null
      ? null
      : (result.transferableValue.lower + result.transferableValue.upper) / 2;
  const buyerReadyDisplay =
    buyerReadyMidpoint === null ? 'Needs input' : formatK(buyerReadyMidpoint);

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

  // OI=Strong override note: show "(set to $0 — Owner Independence is
  // Strong)" only when persisted is a real non-zero value. Persisted null or
  // zero range needs no explanation — $0 is just $0. The Strong override note
  // is MUTUALLY EXCLUSIVE with replacementCostDefaultApplied (Strong never
  // triggers the default), so the two notes never co-render.
  const persistedReplacementIsNonZero =
    result.replacementCost !== null &&
    !(result.replacementCost.lower === 0 && result.replacementCost.upper === 0);
  const showStrongOverrideNote =
    isOwnerIndependenceStrong && persistedReplacementIsNonZero;

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

      {/* Single dominant hero — midpoint of the Business Valuation range
          (= SDE × derivedMultiple, by midpoint-preservation invariant) with
          a "Range: low – high" subtitle. Per the range-display rule, the
          hero is the ONLY metric that surfaces a range; the supporting rows
          below render single values even though the same uncertainty
          applies. */}
      <div className="bv-hero">
        {result.ownerOperatorValue === null ? (
          <span className="bv-hero-dominant bv-hero-dominant--muted">
            {heroDisplay}
          </span>
        ) : (
          <>
            <span className="db-tooltip-wrap bv-hero-tooltip-wrap">
              <span
                tabIndex={0}
                className="bv-hero-dominant"
                aria-describedby={bvHeroTooltipId}
              >
                {heroDisplay}
              </span>
              <span
                id={bvHeroTooltipId}
                role="tooltip"
                className="db-tooltip-panel bv-driver-tooltip-panel"
              >
                {BV_HERO_TOOLTIP}
              </span>
            </span>
            <span className="db-tooltip-wrap bv-hero-tooltip-wrap">
              <span
                tabIndex={0}
                className="bv-hero-range"
                aria-describedby={bvRangeTooltipId}
              >
                Range: {rangeSubtitleDisplay}
              </span>
              <span
                id={bvRangeTooltipId}
                role="tooltip"
                className="db-tooltip-panel bv-driver-tooltip-panel"
              >
                {BV_RANGE_TOOLTIP}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Drivers — impacts list in canonical render order. Each row shows
          grade (left), label (middle), contribution (right). Lease is
          auto-graded and rendered as a read-only value (no dotted-underline
          editable affordance); the "Auto-graded from your lease dates in
          Settings" detail lives in the lease tooltip. Other drivers are
          owner-set, click-to-edit. */}
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
                  <span className="bv-driver-label">{row.label}</span>
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

      {/* Bottom rows: TTM SDE / Derived Multiple / Buyer-Ready Value /
          Owner Dependence Gap / Replacement Cost. The compressed layout
          demotes OOV/TV/Gap (formerly hero-weight) to label-left/value-right
          rows; tooltips on the labels explain the metric. Replacement Cost
          label is preserved this round — PR-B owns the rename to "Cost to
          Replace You" alongside the data-column rename and migration. */}
      <div className="bv-footer">
        {/* TTM SDE */}
        <div className="bv-footer-row">
          <span className="db-tooltip-wrap bv-footer-tooltip-wrap">
            <span
              className="bv-footer-label bv-footer-label--tooltip"
              tabIndex={0}
              aria-describedby={ttmSdeTooltipId}
            >
              TTM SDE
            </span>
            <span
              id={ttmSdeTooltipId}
              role="tooltip"
              className="db-tooltip-panel bv-driver-tooltip-panel"
            >
              {TTM_SDE_TOOLTIP}
            </span>
          </span>
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
            Phase 2 dropped the display clip; math and display now share the
            unclipped derived ± buffer range, so the row is a plain span. */}
        <div className="bv-footer-row">
          <span className="db-tooltip-wrap bv-footer-tooltip-wrap">
            <span
              className="bv-footer-label bv-footer-label--tooltip"
              tabIndex={0}
              aria-describedby={derivedMultipleTooltipId}
            >
              Derived Multiple
            </span>
            <span
              id={derivedMultipleTooltipId}
              role="tooltip"
              className="db-tooltip-panel bv-driver-tooltip-panel"
            >
              {DERIVED_MULTIPLE_TOOLTIP}
            </span>
          </span>
          <span className="bv-multiple-display">{multipleDisplay}</span>
        </div>

        {/* Buyer-Ready Value — relabeled from "Transferable Value". Single
            value (midpoint of TV range) per the range-display rule. */}
        <div className="bv-footer-row">
          <span className="db-tooltip-wrap bv-footer-tooltip-wrap">
            <span
              className="bv-footer-label bv-footer-label--tooltip"
              tabIndex={0}
              aria-describedby={buyerReadyTooltipId}
            >
              Buyer-Ready Value
            </span>
            <span
              id={buyerReadyTooltipId}
              role="tooltip"
              className="db-tooltip-panel bv-driver-tooltip-panel"
            >
              {BUYER_READY_TOOLTIP}
            </span>
          </span>
          <span
            className={
              result.transferableValue === null
                ? 'bv-footer-value bv-footer-value--muted'
                : 'bv-footer-value'
            }
          >
            {buyerReadyDisplay}
          </span>
        </div>
        {result.transferableValue === null && (
          <p className="bv-footer-note">
            {ownerIndependenceGrade === 'needs_input'
              ? 'Set Owner Independence to see Buyer-Ready Value.'
              : 'Set Replacement Cost to see Buyer-Ready Value.'}
          </p>
        )}

        {/* Owner Dependence Gap — relabeled from "Transferability Gap". The
            italic "smaller this gap…" teaching line moved into the tooltip. */}
        <div className="bv-footer-row">
          <span className="db-tooltip-wrap bv-footer-tooltip-wrap">
            <span
              className="bv-footer-label bv-footer-label--tooltip"
              tabIndex={0}
              aria-describedby={ownerDepGapTooltipId}
            >
              Owner Dependence Gap
            </span>
            <span
              id={ownerDepGapTooltipId}
              role="tooltip"
              className="db-tooltip-panel bv-driver-tooltip-panel"
            >
              {OWNER_DEPENDENCE_GAP_TOOLTIP}
            </span>
          </span>
          <span
            className={
              result.gap === null
                ? 'bv-footer-value bv-footer-value--muted'
                : 'bv-footer-value'
            }
          >
            {gapDisplay}
          </span>
        </div>

        {/* Replacement Cost — editor unchanged from V1 for Mixed/Weak/Needs
            input. When Owner Independence is Strong, the field shows $0
            (effective replacement cost; persisted preserved on the result
            for switch-back). The override note explains the $0 only when
            persisted differs (i.e. would have shown a non-zero value).
            When the $60K default applies (Mixed/Weak + blank), a different
            note fires — the two are mutually exclusive (Strong never sets
            defaultApplied=true). */}
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
        {result.replacementCostDefaultApplied ? (
          <p className="bv-footer-note">
            Defaulted to $60K estimated GM/lead coach replacement. Adjust to your local market.
          </p>
        ) : showStrongOverrideNote ? (
          <p className="bv-footer-note">
            Set to $0 — Owner Independence is Strong.
          </p>
        ) : null}
      </div>
    </div>
  );
}
