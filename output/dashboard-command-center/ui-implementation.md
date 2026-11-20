# Dashboard UI implementation evidence

2026-11-16 · Task owner: dashboard_ui · Branch: `codex/dashboard-command-center` · Baseline: `472c618`.

## Authorized scope and decisions

The user approved [the visual reference](approved-dashboard.jpg) and authorized the full dashboard lifecycle. The parent assigned dashboard composition, requirement inventory, existing fleet adaptation, snapshot loading seam and their local tests. Sources: [FRS v1.0](../FRS/FRS-AgentShip-Dashboard.md), [frontend design](../SD/dashboard-command-center/frontend.md), [integration design](../SD/dashboard-command-center/integration.md), and [test analysis](test-analysis.md). The design owner confirmed the contract before production edits. No API, database, authentication policy, global CSS or unrelated route changes were made by this task.

Applied skills: tdd-agent/tdd-standard, unit-testing-standard, clean-code-standard and frontend-state-data-standard. Node/esbuild component rendering and deterministic request-boundary tests fit the assigned behavior; these do not claim real-browser interaction verification.

## Implementation

- `frontend/src/dashboard.tsx`: four scoped summary metrics, global requirement inventory, six-path fleet and four telemetry cards. Preserves existing navigation, refresh, fullscreen and start actions. Local focus/search/filter/page state stays separate from recorded data. Polling does not reset manually chosen fleet pages. Focus remains valid for catalog entries without operational work; removed identities are cleared. A ResizeObserver measures the actual fleet stage: its smaller dimension allows six ships at 500px, four at 430px and two below. Initial unmeasured capacity is two; capacity changes reconcile the selected sector without changing the six orbital paths.
- `frontend/src/requirement-list.tsx`: named independently scrollable list; global All/Running/Blocked/Queued counts, search and reset, truthful progress/history, actual active/waiting agents and expandable parallel execution. Selection and chat are separate controls. No-run work remains discoverable. Untrusted names render through React text escaping.
- `frontend/src/use-dashboard-snapshot.ts`: one load/cache owner, complete atomic snapshots, paginated inventory, bounded four concurrent detail reads, unchanged terminal caching, fresh operational capabilities, no overlapping refreshes, abort/disposal and retained stale snapshot. Authorization failures clear data/cache; 401 invokes the existing session handler. Any 401/403 outranks concurrent network failures. The hook retains visible-page five-second polling and removes its timer/listener on departure.
- `frontend/src/earth-fleet.tsx`: optional `hideRoster` removes duplicate roster and reserved space, preserves existing geometry/motion, full-name tooltip, gray queued/preparing semantics, independent alert targets and stale-disabled chat. Default roster support remains available to existing callers.

CSS is owned by dashboard_visual and projections by dashboard_model. Their changes are not claimed as this task's implementation. Current application root does not use React StrictMode; store disposal matches that existing mount lifecycle. Adding StrictMode effect replay later requires revisiting the store hook's lifetime.

## Observed Red → Green cycles

| Cycle / source | Actual Red before change | Green and refactor |
|---|---|---|
| Catalog-first composition · F-D01/F-D07, C13 | `node frontend/test/dashboard-view.test.mjs` failed `The default dashboard exposes its catalog before telemetry loads`; baseline lacked “All available requirements”. First output retained at `.agentship/dashboard-ui-red.log`. | Composed the list, summary, fleet and rail; same assertion passed. Extracted list and snapshot responsibilities without sharing render state with requests. |
| Concurrent denial precedence · F-D08, C10/C11 | New `dashboard-snapshot.test.mjs` failed `An auth denial must clear data even when another request fails first`: expected undefined but retained the private requirement snapshot. | Collected all settled branch/in-flight detail errors and selected 401, then 403, before transport errors. Mixed branch 401/403 and mixed detail403 regressions pass. |
| Queued fleet truthfulness · F-D05, C13/C18 | Extended component test failed `Queued ships need a distinct truthful state`; actual output had `orbital-running` and `Running requirement: queued`. | Added queued/preparing label/class to hull and independent HUD, blocked priority retained. Same test passes. Visual owner added neutral styling. |
| Measured scene density · F-D05, C19 | Parent measured 511×468 six-ship geometry below the unchanged clearance oracle. Component test then failed `Before scene measurement, use the safe two-ship sector rather than assuming desktop capacity`: rendered 3 fixture ships instead of 2. | Replaced viewport heuristic with actual stage ResizeObserver and 500/430 smaller-dimension thresholds. Component/threshold tests pass, including 511×468→4, 500×500→6 and both width/height just below each boundary. TypeScript passes. Parent owns actual-dimension geometry and browser confirmation. |

