# UNSAFE_TRANSACTION Reproduction Findings

## Status: REPRODUCED on localhost

The UNSAFE_TRANSACTION error has been **reliably reproduced** on localhost against a real PostgreSQL database with no protocol mutation, no custom sockets, and no proxies.

---

## Two Independent Bug Paths

There are **two independent code paths** that lead to UNSAFE_TRANSACTION in production. Both have been identified and fixed.

### Path 1: Pipeline overflow skips `onexecute` (reproducible on localhost)

**Location:** `src/connection.js` `execute()` (lines 173-177)

```javascript
return write(toBuffer(q))                                        // (A)
  && !q.describeFirst                                            // (B)
  && !q.cursorFn                                                 // (C)
  && sent.length < max_pipeline                                  // (D) ← BUG
  && (!q.options.onexecute || q.options.onexecute(connection))   // (E)
```

When a BEGIN query is **pipelined** onto a busy connection and `sent.length >= max_pipeline`, JavaScript's `&&` short-circuits at (D) and `onexecute` at (E) **never fires**. `connection.reserved` is never set. When PostgreSQL responds with `CommandComplete('BEGIN')`, the UNSAFE_TRANSACTION check sees `!connection.reserved` → error.

**How BEGIN gets pipelined:** The global `handler()` (src/index.js:329-342) dispatches BEGIN queries to busy connections via `go(busy.shift(), query)` when no open or closed connections are available. This pipelines BEGIN into the connection's `sent[]` array.

### Path 2: `drain` callback dispatches to reserved connections (production only)

**Location:** `src/connection.js` drain callback (lines 297-299)

```javascript
function drain() {
  !query && onopen(connection)  // no check for connection.reserved!
}
```

On real networks, TCP ACK piggy-backing causes `drain` to fire in the same event-loop tick as `data`. The `data` callback processes the response (setting `query = null`), then `drain` fires and sees `!query` → calls `onopen()` on a **reserved** connection. This dispatches pool queries to the reserved connection, filling its `sent[]` array. If enough queries accumulate (`sent.length >= 100`), a subsequent pipelined BEGIN hits Path 1.

**Why this can't be reproduced on localhost:** The loopback interface clears write buffers in microseconds via kernel memory copy. `drain` fires before the response arrives, so `query` is always set when drain fires → `!query` is false → no bug.

### How the Paths Combine in Production

1. Real network latency keeps connections busy longer → more pipelining
2. `drain` fires with `query=null` on reserved connections → `onopen()` dispatches pool queries to them
3. Pool queries fill `sent[]` on the reserved connection
4. A BEGIN gets pipelined → `sent.length >= max_pipeline` → `onexecute` skipped → UNSAFE_TRANSACTION

The `handler()` pipelining of BEGIN is the **direct cause**. The `drain` callback is the **amplifier** that makes pipeline overflow reachable at the default `max_pipeline: 100`.

---

## Original Analysis Correction

The original analysis (race-condition-analysis.md) investigated the short-circuit in `execute()` (Hypothesis 1) but only checked whether `write()` returns false (the 1024-byte threshold):

> **Result: DISPROVED for BEGIN queries.** BEGIN is a simple Q message (~12 bytes).

This is correct for condition (A). But condition (D) — `sent.length < max_pipeline` — was not examined. The `write()` return value is irrelevant; it's the **pipeline depth check** that causes the skip.

The `drain` callback analysis (Hypothesis 3) was correct — it IS a vulnerability — but the connection between drain and UNSAFE_TRANSACTION is indirect (drain → connection corruption → pipeline overflow → onexecute skip → UNSAFE_TRANSACTION).

---

## Reproduction Results

All tests ran against a real local PostgreSQL (v15) database.

### Test 1: max_pipeline=1, max=2

```
Config:  max: 2, max_pipeline: 1, 30 queries + 10 transactions
Result:  9 UNSAFE_TRANSACTION errors
```

With `max_pipeline: 1`, ANY pipelined BEGIN immediately hits `sent.length >= 1`.

### Test 2: max_pipeline=2, max=3 (5 rounds)

```
Config:  max: 3, max_pipeline: 2, 50 queries + 17 transactions per round
Result:  5/5 rounds reproduced (1 UNSAFE_TRANSACTION each)
```

### Test 3: Default max_pipeline=100, max=2

```
Config:  max: 2, max_pipeline: 100, 300 queries + 50 transactions
Result:  0 UNSAFE_TRANSACTION (pipeline doesn't overflow on localhost)
```

On localhost, responses come back too fast for `sent[]` to reach 100. In production with network latency, the drain callback amplifies this by dispatching extra queries to reserved connections.

---

## Fixes Applied (3 changes)

### Fix 1: `execute()` — separate `onexecute` from pipeline gating

`onexecute` now fires whenever data is written, regardless of pipeline depth. The return value only reflects pipeline capacity.

```javascript
build(q)
const written = write(toBuffer(q))
if (written && q.options.onexecute) {
  q.options.onexecute(connection)
  return false
}
return written
  && !q.describeFirst
  && !q.cursorFn
  && sent.length < max_pipeline
```

**Addresses:** Path 1 directly. Belt-and-suspenders if BEGIN somehow gets pipelined.

### Fix 2: `handler()` — don't pipeline BEGIN onto busy connections

BEGIN queries (those with `onexecute`) now queue instead of being pipelined onto busy connections.

```javascript
if (query.options.onexecute) {
  queries.push(query)
  return
}
```

**Addresses:** The direct cause. BEGIN waits for a free connection instead of being pipelined. Eliminates the pipeline overflow path entirely.

### Fix 3: `drain()` — guard against reserved connections

```javascript
function drain() {
  !query && !connection.reserved && onopen(connection)
}
```

**Addresses:** Path 2 (the production amplifier). Prevents `onopen()` from dispatching queries to reserved connections during back-pressure events.

### Why All Three Fixes Are Needed

| Fix | Prevents | Standalone sufficient? |
|-----|----------|----------------------|
| execute() | onexecute skip when pipelined | Yes, but only if BEGIN is never pipelined |
| handler() | BEGIN pipelining entirely | Yes for UNSAFE_TRANSACTION, but drain still corrupts |
| drain() | Connection corruption from back-pressure | No — doesn't prevent pipelining via handler() |

Together they make the bug **unreachable through any path**.

---

## Test Suite

`tests/race-condition.js` — 5 real-DB tests (no mocks):

1. **Pipeline overflow** — max_pipeline=1, concurrent load (direct trigger)
2. **Connection exclusivity** — concurrent begins, PID-based sharing detection
3. **Stress** — 50 begins + 100 queries on 5 connections
4. **Low pipeline stress** — max_pipeline=2, 5 rounds
5. **Data integrity** — verify no cross-transaction contamination

All 5 pass. Plus all 258 existing ESM and CJS tests pass with no regressions.

```bash
# Run race condition tests
export PATH="/usr/local/opt/postgresql@15/bin:$PATH"
node tests/race-condition.js

# Run full test suite
npm test
```
