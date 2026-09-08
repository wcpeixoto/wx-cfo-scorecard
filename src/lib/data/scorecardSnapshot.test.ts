import { describe, expect, it, vi } from 'vitest';

import {
  SnapshotGenerationQueue,
  canonicalPayloadJson,
  computeSourceHash,
  forecastBootstrapFailed,
  isSnapshotBarrierSatisfied,
  persistScorecardSnapshot,
  runSnapshotGeneration,
  shouldPersistSnapshot,
  type SnapshotReadiness,
} from './scorecardSnapshot';

const CONFIG = {
  supabaseUrl: 'https://example.supabase.co',
  anonKey: 'anon-test-key',
  workspaceId: 'default',
  now: () => new Date('2026-09-08T12:00:00.000Z'),
};

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '0.1',
    generated_at: '2026-09-08T12:00:00.000Z',
    business: 'Gracie Sports',
    scorecard_month: '2026-07',
    planning_month: '2026-08',
    usable_for_attack_plan: true,
    financial_monthly: [{ month: '2026-07', revenue: 16200, expenses: 7220 }],
    kpi_cards: [{ id: 'income', value: 16200 }],
    missing_or_unavailable: [],
    ...over,
  };
}

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
}

const READY: SnapshotReadiness = {
  importedDataLoaded: true,
  accountSettingsLoaded: true,
  workspaceSettingsSettled: true,
  forecastSettled: true,
  financialUsable: true,
};

