// Automatic scorecard-snapshot persistence — the post-render trigger.
//
// WHY AN EFFECT AND NOT A CALL INSIDE THE IMPORT HANDLER: an import handler that awaits
// loadImportedState() and then persists would serialize the `model` captured in ITS closure —
// the pre-import one, stale by exactly one import. Instead each completion point bumps a
// generation TOKEN in state; this effect reacts to the token, so it runs only after React has
// committed the new dataset and the useMemo chain (model -> projection -> levers) has recomputed.
//
// WHY A QUEUE: two generations must never write concurrently, or an older boot payload could land
// after a newer import payload and overwrite it. SnapshotGenerationQueue serializes them, keeps
// only the newest waiting generation, re-checks readiness before draining a waiting one (so Clear
// Data behind a slow boot write can't feed cleared inputs into a queued write), and ignores a
// token already in flight / completed / waiting — which turns React Strict Mode's double-invoke
// into one logical write and makes ordinary rerenders no-ops.
//
// ONE CONSISTENT CAPTURE: `{ sources, importId }` are read TOGETHER, synchronously, the moment a
// generation starts — before the retention fetches — so the payload and the import id it is
// labelled with describe the same import. Readiness is re-read right before the write.
//
// FIRE-AND-FORGET: persistence must never block rendering. Nothing here is awaited by a caller,
// the runner catches everything, the queue catches the runner, and results are only logged.

import { useEffect, useRef } from 'react';

import {
  collectMonthlySourceExportPayload,
  type MonthlySourceExportSources,
} from '../lib/export/collectMonthlySourceExport';
import {
  SnapshotGenerationQueue,
  isSnapshotBarrierSatisfied,
  persistScorecardSnapshot,
  runSnapshotGeneration,
  type SnapshotReadiness,
} from '../lib/data/scorecardSnapshot';

export function useScorecardSnapshotPersistence(params: {
  readiness: SnapshotReadiness;
  // Bumped once when the barrier is first satisfied, and once per successful source import.
  // Clear Data is deliberately NOT a trigger — see scorecardSnapshot.ts SnapshotTriggerSource.
  token: string | null;
  // Newest financial import id. Retention and belt imports carry the financial id forward
  // unchanged, which is why this is read from the loaded import summary rather than passed per
  // trigger.
  importId: string | null;
  sources: MonthlySourceExportSources;
}): void {
  const { readiness, token, importId, sources } = params;
  const barrierSatisfied = isSnapshotBarrierSatisfied(readiness);

  // Refreshed on every commit; declared FIRST so it runs before the gated effect below (effects
  // fire in declaration order). Generations read it when they start and again before writing.
  const latestRef = useRef({ sources, importId, barrierSatisfied });
  useEffect(() => {
    latestRef.current = { sources, importId, barrierSatisfied };
  });

  const queueRef = useRef<SnapshotGenerationQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = new SnapshotGenerationQueue(
      async () => {
        // Captured together, synchronously, before any await.
        const capture = {
          sources: latestRef.current.sources,
          importId: latestRef.current.importId,
        };
        try {
          const result = await runSnapshotGeneration(capture, {
            collect: collectMonthlySourceExportPayload,
            persist: persistScorecardSnapshot,
            isStillReady: () => latestRef.current.barrierSatisfied,
          });
          if (result.status === 'failed') {
            console.error('[scorecard-snapshot] persist failed:', result.reason);
          }
          // 'written' and every 'skipped' reason are settled outcomes; the queue marks the token done.
        } catch (error) {
          console.warn('[scorecard-snapshot] persist threw, dashboard unaffected:', error);
        }
      },
      () => latestRef.current.barrierSatisfied,
    );
  }

  useEffect(() => {
    if (!token) return;
    queueRef.current?.request(token, barrierSatisfied);
    // Intentionally depends ONLY on the gate inputs. `sources`/`importId` change identity on every
    // render and are read from latestRef instead, so rerenders cannot trigger a write.
  }, [barrierSatisfied, token]);
}
