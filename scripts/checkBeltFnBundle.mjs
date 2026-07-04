#!/usr/bin/env node
// Repeatable cross-runtime import boundary proof for the sync-belt-retention Edge
// Function (Slice 2 of the Churn-by-Belt importer), mirroring the #435 esbuild
// proof for sync-wodify-retention.
//
// The belt function imports the shared src/ modules
// (src/lib/gym/beltRetentionUpload.ts → src/lib/gym/beltRetentionAggregate.ts)
// across the SPA/Deno runtime boundary. Those modules are node-builtin-free by
// Slice 1's design, so a `--platform=neutral` bundle with NO externals must
// succeed. If a future edit sneaks a `node:*` import (or a bare-specifier package
// import) into that graph, this bundle fails — catching the regression BEFORE it
// reaches the eszip deploy bundler, which is far harder to debug.
//
// This is deliberately a standalone repeatable script (wired as
// `npm run check:belt-fn-bundle`) AND asserted by a vitest guard
// (beltRetentionUpload.bundle.test.ts) — not a one-off — so Slice 1's purity
// can't silently regress.
//
// Exit 0 = bundle succeeded (boundary intact). Non-zero = the import graph pulled
// in something the neutral bundle can't resolve.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const entry = resolve(repoRoot, 'supabase/functions/sync-belt-retention/index.ts');

try {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false, // in-memory — we only care that resolution + bundling succeed
    logLevel: 'silent',
  });
  const bytes = result.outputFiles?.[0]?.contents?.length ?? 0;
  console.log(`OK: sync-belt-retention bundle resolved (${bytes} bytes, node-builtin-free).`);
  process.exit(0);
} catch (err) {
  console.error('FAIL: sync-belt-retention cross-runtime bundle did not resolve.');
  console.error(err?.message ?? err);
  process.exit(1);
}
