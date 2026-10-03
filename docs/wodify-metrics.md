# Wodify monthly metrics — formulas

Table `public.wodify_monthly_metrics` (long format, one row per
`period_month` × `metric_key` × `dimension`). Written by the
`sync-wodify-metrics` Edge Function; the code is
`src/lib/gym/wodifyMonthlyMetrics.ts` and must match this page.
Work order: `docs/wo-wodify-monthly-sync.md`.

Read with SQL, e.g.:

```sql
select period_month, metric_key, dimension, value, source_as_of
from public.wodify_monthly_metrics
where period_month = '2026-09-01'
order by metric_key, dimension;
```

## Conventions

- **Month** = New York calendar month `[1st 00:00, next 1st 00:00)`, America/New_York.
  - Fields stored as **UTC instants** (`created_on_datetime`, `status_change_datetime`)
    are converted to New York time before bucketing (Sep 2026 starts at
    `2026-09-01T04:00:00Z`; Dec 2026 at `2026-12-01T05:00:00Z`).
  - Fields that are **already local** (`local_class_start_datetime`) or **date-only**
    (`payment_due`, membership `start_date` / `end_date`) are bucketed by their
    calendar date. Converting those would shift them 4–5 hours.
- **Range:** 2025-05 onward. Wodify activity starts in May 2025 (leads, sign-ins and
  conversions are ~0 before); earlier months are out of range. May 2025 is the go-live
  month — memberships that existed before go-live first appear then, so May–Jun 2025
  first-ever counts (`new_students`) are inflated by migration, not real growth.
- **`dimension`** = `all`, or `<family>:<catalog value>` (e.g. `source:API`,
  `status:No Show`, `program:Kids BJJ`). Blank catalog values become `(blank)`.
  A metric's `all` row is written even when it is 0; dimension rows only when non-zero.
- **`as_of`** = when the run that wrote the row finished. **`source_as_of`** = the v3
  census snapshot date, only on rows derived from it.
- **Counts only.** No name, email, phone or any Wodify id is stored; person-level data
  exists only in memory inside one function request.
- **Class Plan** = membership with `membership_type = 'Class Plan'` and
  `is_deleted ≠ true`. Each billing period is its own row; a renewal starts on its
  predecessor's `end_date` and points at it via `renewed_from_membership_id`
  (empty = `0`). A row covers `start_date ≤ day < end_date`.

## Trial funnel

| Key | Formula | Dimensions |
|---|---|---|
| `leads_created` | Leads whose `created.created_on_datetime` falls in the month. | `source:<created_from_source>`; `tag_group:` `META ADS` if a tag equals "META ADS", else `Organic` if a tag starts with "Organic", else `other` |
| `trial_bookings` | Lead class reservations (`/classes/reservations/leads/search`) whose `local_class_start_datetime` falls in the month, any status. | `status:<reservation_status>` |
| `trial_unique_leads_booked` | Distinct `lead_id` among those reservations (any status). | — |
| `trial_unique_leads_showed` | Distinct `lead_id` among lead class sign-ins (`/classes/sign-ins/leads/search`) in the month. | — |

## Conversions

**Conversion** = a client with `is_converted_from_lead = true`; its **conversion date**
is the New York date of the client record's creation (`created_on.created_on_datetime`).
Lead `status_history` cannot be used: Wodify never records the Converted step there
(Phase A, 0 of 68 converted leads). The client detail's `lead_id` links back to the lead.

**Enrolled** = the converted client's first Class Plan starts on or after the conversion
date and at most 30 days after it. (Phase A data: 232 same day, 25 within 30 days,
4 later, 152 never — mostly parents who converted with their kids.)

| Key | Formula |
|---|---|
| `leads_converted_raw` | Conversions dated in the month (context; includes parents who never enroll). |
| `leads_enrolled` | Conversions dated in the month that are enrolled. |
| `cohort_leads_enrolled` | Leads created in the month whose converted client is enrolled (as of the run). |
| `cohort_conversion_rate` | `cohort_leads_enrolled ÷ leads_created(all)`, 4 decimals; absent when no leads were created. Rises as late conversions arrive. |
| `lead_to_enroll_days_median` | Median days from the lead's creation date to the conversion date, over `leads_enrolled` conversions in the month that have a linked lead. Absent when none. |

A conversion is final 30 days after it happens, so the **close** run (1st of the month)
recomputes the two previous months.

## Students (from the v3 census)

Source: `public.wodify_retention_aggregate`, written weekly by `sync-wodify-retention`
(census "WO-2 v3"). Per month, the **last row whose `as_of` falls in the month and that
passes every v3 contract gate** (`studentRetentionFromRow`) is used; its date is stored in
`source_as_of`. v3 rows exist from 2026-09-09, so **months before 2026-09 have no
student-census rows** (not zero — absent). A weekly run on a Monday before that day's
census lands uses the previous week's row; the close run then uses the month's last row.

| Key | Formula | Dimensions |
|---|---|---|
| `active_students` | v3 `student_total`: Active clients with role Member or Dependent, or Guardian / no-group with ≥1 sign-in (guardian-only parents excluded). | `age:kids` (ages 1–15: kids3to6 + kids7to9 + teens10to15), `age:adults` (16+), `age:unknown` |
| `silent_students` | Students whose days since last check-in ≥ the Silent Churn threshold, using the locked `src/lib/gym/silentChurn.ts` rule (`daysAbsent >= threshold`) with its default threshold (21 days); unknown-recency students excluded. | — |
| `students_unknown_recency` | Students with no usable last check-in date (context for `silent_students`). | — |
| `visits_per_active_student` | `signins_total(all) ÷ active_students(all)`, 2 decimals; only where both exist. | — |