Additional snapshot/render assertions were added after the first implementation. They are verification coverage, not claimed historical TDD: complete paging, maximum fan-out, cache, stale recovery, disposal, list progress/parallel labels, empty/no-match/denial states and safe markup. Two fixture mistakes during test expansion (mock catalog path, stale-snapshot reference captured before a subsequent successful refresh) were corrected without changing production behavior or weakening the intended oracle.

## Local verification and coverage

Executed against the final owned source snapshot, all exit 0:

```text
node frontend/test/dashboard-view.test.mjs
node frontend/test/dashboard-snapshot.test.mjs
node frontend/test/dashboard-motion.test.mjs
npx.cmd --prefix frontend --no-install tsc --project frontend/tsconfig.json --noEmit
```

Component suite: initial unknown metrics; loading versus unavailable versus valid empty; no-live catalog; global row counts and searched count; known 50%/1-of-2 progress; no-run unavailable progress; recorded history; both parallel agent names; expanded activity; permitted/unavailable/stale-disabled chat; HTML-like names escaped; missing token usage “Not reported”; no duplicate roster/zero reserved bottom; distinct queued HUD; roster and HUD stale actions disabled.

Snapshot suite: 100 catalog items plus next page; full snapshot only after six detail reads finish; peak four concurrent detail reads and repeated refresh ignored; unchanged terminal detail reuse with current summary device status; operational detail refreshed each time; transient stale identity and recovery; cyclic cursor fails without fabricated success; 401/403 clear data and correct session callback; denied terminal cache discarded; simultaneous network/auth failures favor denial; disposal aborts and late fulfillment cannot notify/publish.

Motion suite (C22, added on parent follow-up): executes the actual EarthFleet effect and real orbit geometry through a minimal single-mount hook adapter with deterministic DOM/canvas/RAF/media-query boundaries. Observes static reduced-motion transforms and no redraw, resumed normal motion after preference change, moving hull with focus-pinned alert and released target on blur, hidden-page no-redraw, capped DPR, canceled frame/disconnected resize observer/removed media listener, and harmless late callback after disposal. This is post-implementation verification, not a claimed TDD cycle or React DOM integration test. Initial harness failure came from replacing React internals used by jsx-runtime; retaining the real jsx-runtime fixed the harness, with no production edit. Suite passes.

TA coverage: C09/C10/C11 controller behavior, C13 component states, C18 capability presentation, C12 disposal and C22 animation lifecycle have deterministic evidence. C12 focus rename/terminal/removal/scroll preservation and C14 actual row/ship/sector interactions remain the parent's browser evidence. Snapshot polling timer/listener cleanup is source-reviewed. No browser visuals, keyboard interaction, screenshot parity, cross-browser compatibility, backend authorization or deployment verdict is claimed here.

## Seven-step workflow outcome

| Step | Status | Outcome |
|---|---|---|
| 1. Authorized task | Complete | Exact ownership and user-approved design confirmed with parent/design owner; scoped documents ready. |
| 2. Small behavior/seam | Complete | Component render plus deterministic store boundary selected; no new dependency or server API. |
| 3. Observe Red | Complete | Four genuine missing-behavior failures recorded above; post-implementation assertions distinguished. |
| 4. Minimal Green | Complete | Catalog presentation, denial precedence, queued semantics and measured density satisfy their unchanged oracles. |
| 5. Refactor green | Complete | Shared model status labels reused; list/request ownership separated; affected tests rerun. |
| 6. Verify and hand off | Complete | Owned suites and TypeScript pass; browser interaction/visual coverage handed to parent without dispatching independent agents. |
| 7. Return evidence | Complete | This report plus parent messages identify source/test/code traceability, results and remaining verification scope. |

Coding status: owned implementation and local verification complete. Final assembled testing, acceptance and any release are the parent's/user's responsibility; this report is not a release approval.
