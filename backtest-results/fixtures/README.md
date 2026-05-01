# Backtest Fixture Procedure

The harness requires two frozen files in this directory:

```
backtest-results/fixtures/transactions-snapshot.jsonl   ← required
backtest-results/fixtures/historical-anchors.json       ← optional but recommended
```

---

## 1. Transaction snapshot (`transactions-snapshot.jsonl`)

The fixture is a JSONL file — one `Txn` JSON object per line, in the same
shape that the production app reads from `shared_imported_transactions.txn`.

### Export via psql

```bash
psql "$DATABASE_URL" \
  -t -A \
  -c "SELECT txn
      FROM shared_imported_transactions
      WHERE workspace_id = 'default'
      ORDER BY imported_at_iso ASC, fingerprint ASC" \
  > backtest-results/fixtures/transactions-snapshot.jsonl
```

Replace `'default'` with your actual `VITE_SHARED_WORKSPACE_ID` if it differs.
`-t -A` suppresses headers and alignment so each output line is a bare JSON object.

### Export via Supabase MCP (if you have it connected)

Run this SQL through `execute_sql` and write the `txn` value from each row to
a file, one JSON object per line:

```sql
SELECT txn
FROM shared_imported_transactions
WHERE workspace_id = 'default'
ORDER BY imported_at_iso ASC, fingerprint ASC;
```

### Verify

After export, sanity-check the file:

```bash
# Should print the count of transactions
wc -l backtest-results/fixtures/transactions-snapshot.jsonl

# Should parse cleanly (exits 0 if valid JSONL)
node -e "
  const fs = require('fs');
  const lines = fs.readFileSync('backtest-results/fixtures/transactions-snapshot.jsonl','utf8')
    .split('\n').filter(l => l.trim());
  lines.forEach((l, i) => { try { JSON.parse(l); } catch(e) { throw new Error('Line '+(i+1)+': '+e); } });
  console.log('OK —', lines.length, 'transactions');
"
```

---

## 2. Historical anchors (`historical-anchors.json`) — optional

Anchors provide real starting cash balances at specific dates, enabling the
harness to measure absolute dollar accuracy (lowest-balance error, endpoint
error, safety-line hit rate). Without anchors, the harness still runs but
zero-anchors each as-of date — trajectory metrics are reliable, absolute
metrics are not.

### Format

```json
{
  "anchors": [
    { "asOfDate": "2024-01-01", "operatingCashBalance": 142500.00 },
    { "asOfDate": "2025-01-01", "operatingCashBalance": 198300.00 }
  ]
}
```

`asOfDate` must be `YYYY-MM-DD`. `operatingCashBalance` is the operating-cash
balance on that date — the bank balance **excluding** owner draws, financing
draws, transfers, and uncategorized items. Use the closest business-day
actual if the exact date falls on a weekend.

The harness picks the closest preceding anchor for each as-of date and walks
operating-cash deltas forward from there.

---

## When to refresh

- After any material data correction or recategorization.
- Quarterly, to keep the regression baseline current.
- **Never silently mid-phase** — refreshing changes the metrics, which defeats
  the regression-detection purpose that Phase 2 will build on. Record the
  refresh date in a commit message.
