// Student movement — new / returned / cancelled students for the REPORTING month (the previous New York
// calendar month) and an estimated churn rate, from Wodify's automatic monthly metrics. Retention page,
// full-width card above the Attendance Health / Membership continuity row.
//
// PROVISIONAL while the numbers are compared with ADHARPY through the November close.
//
// All month / gate / base / churn logic lives in lib/gym/studentMovement.ts (pure, unit-tested); this file
// only lays it out. StudentMovementCardView is presentational (props in, markup out) so the gate copy can be
// asserted by rendering it; StudentMovementCard is the thin shell that fetches and supplies "now".
//
// The reporting month is ALWAYS shown. When it isn't refreshed yet the card says so and shows nothing in its
// place — an older month is never promoted into the headline. Older refreshed months only appear in the
// "Earlier months" table, each on its own labelled row.

import { useEffect, useId, useState } from 'react';

import { fetchStudentMovementRows } from '../lib/gym/fetchStudentMovementRows';
import {
  baseLine,
  buildStudentMovement,
  formatCount,
  formatEstimatedChurn,
  monthLabelLong,
  reportingMonthAt,
  unavailableMessage,
  type StudentMovementMonth,
  type StudentMovementView,
} from '../lib/gym/studentMovement';

// Earlier months shown beneath the headline. The export carries the full 13-month window.
const EARLIER_MONTHS_SHOWN = 6;

export type StudentMovementCardState =
  | { kind: 'loading'; reportingMonth: string }
  | { kind: 'error'; reportingMonth: string }
  | { kind: 'ready'; view: StudentMovementView };

function Tile({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="student-movement-tile">
      <span className="student-movement-tile-label">{label}</span>
      <span className="student-movement-tile-value">{value}</span>
      {context ? <span className="student-movement-tile-context">{context}</span> : null}
    </div>
  );
}

function EarlierMonths({ months }: { months: StudentMovementMonth[] }) {
  return (
    <section className="student-movement-earlier" aria-label="Earlier months">
      <h4 className="student-movement-earlier-title">Earlier months</h4>
      <div className="student-movement-table-scroll">
        <table className="student-movement-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">New students</th>
              <th scope="col">Returned</th>
              <th scope="col">Cancelled</th>
              <th scope="col">Estimated churn</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthLabelLong(m.month)}</th>
                <td>{formatCount(m.newStudents)}</td>
                <td>{formatCount(m.rejoins)}</td>
                <td>{formatCount(m.cancellations)}</td>
                <td>{formatEstimatedChurn(m.estimatedChurn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="student-movement-earlier-note">
        A dash means there is no student count for the month before, so churn can&rsquo;t be estimated.
      </p>
    </section>
  );
}

export function StudentMovementCardView({ state }: { state: StudentMovementCardState }) {
  const tooltipId = useId();
  const reportingMonth = state.kind === 'ready' ? state.view.reportingMonth : state.reportingMonth;
  const view = state.kind === 'ready' ? state.view : null;
  const current = view?.current ?? null;
  // Newest first, reporting month excluded (it has the headline above), capped.
  const earlier = (view?.months ?? [])
    .filter((m) => m.month !== reportingMonth)
    .slice()
    .reverse()
    .slice(0, EARLIER_MONTHS_SHOWN);
  const base = current ? baseLine(current) : null;

  return (
    <article className="card gym-card gym-card--full student-movement-card">
      <header className="gym-card-head student-movement-head">
        <div className="student-movement-heading">
          <h3 className="gym-card-title student-movement-title">
            Student movement
            <span className="db-tooltip-wrap">
              <button
                type="button"
                className="db-tooltip-btn"
                aria-label="Student movement explanation"
                aria-describedby={tooltipId}
              >
                &#9432;
              </button>
              <div id={tooltipId} role="tooltip" className="db-tooltip-panel is-left is-wide">
                <ul className="db-tooltip-list">
                  <li className="db-tooltip-body">
                    <strong>New students</strong> started their first class plan that month.{' '}
                    <strong>Returned</strong> came back after a gap. <strong>Cancelled</strong> students
                    whose membership went inactive; parents who only hold a guardian account aren&rsquo;t
                    counted.
                  </li>
                  <li className="db-tooltip-body">
                    <strong>Estimated churn</strong> = cancelled students &divide; students counted at the
                    end of the month before (the base).
                  </li>
                  <li className="db-tooltip-body">
                    From Wodify&rsquo;s automatic monthly counts. Different from Membership continuity,
                    which follows paying memberships in a smaller group.
                  </li>
                </ul>
              </div>
            </span>
          </h3>
          <p className="gym-card-subtitle">{monthLabelLong(reportingMonth)}</p>
        </div>
        <span className="card-status-badge is-neutral">Provisional</span>
      </header>

      {state.kind === 'loading' ? (
        <p className="student-movement-message">Loading student movement…</p>
      ) : state.kind === 'error' ? (
        <p className="student-movement-message">Student movement couldn&rsquo;t be loaded right now.</p>
      ) : current && base ? (
        <div className="student-movement-tiles">
          <Tile label="New students" value={formatCount(current.newStudents)} />
          <Tile label="Returned" value={formatCount(current.rejoins)} />
          <Tile label="Cancelled" value={formatCount(current.cancellations)} />
          <Tile
            label="Estimated churn"
            value={formatEstimatedChurn(current.estimatedChurn)}
            context={base.text}
          />
        </div>
      ) : (
        <p className="student-movement-message">{unavailableMessage(reportingMonth)}</p>
      )}

      {earlier.length > 0 ? <EarlierMonths months={earlier} /> : null}

      <p className="student-movement-footnote">
        Provisional: we&rsquo;re comparing these numbers with ADHARPY through the November close.
      </p>
    </article>
  );
}

export function StudentMovementCard() {
  const [now] = useState(() => new Date().toISOString());
  const [state, setState] = useState<StudentMovementCardState>(() => ({
    kind: 'loading',
    reportingMonth: reportingMonthAt(now),
  }));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const reportingMonth = reportingMonthAt(now);
    fetchStudentMovementRows(controller.signal)
      .then((rows) => {
        if (cancelled) return;
        setState(
          rows === null
            ? { kind: 'error', reportingMonth }
            : { kind: 'ready', view: buildStudentMovement(rows, now) },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error', reportingMonth });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [now]);

  return <StudentMovementCardView state={state} />;
}
