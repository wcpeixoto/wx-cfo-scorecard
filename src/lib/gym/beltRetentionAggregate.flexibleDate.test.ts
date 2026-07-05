// Slice-5 tests for the format-agnostic belt date parser.
//
// Both belt date fields (retention "First Of Month" and Progressions "Date Achieved")
// now route through ONE `parseFlexibleMonth`, so a single Wodify "Keep the data
// formatted" export setting works for all three files (target: leave it UNCHECKED for
// all three → everything ISO). These tests prove (1) the parser accepts BOTH the ISO
// and month-name forms and rejects ambiguous/numeric-slash input, and (2) the whole
// pipeline is format-agnostic: the REVERSE orientation (MMM-D-YYYY retention + ISO
// belt) aggregates to the exact SAME grid the canonical orientation produces.

import { describe, it, expect } from 'vitest';

import {
  parseFlexibleMonth,
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  buildBeltPayload,
  canonicalize,
} from './beltRetentionAggregate';

// ─── parseFlexibleMonth — unit ───────────────────────────────────────────────
describe('parseFlexibleMonth', () => {
  it.each([
    ['2025-06-01', '2025-06'], // ISO with day
    ['2025-06', '2025-06'], // ISO year-month
    ['2025-06-01T00:00:00Z', '2025-06'], // ISO with time suffix
    ['Jun 25, 2025', '2025-06'], // MMM D, YYYY
    ['June 25, 2025', '2025-06'], // Month D, YYYY
    ['Jul 2, 2026', '2026-07'], // single-digit day
  ])('parses %s → %s', (input, expected) => {
    expect(parseFlexibleMonth(input)).toBe(expected);
  });

  it.each([
    ['6/1/2025'], // numeric slash — ambiguous day/month order, REJECT
    ['06.01.2025'], // numeric dot — REJECT
    [''], // empty
    ['n/a'], // garbage
    ['Juneteenth'], // month-name prefix but no day/year
    ['2025-13'], // month out of range
  ])('rejects %s → null', (input) => {
    expect(parseFlexibleMonth(input)).toBeNull();
  });
});

// ─── Format-agnostic aggregation (the key proof) ─────────────────────────────
// The canonical orientation = today's requirement: ISO retention First Of Month +
// MMM-D-YYYY belt Date Achieved. The reverse orientation swaps BOTH: MMM-D-YYYY
// retention (quoted — internal comma exercises the quote-aware CSV parse) + ISO belt.
// Same clients, same belts, same months — only the raw date FORMAT differs.

const RET_ISO = [
  'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
  '1,X,2025-05-01,C1,Alice,New,1,0,2000001',
  '2,X,2025-06-01,C1,Alice,Returning,1,0,2000001',
  '3,X,2025-07-01,C1,Alice,Lost,0,1,2000001',
  '4,X,2025-05-01,C2,Bob,Returning,1,0,2000002',
  '5,X,2025-05-01,C3,Carol,Lost,0,1,2000003',
  '6,X,2025-06-01,C4,GhostMember,Lost,0,1,2000004',
].join('\n');
const CUR_MMM = [
  'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
  'C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
  'C2,Bob,Kids BJJ,Grey/White Belt,"Feb 1, 2025",3,Yes',
  'C3,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No',
].join('\n');
const PREV_MMM = [
  'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
  'Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
].join('\n');

// REVERSE: retention dates as MMM D, YYYY (quoted — internal comma); belt dates as ISO.
const RET_MMM = [
  'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
  '1,X,"May 1, 2025",C1,Alice,New,1,0,2000001',
  '2,X,"Jun 1, 2025",C1,Alice,Returning,1,0,2000001',
  '3,X,"Jul 1, 2025",C1,Alice,Lost,0,1,2000001',
  '4,X,"May 1, 2025",C2,Bob,Returning,1,0,2000002',
  '5,X,"May 1, 2025",C3,Carol,Lost,0,1,2000003',
  '6,X,"Jun 1, 2025",C4,GhostMember,Lost,0,1,2000004',
].join('\n');
const CUR_ISO = [
  'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
  'C1,Alice,Adults BJJ,Blue Belt,2025-03-01,10,Yes',
  'C2,Bob,Kids BJJ,Grey/White Belt,2025-02-01,3,Yes',
  'C3,Carol,Adults BJJ,Purple Belt,2024-06-01,20,No',
].join('\n');
const PREV_ISO = [
  'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
  'Alice,Adults BJJ,White Belt,2024-01-01,"Mar 1, 2025",425,Yes',
].join('\n');

const canonical = canonicalize(
  buildBeltPayload(analyze(parseRetention(RET_ISO), parseCurrent(CUR_MMM), parsePrevious(PREV_MMM))).rows,
);
const reverse = canonicalize(
  buildBeltPayload(analyze(parseRetention(RET_MMM), parseCurrent(CUR_ISO), parsePrevious(PREV_ISO))).rows,
);

describe('beltRetentionAggregate — format-agnostic aggregation', () => {
  it('reverse orientation (MMM retention + ISO belt) yields the IDENTICAL grid to the canonical orientation', () => {
    expect(reverse).toBe(canonical);
  });

  it('both orientations conserve for active AND lost, every month', () => {
    for (const src of [
      buildBeltPayload(analyze(parseRetention(RET_ISO), parseCurrent(CUR_MMM), parsePrevious(PREV_MMM))),
      buildBeltPayload(analyze(parseRetention(RET_MMM), parseCurrent(CUR_ISO), parsePrevious(PREV_ISO))),
    ]) {
      expect(src.conservation.allActiveOk).toBe(true);
      expect(src.conservation.allLostOk).toBe(true);
      expect(src.nameBridge69.collisionFree).toBe(true);
    }
  });
});
