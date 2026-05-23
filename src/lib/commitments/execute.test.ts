import { describe, it, expect } from 'vitest';
import { buildExecuteHelp, FALLBACK_OPPORTUNITY_TITLE } from './execute';
import type { DashboardModel, OpportunityItem } from '../data/contract';
import type { PriorityHistoryRow, SignalType } from '../priorities/types';

// buildExecuteHelp reads only model.opportunities and commitment.signal_type, so a
// partial fixture (house style: `as unknown as DashboardModel`) is honest here.
function model(opportunities: OpportunityItem[]): DashboardModel {
  return { opportunities } as unknown as DashboardModel;
}

function row(signal_type: SignalType = 'reserve_warning'): PriorityHistoryRow {
  return {
    workspace_id: 'default',
    fired_at: '2026-05-22T12:00:00.000Z',
    signal_type,
    severity: 'warning',
    status: 'open',
    committed_at: '2026-05-22T12:00:00.000Z',
    deadline_date: '2026-05-29T12:00:00.000Z',
  };
}

// compute.ts titles real overruns as `Control <category>`.
const opp = (title: string, savings: number): OpportunityItem => ({ title, savings, hint: '' });

describe('buildExecuteHelp — B-2 reserve_warning money-finding aid (Shape C)', () => {
  it('returns null when the commitment is not a reserve-funding signal (narrow path, lock #1)', () => {
    const m = model([opp('Control Marketing', 1200)]);
    expect(buildExecuteHelp(m, row('steady_state'))).toBeNull();
    expect(buildExecuteHelp(m, row('expense_surge'))).toBeNull();
    expect(buildExecuteHelp(m, row('cash_flow_negative'))).toBeNull();
  });

  it('reuses the reserve money-finding aid for reserve_critical', () => {
    const help = buildExecuteHelp(model([opp('Control Marketing', 1200)]), row('reserve_critical'));
    if (help?.kind !== 'levers') throw new Error('expected levers');
    expect(help.recommended.category).toBe('Marketing');
  });

  it('picks the top overrun as the recommended lever with up to 2 alternates', () => {
    const help = buildExecuteHelp(
      model([
        opp('Control Marketing', 1200),
        opp('Control Software', 400),
        opp('Control Travel', 250),
        opp('Control Meals', 100),
      ]),
      row()
    );
    if (help?.kind !== 'levers') throw new Error('expected levers');
    expect(help.recommended.category).toBe('Marketing');
    expect(help.recommended.overrun).toBe(1200);
    expect(help.recommended.text).toContain('Marketing');
    expect(help.recommended.text).toContain('$1,200');
    expect(help.alternates).toHaveLength(2); // capped at 2, drops the 4th
    expect(help.alternates.map((a) => a.category)).toEqual(['Software', 'Travel']);
  });

  it('breaks savings ties by category name ascending (stable render)', () => {
    const help = buildExecuteHelp(
      model([opp('Control Zebra', 300), opp('Control Apple', 300), opp('Control Mango', 300)]),
      row()
    );
    if (help?.kind !== 'levers') throw new Error('expected levers');
    expect(help.recommended.category).toBe('Apple');
    expect(help.alternates.map((a) => a.category)).toEqual(['Mango', 'Zebra']);
  });

  it('renders leaf labels for Parent:Subcategory categories when unambiguous', () => {
    const help = buildExecuteHelp(
      model([opp('Control Taxes and Licenses:State Tax', 1288), opp('Control Marketing:Ads', 822)]),
      row()
    );
    if (help?.kind !== 'levers') throw new Error('expected levers');
    expect(help.recommended.text).toBe('State Tax ran $1,288 above its recent average.');
    expect(help.alternates[0]?.text).toBe('Ads — $822 above average');
  });

  it('includes parent context when leaf labels collide across the shown set', () => {
    const help = buildExecuteHelp(
      model([opp('Control Marketing:Ads', 900), opp('Control Events:Ads', 400)]),
      row()
    );
    if (help?.kind !== 'levers') throw new Error('expected levers');
    expect(help.recommended.text).toBe('Marketing:Ads ran $900 above its recent average.');
    expect(help.alternates[0]?.text).toBe('Events:Ads — $400 above average');
  });

  it('returns the honest "none" message when only compute\'s generic fallback is present (#3)', () => {
    const help = buildExecuteHelp(model([opp(FALLBACK_OPPORTUNITY_TITLE, 320)]), row());
    if (help?.kind !== 'none') throw new Error('expected none');
    expect(help.text.length).toBeGreaterThan(0);
  });

  it('returns "none" when there are no opportunities at all', () => {
    expect(buildExecuteHelp(model([]), row())?.kind).toBe('none');
  });

  it('treats a near-miss title as a real lever, not the fallback (exact-match detection)', () => {
    // "spending" !== "spend": only compute's exact fallback string is the empty case.
    const help = buildExecuteHelp(model([opp('Tighten discretionary spending', 200)]), row());
    expect(help?.kind).toBe('levers');
  });

  it("pins the B-2 layer's fallback literal against accidental B-2-side edits", () => {
    // This does NOT exercise compute.ts. compute.ts is locked, so its upstream
    // fallback string can't drift without an explicit unlock; this only guards the
    // B-2 copy of the literal (used for fallback detection) against accidental edits
    // on the B-2 side.
    expect(FALLBACK_OPPORTUNITY_TITLE).toBe('Tighten discretionary spend');
  });
});
