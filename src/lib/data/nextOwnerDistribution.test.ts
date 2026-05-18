import { describe, it, expect } from 'vitest';
import type { ScenarioPoint } from './contract';
import {
  computeNextOwnerDistribution,
  MIN_DISTRIBUTION_THRESHOLD,
} from './nextOwnerDistribution';

// Helper: build a ScenarioPoint series from ending-cash balances. The helper
// requires >= 9 points (6 display + 3 look-ahead); tests pass at least that
// many. Only `month` and `endingCashBalance` matter; other fields are zeros.
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

  // 2. Forecast — first qualifying month at index 3 (not index 0).
  it('forecasts the first qualifying month at index 3', () => {
    // Months 0..2 produce sub-threshold surpluses (1k < 3k) because each
    // early safety window still includes a low month, so no early candidate
    // qualifies; a clear plateau from index 3 makes index 3 the first payout.
    const cash = [
      31_000, 31_000, 31_000, // 0..2: surplus 1k < 3k
      60_000, 60_000, 60_000, // 3..5
      60_000, 60_000, 60_000, // 6..8 look-ahead (9-month minimum)
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    expect(result.monthLabel).toBe('Apr 2026'); // index 3
    expect(result.distributionAmount).toBe(30_000); // 60k - 30k
    expect(result.bars[3].isFirstPayout).toBe(true);
    for (let i = 0; i < 3; i += 1) {
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
    for (let i = 1; i < 6; i += 1) {
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

  // 8. Edge — 4-month window at index 5 uses months 5..8 of the 9-input.
  it('uses months 5..8 for the candidate at index 5', () => {
    // Months 0..4 produce sub-threshold surpluses (1k) so no earlier
    // candidate qualifies, and stay above reserve so reserve_shortfall does
    // not pre-empt; index 5 is the decisive last-display-month candidate and
    // its window is the last 4 months of the 9-month internal requirement.
    const cash = [
      31_000, 31_000, 31_000, 31_000, 31_000,
      // index 5 + look-ahead 6,7,8 — window min 45k → surplus 15k.
      45_000, 45_000, 45_000, 45_000,
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('forecast');
    if (result.state !== 'forecast') return;
    expect(result.bars[5].isFirstPayout).toBe(true);
    expect(result.distributionAmount).toBe(15_000); // min(45k..) - 30k
    // Sanity: if month 8 were excluded the min would differ; force a dip at
    // 8 and confirm it changes the result.
    const cashDip = [...cash];
    cashDip[8] = 35_000; // window min becomes 35k → surplus 5k still qualifies
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
        31_000, 31_000, 31_000,
        60_000, 60_000, 60_000,
        60_000, 60_000, 60_000,
      ]), // forecast — first qualifier at index 3
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

  // 10. Helper throws when input series length < 9; succeeds at exactly 9.
  it('throws below 9 points and succeeds at exactly 9', () => {
    expect(() =>
      computeNextOwnerDistribution(series(Array(8).fill(50_000)), RESERVE)
    ).toThrow(/at least 9/);
    expect(() => computeNextOwnerDistribution([], RESERVE)).toThrow(
      /at least 9/
    );
    // Exactly 9 points (6 display + 3 look-ahead) is the minimum valid input.
    const atMin = computeNextOwnerDistribution(
      series(Array(9).fill(50_000)),
      RESERVE
    );
    expect(atMin.state).toBe('forecast');
    expect(atMin.bars).toHaveLength(6);
  });

  // 11. Scan stops at the display window — a qualifying month past index 5
  //     (at index 6) must NOT rescue an otherwise-blocked forecast. Guards
  //     against the scan accidentally extending past the new 6-month window.
  it('returns blocked when the only qualifying month is past the display window', () => {
    // Months 0..5 produce sub-threshold surpluses (1k < 3k). A clear
    // qualifying plateau starts at index 6 — outside the 0..5 scan. The
    // helper still needs >= 9 points; provide 10 so index 6's data exists.
    const cash = [
      31_000, 31_000, 31_000, 31_000, 31_000, 31_000, // 0..5: surplus 1k
      80_000, 80_000, 80_000, 80_000, // 6..9: would qualify if scanned
    ];
    const result = computeNextOwnerDistribution(series(cash), RESERVE);
    expect(result.state).toBe('blocked');
    if (result.state !== 'blocked') return;
    // All 0..5 stay above the floor with positive-but-tiny distributable
    // cash → below_minimum_payout (not reserve_shortfall).
    expect(result.blocker).toBe('below_minimum_payout');
    expect(result.bars).toHaveLength(6);
  });
});