describe('canonical hashing', () => {
  it('1. changing ONLY generated_at leaves the hash unchanged', async () => {
    const a = await computeSourceHash(payload());
    const b = await computeSourceHash(payload({ generated_at: '2027-01-01T00:00:00.000Z' }));
    expect(b).toBe(a);
  });

  it('2. changing any substantive field changes the hash', async () => {
    const base = await computeSourceHash(payload());
    const cases: Record<string, unknown>[] = [
      { scorecard_month: '2026-06' },
      { schema_version: '0.2' },
      { usable_for_attack_plan: false },
      { financial_monthly: [{ month: '2026-07', revenue: 16201, expenses: 7220 }] },
      { kpi_cards: [{ id: 'income', value: 16199 }] },
      { missing_or_unavailable: ['forecast:not_available'] },
    ];
    for (const over of cases) {
      expect(await computeSourceHash(payload(over))).not.toBe(base);
    }
  });

  it('3. object key order does not affect the hash; array order does', async () => {
    const forward = await computeSourceHash({
      schema_version: '0.1',
      scorecard_month: '2026-07',
      generated_at: 'x',
      nested: { a: 1, b: { c: 2, d: 3 } },
      series: [1, 2, 3],
    });
    const reordered = await computeSourceHash({
      series: [1, 2, 3],
      nested: { b: { d: 3, c: 2 }, a: 1 },
      generated_at: 'y',
      scorecard_month: '2026-07',
      schema_version: '0.1',
    });
    expect(reordered).toBe(forward);

    const arrayFlipped = await computeSourceHash({
      schema_version: '0.1',
      scorecard_month: '2026-07',
      generated_at: 'x',
      nested: { a: 1, b: { c: 2, d: 3 } },
      series: [3, 2, 1],
    });
    expect(arrayFlipped).not.toBe(forward);
  });

  it('4. canonical JSON omits generated_at and sorts keys recursively', () => {
    expect(canonicalPayloadJson({ b: 1, generated_at: 'z', a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });
});

describe('persistScorecardSnapshot', () => {
  it('5. upserts on (workspace_id, period_month) with payload-derived fields', async () => {
    const fetchImpl = okFetch();
    const result = await persistScorecardSnapshot(payload(), 'imp-123', { ...CONFIG, fetchImpl });

    expect(result.status).toBe('written');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      'https://example.supabase.co/rest/v1/scorecard_snapshots?on_conflict=workspace_id,period_month',
    );
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-test-key');
    expect(headers.Authorization).toBe('Bearer anon-test-key');
    expect(headers.Prefer).toBe('return=minimal,resolution=merge-duplicates');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.workspace_id).toBe('default');
    expect(body.period_month).toBe('2026-07'); // payload.scorecard_month, NOT today (2026-09)
    expect(body.export_version).toBe('0.1'); // payload.schema_version
    expect(body.computed_at).toBe('2026-09-08T12:00:00.000Z'); // explicit on every upsert
    expect(body.import_id).toBe('imp-123');
    expect(body.source_hash).toBe(await computeSourceHash(payload()));
    expect(body.payload.scorecard_month).toBe('2026-07');
    expect('export_version' in body.payload).toBe(false); // no second version field in the JSON
  });

  it('6. period_month never falls back to today', async () => {
    const fetchImpl = okFetch();
    await persistScorecardSnapshot(payload({ scorecard_month: '2025-01' }), null, {
      ...CONFIG,
      fetchImpl,
    });
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body.period_month).toBe('2025-01');
    expect(body.period_month).not.toContain('2026-09');
  });

  it('7. no-ops safely when Supabase is unconfigured — no request', async () => {
    const fetchImpl = okFetch();
    const result = await persistScorecardSnapshot(payload(), null, {
      supabaseUrl: '',
      anonKey: '',
      fetchImpl,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('8. refuses a payload with a malformed scorecard_month rather than writing a bogus key', async () => {
    const fetchImpl = okFetch();
    for (const bad of ['2026-13', '2026-7', 'not-a-month', '', undefined]) {
      const result = await persistScorecardSnapshot(payload({ scorecard_month: bad }), null, {
        ...CONFIG,
        fetchImpl,
      });
      expect(result).toEqual({ status: 'skipped', reason: 'invalid_payload' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('9. never throws or rejects — a network failure returns a typed result', async () => {
    const boom = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(
      persistScorecardSnapshot(payload(), null, { ...CONFIG, fetchImpl: boom }),
    ).resolves.toEqual({ status: 'failed', reason: 'network down' });

    const rejected = vi.fn(
      async () => new Response('permission denied', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await persistScorecardSnapshot(payload(), null, {
      ...CONFIG,
      fetchImpl: rejected,
    });
    expect(result.status).toBe('failed');
  });
});

describe('readiness barrier', () => {
  it('10. requires every loader AND a usable financial month', () => {
    expect(isSnapshotBarrierSatisfied(READY)).toBe(true);
    (Object.keys(READY) as (keyof SnapshotReadiness)[]).forEach((key) => {
      expect(isSnapshotBarrierSatisfied({ ...READY, [key]: false })).toBe(false);
    });
  });

  it('11. an empty forecast is a valid completed state — settled is what gates, not "has rows"', () => {
    // forecastSettled true with no projection rows must still persist; the payload reports
    // forecast:not_available on its own. There is deliberately no projection-length input here.
    expect(isSnapshotBarrierSatisfied({ ...READY, forecastSettled: true })).toBe(true);
    expect(Object.keys(READY)).not.toContain('projectionLength');
  });

  it('12. a failed or cancelled boot loader cannot satisfy the barrier', () => {
    expect(isSnapshotBarrierSatisfied({ ...READY, importedDataLoaded: false })).toBe(false);
    expect(isSnapshotBarrierSatisfied({ ...READY, accountSettingsLoaded: false })).toBe(false);
    expect(isSnapshotBarrierSatisfied({ ...READY, workspaceSettingsSettled: false })).toBe(false);
    expect(isSnapshotBarrierSatisfied({ ...READY, forecastSettled: false })).toBe(false);
  });
});

describe('persistence gate', () => {
  const GATE = {
    barrierSatisfied: true,
    token: 'boot:0',
    lastPersistedToken: null as string | null,
    inFlightToken: null as string | null,
  };

  it('13. persists once per new token', () => {
    expect(shouldPersistSnapshot(GATE)).toBe(true);
    expect(shouldPersistSnapshot({ ...GATE, lastPersistedToken: 'boot:0' })).toBe(false);
    expect(shouldPersistSnapshot({ ...GATE, token: 'boot:1', lastPersistedToken: 'boot:0' })).toBe(
      true,
    );
  });

  it('14. an in-flight token is not written twice (React Strict Mode double-invoke)', () => {
    expect(shouldPersistSnapshot({ ...GATE, inFlightToken: 'boot:0' })).toBe(false);
  });

  it('15. ordinary rerenders do not persist — the token is unchanged', () => {
    const afterFirstWrite = { ...GATE, lastPersistedToken: 'boot:0' };
    for (let rerender = 0; rerender < 25; rerender += 1) {
      expect(shouldPersistSnapshot(afterFirstWrite)).toBe(false);
    }
  });

  it('16. nothing persists until the barrier is satisfied', () => {
    expect(shouldPersistSnapshot({ ...GATE, barrierSatisfied: false })).toBe(false);
    expect(shouldPersistSnapshot({ ...GATE, token: null })).toBe(false);
  });

  // ---- Clear Data ----------------------------------------------------------------------------
  it('17. Clear Data issues no generation token and cannot overwrite the valid monthly row', () => {
    // State the moment after a completed boot wrote the July snapshot.
    const afterBootWrite = {
      barrierSatisfied: true,
      token: 'boot:0',
      lastPersistedToken: 'boot:0',
      inFlightToken: null,
    };
    expect(shouldPersistSnapshot(afterBootWrite)).toBe(false);

    // Clear Data does two things, and BOTH independently block a write:
    //  (a) it issues no token — the import stamp is untouched, so the token is still 'boot:0';
    //  (b) it empties the transaction store, so financialUsable goes false.
    const afterClearData = {
      ...afterBootWrite,
      barrierSatisfied: isSnapshotBarrierSatisfied({ ...READY, financialUsable: false }),
    };
    expect(afterClearData.token).toBe(afterBootWrite.token); // (a) no new token
    expect(afterClearData.barrierSatisfied).toBe(false); // (b) barrier drops
    expect(shouldPersistSnapshot(afterClearData)).toBe(false);

    // Even if a rerender re-satisfied the barrier, the unchanged token still blocks the write —
    // so the stored July row survives Clear Data.
    expect(shouldPersistSnapshot({ ...afterClearData, barrierSatisfied: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Generation queue — ordering under controlled deferred promises
// ---------------------------------------------------------------------------------------------
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
// Let queued microtasks + the queue's own .then chain run.
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}
function harness(isReady: () => boolean = () => true) {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const log: string[] = [];
  const queue = new SnapshotGenerationQueue(async (token) => {
    log.push(`start:${token}`);
    await gates.get(token)!.promise;
    log.push(`write:${token}`);
  }, isReady);
  const gate = (token: string) => {
    const d = deferred();
    gates.set(token, d);
    return d;
  };
  return { queue, log, gate };
}

describe('SnapshotGenerationQueue', () => {
  it('18. an older boot write cannot overwrite a newer import write — generations are serialized', async () => {
    const { queue, log, gate } = harness();
    const boot = gate('boot:0');
    const imported = gate('boot:1');

    expect(queue.request('boot:0', true)).toBe('started');
    // The import completes while the boot write is still in flight.
    expect(queue.request('boot:1', true)).toBe('queued');
    await flush();
    // The import generation did NOT start concurrently.
    expect(log).toEqual(['start:boot:0']);
    expect(queue.state()).toEqual({ inFlight: 'boot:0', pending: 'boot:1', lastCompleted: null });

    // Even if the boot write is slow, the import write can only begin after it has landed...
    boot.resolve();
    await flush();
    expect(log).toEqual(['start:boot:0', 'write:boot:0', 'start:boot:1']);

    // ...so the newest generation is always the LAST one written, and therefore wins.
    imported.resolve();
    await flush();
    expect(log).toEqual(['start:boot:0', 'write:boot:0', 'start:boot:1', 'write:boot:1']);
    expect(log[log.length - 1]).toBe('write:boot:1');
    expect(queue.state()).toEqual({ inFlight: null, pending: null, lastCompleted: 'boot:1' });
  });

  it('19. the newest token is never lost; intermediate generations are superseded', async () => {
    const { queue, log, gate } = harness();
    const boot = gate('boot:0');
    gate('boot:1');
    const third = gate('boot:2');

    queue.request('boot:0', true);
    expect(queue.request('boot:1', true)).toBe('queued');
    expect(queue.request('boot:2', true)).toBe('queued'); // supersedes boot:1
    expect(queue.state().pending).toBe('boot:2');

    boot.resolve();
    await flush();
    third.resolve();
    await flush();
    expect(log).toEqual(['start:boot:0', 'write:boot:0', 'start:boot:2', 'write:boot:2']);
    expect(log).not.toContain('start:boot:1'); // stale intermediate never written
    expect(queue.state().lastCompleted).toBe('boot:2'); // newest completed generation wins
  });

  it('20. a token already in flight, completed, or waiting is ignored (Strict Mode double-invoke)', async () => {
    const { queue, log, gate } = harness();
    const boot = gate('boot:0');
    gate('boot:1');

    expect(queue.request('boot:0', true)).toBe('started');
    expect(queue.request('boot:0', true)).toBe('ignored'); // in flight
    expect(queue.request('boot:1', true)).toBe('queued');
    expect(queue.request('boot:1', true)).toBe('ignored'); // already waiting
    boot.resolve();
    await flush();
    expect(queue.request('boot:0', true)).toBe('ignored'); // completed
    expect(log.filter((l) => l === 'start:boot:0')).toHaveLength(1);
  });

  it('21. an unsatisfied barrier is ignored; a rejecting runner cannot wedge the queue', async () => {
    const { queue, log, gate } = harness();
    expect(queue.request('boot:0', false)).toBe('ignored');
    expect(log).toEqual([]);

    const failing = gate('boot:0');
    const next = gate('boot:1');
    queue.request('boot:0', true);
    queue.request('boot:1', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failing.reject(new Error('boom'));
    await flush();
    warn.mockRestore();
    // The failed generation settled and the waiting one still ran — nothing stuck in flight.
    expect(log).toContain('start:boot:1');
    next.resolve();
    await flush();
    expect(queue.state()).toEqual({ inFlight: null, pending: null, lastCompleted: 'boot:1' });
  });
});

// ---------------------------------------------------------------------------------------------
// Correction-round regressions
// ---------------------------------------------------------------------------------------------
describe('forecast bootstrap decision', () => {
  const OK = { contractsRead: [], regenResults: [], eventsRead: [], threw: false };

  it('22. a regeneration that RETURNED false (the helper swallows its own exception) fails readiness', () => {
    expect(forecastBootstrapFailed(OK)).toBe(false);
    expect(forecastBootstrapFailed({ ...OK, regenResults: [true, true] })).toBe(false);
    expect(forecastBootstrapFailed({ ...OK, regenResults: [true, false] })).toBe(true);
    expect(forecastBootstrapFailed({ ...OK, regenResults: [false] })).toBe(true);
  });

  it('22b. null reads and thrown reads fail; a successful EMPTY read does not', () => {
    expect(forecastBootstrapFailed({ ...OK, contractsRead: null })).toBe(true);
    expect(forecastBootstrapFailed({ ...OK, eventsRead: null })).toBe(true);
    expect(forecastBootstrapFailed({ ...OK, threw: true })).toBe(true);
    // [] is "no rows", a valid completed state — the payload reports forecast:not_available
    expect(forecastBootstrapFailed({ contractsRead: [], regenResults: [], eventsRead: [], threw: false })).toBe(false);
  });
});

describe('queue: readiness drops while an import waits behind boot (Clear Data)', () => {
  it('23. the waiting generation is dropped, never run off cleared inputs; a later import still persists', async () => {
    let ready = true;
    const { queue, log, gate } = harness(() => ready);
    const boot = gate('boot:0');
    gate('boot:1');
    const later = gate('boot:2');

    queue.request('boot:0', true); // boot write in flight (slow)
    expect(queue.request('boot:1', true)).toBe('queued'); // an import completes behind it

    ready = false; // Clear Data empties the store while boot is still writing
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    boot.resolve();
    await flush();
    warn.mockRestore();

    // The queued import did NOT start — it would have collected the cleared dataset and
    // overwritten the valid row.
    expect(log).toEqual(['start:boot:0', 'write:boot:0']);
    expect(log).not.toContain('start:boot:1');
    expect(queue.state()).toEqual({ inFlight: null, pending: null, lastCompleted: 'boot:0' });

    // A later SUCCESSFUL import re-satisfies readiness and issues a new token — it persists.
    ready = true;
    expect(queue.request('boot:2', true)).toBe('started');
    later.resolve();
    await flush();
    expect(log).toEqual(['start:boot:0', 'write:boot:0', 'start:boot:2', 'write:boot:2']);
    expect(queue.state().lastCompleted).toBe('boot:2');
  });
});

describe('runSnapshotGeneration', () => {
  it('24. the import id captured at start labels the payload — even if a new import lands mid-collection', async () => {
    // "Latest state" as the hook's ref would hold it. It changes DURING the retention fetch.
    const latest = { sources: 'dataset-A', importId: 'import-A' };
    const collectGate = deferred();
    const persist = vi.fn(
      async (_payload: Record<string, unknown>, _importId: string | null) =>
        ({ status: 'written', periodMonth: '2026-07', sourceHash: 'h' }) as const,
    );

    // Captured together, synchronously, before any await — exactly what the hook does.
    const capture = { sources: latest.sources, importId: latest.importId };
    const run = runSnapshotGeneration(capture, {
      collect: async (sources) => {
        await collectGate.promise; // the four retention fetches are in flight...
        return { payload: { built_from: sources, scorecard_month: '2026-07', schema_version: '0.1' } };
      },
      persist,
      isStillReady: () => true,
    });

    // ...and an import completes while they are: the latest id is now B.
    latest.sources = 'dataset-B';
    latest.importId = 'import-B';
    collectGate.resolve();
    await run;

    // Payload A is labelled import A, never import B.
    expect(persist).toHaveBeenCalledTimes(1);
    const [payload, importId] = persist.mock.calls[0];
    expect(payload.built_from).toBe('dataset-A');
    expect(importId).toBe('import-A');
  });

  it('25. readiness falling mid-generation skips the write; the stored row is left alone', async () => {
    let ready = true;
    const persist = vi.fn(async () => ({ status: 'written', periodMonth: '2026-07', sourceHash: 'h' }) as const);
    const result = await runSnapshotGeneration(
      { sources: 'dataset-A', importId: 'import-A' },
      {
        collect: async () => {
          ready = false; // Clear Data runs while the retention fetches are in flight
          return { payload: { scorecard_month: '2026-07', schema_version: '0.1' } };
        },
        persist,
        isStillReady: () => ready,
      },
    );
    expect(result).toEqual({ status: 'skipped', reason: 'readiness_dropped' });
    expect(persist).not.toHaveBeenCalled();
  });
});
