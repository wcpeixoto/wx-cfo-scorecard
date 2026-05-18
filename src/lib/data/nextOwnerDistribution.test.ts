import { describe, it, expect } from 'vitest';
import type { ScenarioPoint } from './contract';
import {
  computeNextOwnerDistribution,
  MIN_DISTRIBUTION_THRESHOLD,
} from './nextOwnerDistribution';

// Helper: build a 15-point ScenarioPoint series from ending-cash balances.
// Only `month` and `endingCashBalance` matter to the helper; other fields
// are filled with zeros.
function series(endingCash: number[]): ScenarioPoint[] {
  return endingCash.map((bal, i) => {
    const monthNum = (i % 12) + 1;
    const year = 2026 + Math.floor(i / 12);
    return {
      month: `${year}-${String(monthNum).padStart(2, '0')}`,
      operatingCashIn: 0,
      operatingCashOut: 0,
      cashIn: 0,
      cashOut: 0,
      netCashFlow: 0,
      endingCashBalance: bal,
    };
  });
}

const RESERVE = 30_000;

describe('computeNextOwnerDistribution', () => {
  // 1. Forecast — first qualifying month at index 0.
  it('forecasts a distribution when the first month already qualifies', () => {
    // All 15 months comfortably above reserve + threshold.
    const result = computeNextOwnerDistribution(
      series(Array(15).fill(50_000)),
      RESERVE
    );
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    expect(result.monthLabel).toBe('Jan 2026');
    // window min = 50k, surplus = 20k
    expect(result.distributionAmount).toBe(20_000);
    expect(result.bars[0].isFirstPayout).toBe(true);
    expect(result.bars[0].distributionSegment).toBe(20_000);
  });

  // 2. Forecast — first qualifying month at index 6.
  it('forecasts the first qualifying month at index 6', () => {
    // Months 0..5: just below reserve (reserve shortfall would trigger if
    // blocked, but a later month qualifies so state is forecast). Use values
    // above reserve but with a dip inside every early safety window so no
    // early candidate qualifies, then a clear plateau from month 6.
    const cash = [
      31_000, 31_000, 31_000, 31_000, 31_000, 31_000, // 0..5: surplus 1k < 3k
      60_000, 60_000, 60_000, 60_000, 60_000, 60_000, // 6..11
      60_000, 60_000, 60_000, // 12..14 look-ahead
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    expect(result.monthLabel).toBe('Jul 2026'); // index 6
    expect(result.distributionAmount).toBe(30_000); // 60k - 30k
    expect(result.bars[6].isFirstPayout).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      expect(result.bars[i].distributionSegment).toBe(0);
      expect(result.bars[i].isFirstPayout).toBe(false);
    }
  });

  // 3. Forecast — multiple qualifying months; only first isFirstPayout: true.
  it('marks only the first qualifying month as first payout', () => {
    const result = computeNextOwnerDistribution(
      series(Array(15).fill(80_000)),
      RESERVE
    );
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    const firstPayoutCount = result.bars.filter((b) => b.isFirstPayout).length;
    expect(firstPayoutCount).toBe(1);
    expect(result.bars[0].isFirstPayout).toBe(true);
    // Later months qualify on their own merits but carry no distribution
    // segment (only the first payout month renders one).
    for (let i = 1; i < 12; i += 1) {
      expect(result.bars[i].distributionSegment).toBe(0);
    }
  });

  // 4. Blocked — reserve shortfall beats below-minimum when both apply.
  it('returns reserve_shortfall when reserve breach and below-min both apply', () => {
    // Month 5 dips below reserve (shortfall). Other months produce small
    // positive surpluses < threshold (below-minimum would otherwise apply).
    const cash = [
      31_000, 31_000, 31_000, 31_000, 31_000,
      20_000, // index 5 — below reserve floor
      31_000, 31_000, 31_000, 31_000, 31_000, 31_000,
      31_000, 31_000, 31_000,
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('blocked');
    if (result.state !== 'blocked') return;
    expect(result.blocker).toBe('reserve_shortfall');
    result.bars.forEach((b) => expect(b.distributionSegment).toBe(0));
  });

  // 5. Blocked — negative distributable cash when no positive surplus exists.
  it('returns negative_distributable_cash when nothing exceeds reserve', () => {
    // All months exactly at the reserve floor: never below (no shortfall),
    // but cash - reserve is never > 0 (no positive distributable cash).
    const result = computeNextOwnerDistribution(
      series(Array(15).fill(RESERVE)),
      RESERVE
    );
    expect(result.state).toBe('blocked');
    if (result.state !== 'blocked') return;
    expect(result.blocker).toBe('negative_distributable_cash');
  });

  // 6. Blocked — below minimum payout when safety-window surplus is $1,500.
  it('returns below_minimum_payout when surplus is $1,500', () => {
    const result = computeNextOwnerDistribution(
      series(Array(15).fill(RESERVE + 1_500)),
      RESERVE
    );
    expect(result.state).toBe('blocked');
    if (result.state !== 'blocked') return;
    expect(result.blocker).toBe('below_minimum_payout');
  });

  // 7. Edge — threshold boundary: surplus exactly $3,000 qualifies; $2,999 not.
  it('qualifies at exactly the threshold and not one dollar below', () => {
    const atThreshold = computeNextOwnerDistribution(
      series(Array(15).fill(RESERVE + MIN_DISTRIBUTION_THRESHOLD)),
      RESERVE
    );
    expect(atThreshold.state).toBe('forecast');

    const justBelow = computeNextOwnerDistribution(
      series(Array(15).fill(RESERVE + MIN_DISTRIBUTION_THRESHOLD - 1)),
      RESERVE
    );
    expect(justBelow.state).toBe('blocked');
    if (justBelow.state !== 'blocked') return;
    expect(justBelow.blocker).toBe('below_minimum_payout');
  });

  // 8. Edge — 4-month window at index 11 uses months 11..14 of the 15-input.
  it('uses months 11..14 for the candidate at index 11', () => {
    // Months 0..10 dip below reserve so no earlier candidate qualifies and
    // the index-11 window is the decisive one. Make 0..10 below reserve →
    // that would trigger reserve_shortfall if blocked, but index 11 qualifies
    // so state is forecast and the win comes from the 11..14 window.
    const cash = [
      // 0..10 produce sub-threshold surpluses (1k) so no early qualifier,
      // and stay above reserve so reserve_shortfall does not pre-empt.
      31_000, 31_000, 31_000, 31_000, 31_000, 31_000,
      31_000, 31_000, 31_000, 31_000, 31_000,
      // index 11 + look-ahead 12,13,14 — window min 45k → surplus 15k.
      45_000, 45_000, 45_000, 45_000,
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    expect(result.bars[11].isFirstPayout).toBe(true);
    expect(result.distributionAmount).toBe(15_000); // min(45k..) - 30k
    // Sanity: if month 14 were excluded the min would differ; force a dip at
    // 14 and confirm it changes the result.
    const cashDip = [...cash];
    cashDip[14] = 35_000; // window min becomes 35k → surplus 5k still qualifies
    const dipped = computeNextOwnerDistribution(series(cashDip), RESERVE);
    expect(dipped.state).toBe('forecast');
    if (dipped.state !== 'forecast') return;
    expect(dipped.distributionAmount).toBe(5_000);
  });

  // 9. Invariant — segments sum to endingCashBeforePayout for every bar.
  it('keeps reserve + safeCash + distribution == endingCashBeforePayout', () => {
    const cases: ScenarioPoint[][] = [
      series(Array(15).fill(80_000)), // forecast, qualifying at 0
      series(Array(15).fill(RESERVE + 1_500)), // blocked below-min
      series(Array(15).fill(RESERVE)), // blocked negative distributable
      series([
        31_000, 31_000, 31_000, 31_000, 31_000, 20_000,
        31_000, 31_000, 31_000, 31_000, 31_000, 31_000,
        31_000, 31_000, 31_000,
      ]), // blocked reserve shortfall
      series([
        31_000, 31_000, 31_000, 31_000, 31_000, 31_000,
        60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
        60_000, 60_000, 60_000,
      ]), // forecast at index 6
    ];
    for (const s of cases) {
      const result = computeNextOwnerDistribution(s, RESERVE);
      for (const bar of result.bars) {
        expect(
          bar.reserveSegment + bar.safeCashSegment + bar.distributionSegment
        ).toBe(bar.endingCashBeforePayout);
      }
    }
  });

  // 10. Helper throws when input series length < 15.
  it('throws when the input series has fewer than 15 points', () => {
    expect(() =>
      computeNextOwnerDistribution(series(Array(14).fill(50_000)), RESERVE)
    ).toThrow(/at least 15/);
    expect(() => computeNextOwnerDistribution([], RESERVE)).toThrow(
      /at least 15/
    );
  });
});
