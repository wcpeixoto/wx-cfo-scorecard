// Sample gym-member fixture for the Retention page.
//
// Deliberately SEPARATE from src/lib/data/contract.ts (which is financial-only
// and locked). No real member data exists yet — Wodify is parked — so this is a
// flagged SAMPLE standing in for a future Wodify member export. Every surface
// that renders it shows a visible "Sample data" badge. Names are fabricated.
//
// The fixture is anchored to a fixed "as-of" date (FIXTURE_TODAY) rather than
// the live clock so the Silent Churn demo is deterministic and reproducible:
// the at-risk set is a pure function of (rows, threshold) and never drifts with
// wall-clock time. Dates are constructed with new Date(y, m, d) per AGENTS.md
// (never new Date('YYYY-MM-DD'), which parses as UTC and shifts in US zones).

export type GymMemberStatus = 'active' | 'paused' | 'ended';

export type GymMember = {
  id: string;
  displayName: string; // anonymized
  status: GymMemberStatus;
  monthlyDues: number; // USD per month
  membershipStart: string; // YYYY-MM-DD
  lastCheckIn: string; // YYYY-MM-DD
};

// As-of reference date for the sample. June 2, 2026 (month index 5).
export const FIXTURE_TODAY = new Date(2026, 5, 2);

// ~30 members shaped like a plausible Wodify export. lastCheckIn values are
// clustered around the default 21-day Silent Churn threshold so that raising or
// lowering the setting visibly changes which active members are counted. Paused
// and ended members appear with long absences to confirm the status filter
// excludes them regardless of how long they've been away.
export const SAMPLE_GYM_MEMBERS: GymMember[] = [
  // ── Active, recently present (below any reasonable threshold) ───────────────
  { id: 'm001', displayName: 'Ava R.', status: 'active', monthlyDues: 179, membershipStart: '2023-02-14', lastCheckIn: '2026-06-02' },
  { id: 'm002', displayName: 'Liam K.', status: 'active', monthlyDues: 159, membershipStart: '2024-09-01', lastCheckIn: '2026-06-01' },
  { id: 'm003', displayName: 'Noah B.', status: 'active', monthlyDues: 179, membershipStart: '2022-11-20', lastCheckIn: '2026-05-31' },
  { id: 'm004', displayName: 'Mia S.', status: 'active', monthlyDues: 129, membershipStart: '2025-01-10', lastCheckIn: '2026-05-29' },
  { id: 'm005', displayName: 'Ethan T.', status: 'active', monthlyDues: 99, membershipStart: '2024-03-05', lastCheckIn: '2026-05-27' },
  { id: 'm006', displayName: 'Zoe L.', status: 'active', monthlyDues: 149, membershipStart: '2023-07-18', lastCheckIn: '2026-05-24' },

  // ── Active, near the boundary (counted only at lower thresholds) ────────────
  { id: 'm007', displayName: 'Owen M.', status: 'active', monthlyDues: 119, membershipStart: '2025-04-22', lastCheckIn: '2026-05-20' }, // 13d
  { id: 'm008', displayName: 'Ivy C.', status: 'active', monthlyDues: 179, membershipStart: '2022-05-30', lastCheckIn: '2026-05-18' }, // 15d
  { id: 'm009', displayName: 'Leo P.', status: 'active', monthlyDues: 159, membershipStart: '2024-12-12', lastCheckIn: '2026-05-15' }, // 18d
  { id: 'm010', displayName: 'Nora F.', status: 'active', monthlyDues: 129, membershipStart: '2023-10-03', lastCheckIn: '2026-05-13' }, // 20d

  // ── Active, at/over the default 21-day threshold (the Silent Churn set) ─────
  { id: 'm011', displayName: 'Hank D.', status: 'active', monthlyDues: 149, membershipStart: '2021-08-09', lastCheckIn: '2026-05-12' }, // 21d
  { id: 'm012', displayName: 'Ruby W.', status: 'active', monthlyDues: 99, membershipStart: '2025-02-27', lastCheckIn: '2026-05-09' }, // 24d
  { id: 'm013', displayName: 'Max H.', status: 'active', monthlyDues: 179, membershipStart: '2023-01-15', lastCheckIn: '2026-05-04' }, // 29d
  { id: 'm014', displayName: 'Elsa V.', status: 'active', monthlyDues: 129, membershipStart: '2024-06-11', lastCheckIn: '2026-04-26' }, // 37d
  { id: 'm015', displayName: 'Cole A.', status: 'active', monthlyDues: 159, membershipStart: '2022-09-23', lastCheckIn: '2026-04-12' }, // 51d
  { id: 'm016', displayName: 'Jade O.', status: 'active', monthlyDues: 179, membershipStart: '2023-03-30', lastCheckIn: '2026-03-15' }, // 79d

  // ── Active, healthy regulars (keep the active denominator realistic) ────────
  { id: 'm017', displayName: 'Finn G.', status: 'active', monthlyDues: 179, membershipStart: '2021-12-01', lastCheckIn: '2026-06-01' },
  { id: 'm018', displayName: 'Lily N.', status: 'active', monthlyDues: 119, membershipStart: '2025-05-19', lastCheckIn: '2026-05-30' },
  { id: 'm019', displayName: 'Sam E.', status: 'active', monthlyDues: 149, membershipStart: '2024-02-08', lastCheckIn: '2026-05-28' },
  { id: 'm020', displayName: 'Tess U.', status: 'active', monthlyDues: 129, membershipStart: '2023-11-14', lastCheckIn: '2026-05-26' },

  // ── Paused (frozen) — long absences, must NOT count as Silent Churn ─────────
  { id: 'm021', displayName: 'Gabe Y.', status: 'paused', monthlyDues: 0, membershipStart: '2022-04-04', lastCheckIn: '2026-03-01' },
  { id: 'm022', displayName: 'Remy Q.', status: 'paused', monthlyDues: 0, membershipStart: '2024-08-21', lastCheckIn: '2026-04-20' },
  { id: 'm023', displayName: 'Dana Z.', status: 'paused', monthlyDues: 0, membershipStart: '2023-06-17', lastCheckIn: '2026-02-12' },
  { id: 'm024', displayName: 'Kai J.', status: 'paused', monthlyDues: 0, membershipStart: '2025-03-29', lastCheckIn: '2026-05-01' },

  // ── Ended (cancelled) — already churned, excluded from the live signal ──────
  { id: 'm025', displayName: 'Pia X.', status: 'ended', monthlyDues: 0, membershipStart: '2021-05-10', lastCheckIn: '2026-02-10' },
  { id: 'm026', displayName: 'Theo I.', status: 'ended', monthlyDues: 0, membershipStart: '2022-10-25', lastCheckIn: '2026-01-15' },
  { id: 'm027', displayName: 'Wren B.', status: 'ended', monthlyDues: 0, membershipStart: '2023-09-08', lastCheckIn: '2025-12-20' },
  { id: 'm028', displayName: 'Ace M.', status: 'ended', monthlyDues: 0, membershipStart: '2024-01-31', lastCheckIn: '2026-03-22' },
  { id: 'm029', displayName: 'Beau R.', status: 'ended', monthlyDues: 0, membershipStart: '2022-07-12', lastCheckIn: '2025-11-30' },
  { id: 'm030', displayName: 'Cleo S.', status: 'ended', monthlyDues: 0, membershipStart: '2025-06-02', lastCheckIn: '2026-04-05' },
];
