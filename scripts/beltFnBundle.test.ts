// Cross-runtime import boundary guard for the sync-belt-retention Edge Function.
//
// Slice 1 (src/lib/gym/beltRetentionAggregate.ts) is node-builtin-free by design so
// the Deno edge shell can import it across the runtime boundary (the #435 Option A
// import fix). This test proves that invariant CONTINUOUSLY under `npm test`: it
// runs the repeatable esbuild bundle proof and fails if the function's import graph
// pulls in anything a `--platform=neutral` bundle can't resolve (a stray `node:*`
// or bare-package import sneaking into the shared modules). Mirrors the guard
// intent of #435 — Slice 1's purity can't silently regress.
//
// It shells out to the SAME script wired as `npm run check:belt-fn-bundle`, so the
// CI script and this test can never diverge.
//
// This test lives under scripts/ (not src/) on purpose: it needs node builtins,
// and the SPA typecheck (`tsc -b`, which only includes src/) does not carry
// @types/node. Vitest's default include still discovers it, so `npm test` runs it.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const script = resolve(repoRoot, 'scripts/checkBeltFnBundle.mjs');

describe('sync-belt-retention cross-runtime bundle boundary', () => {
  it('bundles the function entry (importing beltRetentionAggregate.ts) with esbuild --platform=neutral and no externals', () => {
    // execFileSync throws on non-zero exit — a bundle failure fails the test with
    // the script's stderr attached.
    const out = execFileSync('node', [script], { cwd: repoRoot, encoding: 'utf8' });
    expect(out).toContain('OK: sync-belt-retention bundle resolved');
    expect(out).toContain('node-builtin-free');
  }, 30_000);
});
