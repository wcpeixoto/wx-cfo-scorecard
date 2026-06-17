// Cohort (age-band) edges + age derivation — the single source of truth for the
// Cohort Retention Card ("Retention by Age Group"), shared by the SPA card
// (churnRiskByCohort.ts) and the server-side aggregate (wodifyRetentionAggregate.ts
// → the sync-wodify-retention Edge Function).
//
// Mirrors tenureBands.ts: a dedicated module so the live histogram and the sample
// card can never disagree about where a cohort starts, and so the Edge Function's
// deploy/eszip graph gains age-band CONSTANTS + a pure age helper only — never the
// threshold-coupled classifiers (the §6.1 reuse boundary is unchanged).
//
// DELIBERATELY DEPENDENCY-LIGHT: the only import is the locked date parser
// parseYmdLocal from ./silentChurn (READ-ONLY, never forked — the same primitive
// the recency/tenure math uses), so age derivation shares one date definition. The
// explicit `.ts` extension is load-bearing for the Supabase Edge deploy (eszip
// resolution), exactly as in wodifyRetentionAggregate.ts.
import { parseYmdLocal } from './silentChurn.ts';

// Cohorts are LABELLED as age ranges and assigned from whole-year age as-of the
// snapshot day. Unlike tenure bands (open-ended, minDays only), each cohort has an
// INCLUSIVE [minAge, maxAge] window. Adults 16+ carries a data-sanity upper bound
// of 120 — an impossible-age ceiling, NOT a cohort cap: real members of any
// realistic age stay in Adults; only a sentinel/garbage DOB that derives an age
// above 120 routes to Unknown. Kids 3-6 starts at minAge 1 because §2 folds the
// few under-3s into the youngest displayed band; age 0 (and any age <= 0) is a
// sentinel/outlier routed to Unknown, never silently into Kids.
export type CohortBandDef = {
  id: string;
  label: string;
  minAge: number; // inclusive lower edge, whole years
  maxAge: number; // inclusive upper edge, whole years
};

// The list is non-overlapping and ascending; every derivable age in [1, 120] lands
// in exactly one cohort. Labels are presentation copy (en-dashes); ids are stable.
export const COHORT_BANDS: readonly CohortBandDef[] = [
  { id: 'kids3to6', label: 'Kids 3–6', minAge: 1, maxAge: 6 },
  { id: 'kids7to9', label: 'Kids 7–9', minAge: 7, maxAge: 9 },
  { id: 'teens10to15', label: 'Teens 10–15', minAge: 10, maxAge: 15 },
  { id: 'adults16plus', label: 'Adults 16+', minAge: 16, maxAge: 120 },
];

// Stable id for the synthetic "unknown cohort" bucket: members whose age can't be
// derived to a real cohort — a missing/sentinel/invalid DOB, or a derived age
// outside every band window (<= 0 or > 120, i.e. sentinel/garbage). Deliberately
// NOT a COHORT_BANDS entry, but always surfaced, never dropped (mirrors
// UNKNOWN_TENURE_ID).
export const UNKNOWN_COHORT_ID = 'unknownCohort';

// The cohort whose [minAge, maxAge] window contains `age`, or null when none does
// (age <= 0, age > 120, or a non-finite age) — the caller routes such a member
// into the "unknown cohort" bucket rather than forcing them into Kids or Adults.
export function cohortForAge(age: number): CohortBandDef | null {
  if (!Number.isFinite(age)) return null;
  for (const band of COHORT_BANDS) {
    if (age >= band.minAge && age <= band.maxAge) return band;
  }
  return null;
}

// Whole-year age as-of a reference day, from two 'YYYY-MM-DD' strings. Returns
// null when either is unparseable (the caller collapses the 1900-01-01 sentinel
// and non-dates to '' upstream via sliceUsableDate, so a '' dob arrives here and
// returns null → unknown cohort). Birthday-accurate: the year difference minus one
// when the reference day falls before the birthday that year — never days/365,
// which drifts around leap years and birthdays.
export function ageYearsAsOf(dobYmd: string, asOfYmd: string): number | null {
  const dob = parseYmdLocal(dobYmd);
  const asOf = parseYmdLocal(asOfYmd);
  if (dob === null || asOf === null) return null;
  let age = asOf.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < dob.getMonth() ||
    (asOf.getMonth() === dob.getMonth() && asOf.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