**Reconciliation with the Sep 2026 export (`scorecard_snapshots.payload.attendance_snapshot`,
as_of 2026-09-28):** the export's high-risk 66 is computed over **all 402 active clients**;
`silent_students` is computed over the **265 students**: 65 (+11 unknown). The gap of 1 is
one guardian-only client with a known last check-in ≥ 21 days ago. Full split — export:
healthy 144 / watch 46 / silent 66 / unknown 146; students: 144 / 45 / 65 / 11; the
difference (0 / 1 / 1 / 135 = 137) is exactly the guardian-only clients.

## Memberships

| Key | Formula | Dimensions |
|---|---|---|
| `new_students` | Clients whose **first-ever Class Plan** (earliest `start_date`, then id) starts in the month. | `program:<client default_program>` (Wodify's signup default — mostly "Adults Intro Classes", weak); `template:<first plan's membership name>` |
| `rejoins` | Class Plan rows that start a new chain (`renewed_from_membership_id` empty) in the month for a client who had an earlier Class Plan, with a **gap**: no earlier Class Plan of theirs still covers the start day. | — |
| `plan_switches` | Same, but an earlier Class Plan still covers the start day (overlap, or starts exactly on its `end_date`). Context: neither new nor rejoin. | — |
| `plan_mix` | Class Plan rows active on the month's last day (today for the current month). | `template:<membership name>` |
| `avg_monthly_price` | Mean normalized monthly price over those rows that have a price. Price comes from the chain's first row: within the initial commitment the initial payment option applies, after it the renewal option. `Monthly` → cost; `Pay in Full` → cost ÷ commitment months; `Weekly`, unknown types and $0 → unpriced (still counted in `plan_mix`). | `template:<membership name>` |

Phase A showed `renewed_from_membership_id` is **not** empty only on a first membership
(200 of 599 clients start more than one chain), so first-ever is computed from dates, not
from that field.

## Cancellations

| Key | Formula |
|---|---|
| `cancellations` | Clients with a `status_history` change `Active → Inactive` dated in the month (New York), counted once per client per month, who are **students** under the v3 rule (`classifyActiveClientDetail` on the client detail at run time). |
| `cancellations_all_clients` | Same without the student filter (context; includes guardian-only parents). |

Scanned: every client not Active today, plus Active clients who started a rejoin chain
since the run's first month (cancelled-then-returned). Clients whose classification is
`unclassified` count only in `cancellations_all_clients`. Classification uses the client's
current role and sign-in count, not the values at cancellation time.

**No reason dimension.** `member_deactivation_reason` is blank on every cancelled client
in Wodify (Phase A: 60 of 60 in Aug–Sep 2026) — a data-entry gap at the gym, so the
dimension is dropped. `scheduled_deactivation_date` is also unused.

## Attendance

| Key | Formula | Dimensions |
|---|---|---|
| `signins_total` | Client class sign-ins (`/classes/sign-ins/clients/search`) whose `local_class_start_datetime` falls in the month. | `program:<program>` |
| `signins_unique_clients` | Distinct `client_id` among those sign-ins. | `program:<program>` |
| `class_slot_avg_attendance` | Per recurring slot (class name + weekday + local start time, e.g. `slot:Kids BJJ · Mon 17:00`): sign-ins ÷ distinct `class_id`, 2 decimals. | `slot:` (one row per slot) |

## Billing

Invoices whose `payment_due` date falls in the month (`/financials/invoices/search`), with
lines from `/financials/invoices/{id}`. Money metrics (all but the two `invoices_due_*`)
exclude `Voided` and `Deleted` invoices. Amounts in dollars, 2 decimals.

| Key | Formula | Dimensions |
|---|---|---|
| `invoices_due_count` | Count of invoices due in the month. | `status:<invoice_header_status>` |
| `invoices_due_amount` | Σ `final_charge`. | `status:<invoice_header_status>` |
| `billed_paid` | Σ `paid_amount`. | — |
| `billed_unpaid` | Σ `unpaid_amount` (as of the run). | — |
| `autopay_failed` | Invoices with `is_auto_bill = true`, `unpaid_amount > 0` and `payment_due` before today (an attempt has happened). | — |
| `refunds` | Σ \|`final_refunded_amount`\| — Wodify stores refunds as negative amounts; stored as positive dollars refunded, attributed to the invoice's due month. | — |
| `revenue_by_category` | Σ line `post_header_net_revenue` (net of line and header discounts, before tax and before refunds — refunds are the separate `refunds` metric). | `category:<revenue_category>` |

## Deferred / not stored

- `holds_active` / `holds_started` — deferred (owner decision 2026-10-02). Holds are only
  readable one membership at a time (`/memberships/{id}` → `membership_holds`); no search
  endpoint exists (~376 extra calls a month).

## Runs

`public.wodify_metrics_runs` holds one row per run (kind, months, status, Wodify calls,
429 count, function links, per-task call counts, fixed-code error, count diagnostics).
`weekly` = previous + current month (Mondays 15:00 UTC); `close` = the two months before
the current one (1st, 11:00 UTC); `backfill` = 2025-05 → current; `manual` = explicit
months. Start one from SQL: `select public.wodify_metrics_start('manual', '{2026-09}');`
