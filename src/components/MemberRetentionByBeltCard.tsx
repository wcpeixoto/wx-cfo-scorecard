// Churn by Belt — Retention page, Patterns section (recessed full-width slot at the bottom). Reads the
// live `member_retention_by_belt` anon aggregate (Phase A data layer) and plots a trailing-3-month
// membership-churn rate per belt band, split by an Adults / Kids segment toggle. Falls back to a
// synthetic sample fixture (badged) until the table is reachable.
//
// AGGREGATE-ONLY: the fetch returns per-band COUNTS — no member names / IDs / DOBs ever reach the
// browser. This is Class-Plan MEMBERSHIP churn (the #495/#501 metric: of members active at the start of
// a month, who lapsed) partitioned by belt — NOT attendance-based Silent Churn.

import { useEffect, useId, useMemo, useState } from 'react';

import MemberRetentionByBeltChart from './MemberRetentionByBeltChart';
import {
  fetchMemberRetentionByBelt,
  type BeltRetentionRow,
} from '../lib/gym/fetchMemberRetentionByBelt';
import {
  buildBeltSegmentView,
  type BeltSegmentId,
} from '../lib/gym/memberRetentionByBeltSeries';
import { SAMPLE_BELT_ROWS } from '../lib/gym/memberRetentionByBeltFixture';

export function MemberRetentionByBeltCard() {
  const titleTooltipId = useId();
  const [liveRows, setLiveRows] = useState<BeltRetentionRow[] | null>(null);
  // Adults is the default segment (the larger, higher-belt-spread program).
  const [segment, setSegment] = useState<BeltSegmentId>('adults');

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchMemberRetentionByBelt(controller.signal)
      .then((rows) => {
        if (!cancelled && rows && rows.length > 0) setLiveRows(rows);
      })
      .catch(() => {
        // unconfigured / unreachable / not-yet-seeded → stay on the sample fixture.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // All-one-table: live when the fetch succeeded, else the sample fixture (no mixing — the toggle and
  // axis both come from whichever source is active).
  const rows = liveRows ?? SAMPLE_BELT_ROWS;
  const isLive = liveRows !== null;

  const view = useMemo(() => buildBeltSegmentView(rows, segment), [rows, segment]);

  return (
    <article className="card gym-card gym-card--full member-belt-card">
      <header className="gym-card-head retention-evolution-head">
        <div className="retention-evolution-heading">
          <div className="retention-evolution-titlerow">
            <h3 className="gym-card-title retention-evolution-title">
              Churn by Belt
              <span className="db-tooltip-wrap">
                <button
                  type="button"
                  className="db-tooltip-btn"
                  aria-label="Churn by Belt explanation"
                  aria-describedby={titleTooltipId}
                >
                  &#9432;
                </button>
                <div
                  id={titleTooltipId}
                  role="tooltip"
                  className="db-tooltip-panel is-left is-wide"
                >
                  <ul className="db-tooltip-list">
                    <li className="db-tooltip-body">
                      Monthly membership <strong>churn rate</strong> (lapsed ÷ active) for each belt band,
                      smoothed over a trailing 3-month window so a single small band's month-to-month
                      noise doesn't dominate.
                    </li>
                    <li className="db-tooltip-body">
                      This is membership churn from Wodify's retention report — a different metric from the
                      attendance-based Silent Churn and Attendance Health cards.
                    </li>
                  </ul>
                </div>
              </span>
            </h3>
            {!isLive && <span className="gym-sample-badge">Sample data</span>}
          </div>
          <p className="gym-card-subtitle">Trailing 3-month membership churn per belt band</p>
        </div>
        <div className="retention-evolution-controls">
          <div className="segmented-toggle" role="group" aria-label="Adults or kids">
            <button
              type="button"
              className={`segmented-toggle-btn${segment === 'adults' ? ' is-active' : ''}`}
              onClick={() => setSegment('adults')}
            >
              Adults
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn${segment === 'kids' ? ' is-active' : ''}`}
              onClick={() => setSegment('kids')}
            >
              Kids
            </button>
          </div>
        </div>
      </header>

      <div className="retention-evolution-body">
        {view.axisMonths.length === 0 ? (
          <p className="retention-evolution-empty">No belt retention history yet.</p>
        ) : (
          <>
            <MemberRetentionByBeltChart months={view.axisMonths} series={view.series} />
            <ul className="retention-evolution-footnote">
              <li>
                Each line is a trailing-3-month rate (Σ lapsed ÷ Σ active over the window); a band with no
                active members in the window shows a gap, never 0%.
              </li>
              <li>
                Members whose belt couldn&apos;t be determined are tracked separately and aren&apos;t shown
                here.
              </li>
            </ul>
          </>
        )}
      </div>
    </article>
  );
}
