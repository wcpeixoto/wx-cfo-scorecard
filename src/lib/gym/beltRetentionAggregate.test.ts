// Slice-1 EQUIVALENCE + COMPLETE-GRID tests for the belt-retention aggregation core.
//
// The parse/analyze/reshape logic was extracted VERBATIM out of scripts/wodify/beltProgressionJoinProbe.ts
// + scripts/wodify/buildMemberRetentionByBelt.ts into beltRetentionAggregate.ts so the CLI, the probe, and
// the future upload edge function share ONE module. These tests are the anti-drift guard the refactor rests
// on: (1) BYTE-IDENTICAL — the reshaped payload on the CLI's own selftest fixtures hashes to the exact
// golden sha256 the pre-extraction CLI produced; (2) COMPLETE GRID — every allowlisted (segment, band) is
// present for every emitted month (explicit zeros, never sparse), so the downstream never-delete upsert can
// never leave a stale band within a refreshed month. The card is #501-conservation-tied — zero drift allowed.

import { describe, it, expect } from 'vitest';

import {
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  buildBeltPayload,
  canonicalize,
  SCHEMA_SEGMENT_BAND_ALLOWLIST,
  type PayloadRow,
} from './beltRetentionAggregate';

// The EXACT fixtures buildMemberRetentionByBelt.ts --selftest runs — the golden sha below was produced by the
// pre-extraction CLI on these three sources. C1 Alice: Adults Blue, active 2025-06 & -07, Lost 2025-08.
// C2 Bob: Kids Grey/White, active 2025-06. C3 Carol: Adults Purple, Lost 2025-06. C4 Ghost: Lost 2025-07, no
// belt → UNKNOWN.
const RET = [
  'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
  '1,X,2025-05-01,C1,Alice,New,1,0,2000001',
  '2,X,2025-06-01,C1,Alice,Returning,1,0,2000001',
  '3,X,2025-07-01,C1,Alice,Lost,0,1,2000001',
  '4,X,2025-05-01,C2,Bob,Returning,1,0,2000002',
  '5,X,2025-05-01,C3,Carol,Lost,0,1,2000003',
  '6,X,2025-06-01,C4,GhostMember,Lost,0,1,2000004',
].join('\n');
const CUR = [
  'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
  'C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
  'C2,Bob,Kids BJJ,Grey/White Belt,"Feb 1, 2025",3,Yes',
  'C3,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No',
].join('\n');
const PREV = [
  'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
  'Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
].join('\n');

// The exact payload sha256 the CLI emitted BEFORE the extraction (captured from
// `buildMemberRetentionByBelt.ts --selftest`). If the extracted module drifts by a single count, this breaks.
const GOLDEN_SHA256 = '31c545fc80e612aeb65d268bc64e82403261a4e6eb0af8aa9d513f27e251b2ec';

// Web Crypto (the in-repo hashing pattern, cf. wodifyRetentionSync.ts) — no node:crypto, so this test file
// typechecks under the browser-lib app tsconfig.
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const payload = buildBeltPayload(analyze(parseRetention(RET), parseCurrent(CUR), parsePrevious(PREV)));
const find = (segment: string, belt_band: string, period_month: string): PayloadRow | undefined =>
  payload.rows.find((r) => r.segment === segment && r.belt_band === belt_band && r.period_month === period_month);

describe('beltRetentionAggregate — extraction equivalence', () => {
  it('produces a BYTE-IDENTICAL payload to the pre-extraction CLI (golden sha256)', async () => {
    expect(await sha256Hex(canonicalize(payload.rows))).toBe(GOLDEN_SHA256);
  });

  it('reshapes to the 104-row grid (7 bands×13 months + 13 unknown)', () => {
    expect(payload.rowCount).toBe(104);
    expect(payload.rows.length).toBe(104);
  });

  it('conservation ties for active AND lost, every month', () => {
    expect(payload.conservation.allActiveOk).toBe(true);
    expect(payload.conservation.allLostOk).toBe(true);
  });

  it('name bridge is collision-free on the fixtures', () => {
    expect(payload.nameBridge69.collisionFree).toBe(true);
  });

  it('pins the load-bearing cells (active + lost + unknown)', () => {
    expect(find('adults', 'Blue', '2025-06')?.active_count).toBe(1); // Alice
    expect(find('kids', 'Grey-family', '2025-06')?.active_count).toBe(1); // Bob
    expect(find('adults', 'White', '2025-06')?.active_count).toBe(0); // emitted zero, not absent
    expect(find('adults', 'Purple', '2025-06')?.lost_count).toBe(1); // Carol (FoM 2025-05→06)
    expect(find('adults', 'Blue', '2025-08')?.lost_count).toBe(1); // Alice (FoM 2025-07→08)
    expect(find('unknown', 'unknown', '2025-07')?.lost_count).toBe(1); // Ghost, no belt
  });
});

describe('beltRetentionAggregate — complete band×month grid', () => {
  it('emits every allowlisted (segment, band) for every emitted month, exactly once (never sparse)', () => {
    const expected = SCHEMA_SEGMENT_BAND_ALLOWLIST.flatMap(({ segment, bands }) =>
      bands.flatMap((band) => payload.months.map((m) => `${segment}|${band}|${m}`)),
    ).sort();
    const actual = payload.rows.map((r) => `${r.segment}|${r.belt_band}|${r.period_month}`).sort();
    // Set-size check catches duplicates; toEqual catches any missing/extra cell — together = a complete grid.
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toEqual(expected);
  });

  it('every emitted count is a real, non-negative integer (explicit zeros, no nulls)', () => {
    for (const r of payload.rows) {
      expect(Number.isInteger(r.active_count) && r.active_count >= 0).toBe(true);
      expect(Number.isInteger(r.lost_count) && r.lost_count >= 0).toBe(true);
    }
  });
});
