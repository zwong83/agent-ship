# Dashboard command center — verification

2026-11-16 · Branch `codex/dashboard-command-center` · Baseline `472c6182229912f1c4aab1eb9eda559896127b1f`

## Outcome

The scoped implementation, automated regression and local browser acceptance checks are complete. Nine frontend suites, TypeScript, Vite and Java packaging passed. The current packaged website was restarted and verified at http://127.0.0.1:4173. No unresolved functional failure was observed in the exercised scope. This report distinguishes deterministic tests, browser observations and unperformed supplemental checks; it does not declare production or external-agent acceptance.

Sources: [BRD](../BRD/AgentShip-Dashboard/BRD-AgentShip-Dashboard.md), [PRD](../PRD/PRD-AgentShip-Dashboard.md), [SRS](../SRS/SRS-AgentShip-Dashboard.md), [FRS](../FRS/FRS-AgentShip-Dashboard.md), [SA](../SA/SA-AgentShip-Dashboard.md), [SD](../SD/dashboard-command-center/index.md), [24-case test analysis](test-analysis.md). The user selected the reference and authorized this increment through testing. Final visual preference remains the user's judgment.

## Tested snapshot and environment

- Exact changed production/test files: [SHA-256 manifest](evidence/source-manifest.json). The baseline plus these working-tree hashes identifies the tested increment without claiming a Git commit.
- Windows local workspace; Node.js 22.15.0, TypeScript 5.8.3, Vite 6.4.1, React 19.1.0; Java 21 / Spring Boot 3.5.6; existing PostgreSQL 16 cluster on loopback port 55432.
- Real website on loopback port 4173, inspected through the ChatGPT in-app browser using CUA. No standalone external browser automation framework or mocked browser API responses were used for the UI observations.
- Browser verification occurred approximately 19:24–19:37 MYT. Explicit CSS viewports: 1440×1000, 1280×800, 768×1024, 390×844 and 320×800. Viewport override was reset afterward.
- Final packaged assets observed in the browser: `/assets/index-CbLWeKkB.js` and `/assets/index-Lbi_4Lu4.css`. Java packaging succeeded at 19:36 MYT; the final process uses the normal startup script and packaged static resources, without the temporary external-dist override used during iteration.

The local fixture helper created a separate synthetic account with twelve requirements: seven operational runs (five running, one waiting for a reply, one queued), one completed history item and four unstarted items. Initial recorded values were eight active agent tasks, one waiting task, twenty-one current workflow steps and three resolved steps. Selected fixtures used two concurrent child agents. The helper did not execute GitHub, Codex or a real delivery pipeline.

During transition tests, API delivery was renamed and completed. The dashboard then reported six operational runs, six active agent tasks, eighteen current steps and two resolved steps, while retaining twelve catalog items. An unstarted requirement was temporarily transferred to a second isolated test account; it disappeared from the first account's catalog and focus cleared. Ownership and the edited name were restored. Test-only session revocation caused the real polling path to return to sign-in. Finally, only the helper's unfinished runs were retired, the test account was signed out, and the website remained running. Synthetic historical records remain in the isolated test accounts; no user requirements or runs were changed.

## Automated evidence

[Full frontend output](evidence/frontend-tests.log) contains each suite's exit code. All nine passed:

| Suite | Verified behavior |
|---|---|
| `dashboard-catalog.test.mjs` | All catalog lifecycle states, current/history separation, latest repair waves, exact progress, actual agents, parallel contexts, permission-aware alerts, immutable inputs and run-scoped identity |
| `dashboard-model.test.mjs` | Existing metrics, scope, artifacts, connectivity, terminal exclusions, blocker and concurrent-stage regression |
| `dashboard-snapshot.test.mjs` | Multi-page complete reads, four-request concurrency limit, nonoverlapping refresh, atomic publication/cache, terminal reuse, stale recovery, 401/403 precedence, abort/disposal |
| `dashboard-view.test.mjs` | Initial/empty/error/no-live/no-match states, catalog counts, progress, multiple agents, escaped names, token absence, chat capability/stale state, queued labels and measured-density boundaries |
| `dashboard-motion.test.mjs` | Actual orbital effect/geometry under controlled DOM/canvas/RAF/media boundaries: static reduced motion, resumed motion, focus-pinned alert with moving hull, hidden-page behavior, DPR cap and cleanup |
| `earth-formation.test.mjs` | Six distinct planes, perspective, circular loops, wake alignment, exact hull paths, repeated-cycle separation, bounded 52px alerts and pinned targets at current scene/boundary sizes |
| `workflow-dependency.test.mjs` | Existing dependency, order, missing-node, duplicate and cycle rules |
| `workflow-map-render.test.mjs` | Existing preview, active connections, offline states and keyboard targets |
| `workflow-progress.test.mjs` | Existing recorded workflow/node/dependency motion states |

Commands and results:

```text
node <each frontend/test/*.test.mjs>       9 suites, all exit 0
npx.cmd --no-install tsc --noEmit         exit 0 (frontend working directory)
npx.cmd --no-install vite build          exit 0, 167 modules
mvn.cmd --batch-mode --no-transfer-progress -f platform/pom.xml package -DskipTests
                                         exit 0, BUILD SUCCESS
git diff --check                         exit 0
```

Maven packaging deliberately skipped Java tests: no Java, wire API, authentication policy or schema implementation changed. Packaging is not reported as a backend test run. Model/UI contributors' observed Red→Green cycles and local checks are retained in their separate [model](model-implementation.md) and [UI](ui-implementation.md) reports. Motion verification was added after implementation and is not represented as TDD or React DOM integration coverage.

## Case execution and observations

| Plan cases | Outcome and evidence |
|---|---|
| C01–C08 | Pass in catalog/model suites. Exact lifecycle, precedence, current-wave arithmetic, active/waiting identity, unavailable versus zero progress, filtering, permissions and deduplication assertions. |
| C09–C10 | Pass in snapshot/view suites: 101 catalog entries across pages, bounded details, atomic snapshot/cache, initial failure, stale retention, retry and cancellation. |
| C11 | Pass in snapshot/view suites for both 401/403, including concurrent transport failure masking. Real browser additionally verified selected populated dashboard → test-account session revocation → sign-in with no retained dashboard content. Browser 403 was not separately injected. |
| C12 | Pass for disposal in snapshot tests and browser selection lifecycle. Focus survived rename and completion, removed catalog access cleared focus, search remained set, and scroll position 1318px was retained over successful polling. End/Home operated the independently scrollable list. Timer/listener cleanup source-reviewed. |
| C13 | Pass in rendered-state suite. Real packaged site after fixture retirement retained all twelve rows while showing “No missions in flight,” zero live metrics and “Not reported” token usage. |
| C14 | Browser pass: API row scope showed one requirement/two active child agents/one-of-three steps; ship selection changed scope; history and unstarted focus showed no live work; clear restored aggregate. Seventh operational row revealed sector two. After density refinement, selecting the queued requirement at 1280px revealed its compact sector and ordinary polling did not reset manual sector browsing. |
| C15 | Browser pass: default All included running, blocked, queued, historical and unstarted entries; independent list scroll reached the last row. Mixed-case padded query `  aPi  ` matched one row. Combining it with Blocked produced truthful no-match; Reset filters restored the catalog without clearing selected scope. Running and All controls operated with global counts. |
| C16 | Browser pass: actual concurrent Frontend/Backend engineer labels and recorded progress were visible. Expanded blocked activity showed Backend engineer executing and Frontend engineer awaiting reply. Historical/unstarted scope did not invent agents. Catalog remained available during scope changes. |
| C17 | Browser pass: approved sailboat asset, six paths, front/back motion and wakes observed. Focused red target measured 52×52, retained coordinates over subsequent observation while motion continued, and showed a 2px mint focus outline. Enter on the red target and click on stationary row chat both opened `/runs/f9fc34a8-ffd4-4c24-b760-ff0f88781b3a/chat`. Chat remained “Not connected”; no control acquisition or message was submitted. |
| C18 | Pass in model/component/store tests: capability absence and stale snapshots disable direct chat; fresh recovery restores eligible controls. UI navigation confirmed the allowed case. |
| C19 | Pass after fixing measured-density failure. Unchanged clearance oracle retained: projected centers >75px, nonoverlapping hull bounds, alert separation >74px, 52px targets in bounds and pinned focus. Two cycles sampled at 0.125-second increments. Tested desktop/phone dimensions plus exact 500×500 six-ship and 430×430 four-ship thresholds. |
| C20 | Browser pass at all five planned sizes: desktop three columns and summary strip, narrow list-before-fleet order, no horizontal page overflow (scrollWidth equaled 1440/1280/768/390/320 respectively), reachable primary actions and readable current context. Governed screenshots below. |
| C21 | Targeted keyboard/accessibility pass: list End/Home, search, button focus/selection, disclosure, red target Tab/Enter, status text and named native progress. Full names available in text/title/accessible labels. This was not a screen-reader or formal WCAG audit. |
| C22 | Deterministic motion/lifecycle pass using actual effect and geometry. Normal browser motion observed. OS reduced-motion preference was not toggled in the browser; supported CUA capabilities did not supply media emulation. Static/resume behavior is established by the isolated effect test, not claimed as browser proof. |
| C23 | Real polling pass for rename, completion, ownership removal/restoration and session expiry; aggregate values and focused labels updated. Exact network-failure/stale/recovery oracle passed in C10 tests. A separate live server-outage scenario was not injected into the browser; no such observation is claimed. |
| C24 | Pass: nine suites, typecheck, production build and Java packaging. Real login/dashboard/workflows/agents/chat routes rendered shared navigation. Final jar assets verified after restart, then synthetic account signed out. No pre-expiry console warning/error was observed in the captured browser log query. |

## Visual evidence

| Evidence | Scope |
|---|---|
| [Approved reference](approved-dashboard.jpg) | User-selected design; illustration/sample values |
| [Final default dashboard](evidence/dashboard-final.jpg) | 1440px, All catalog; recorded synthetic data after completion transition |
| [1440px running filter](evidence/dashboard-1440.jpg) | Six live ships, running rows and aggregate telemetry |
| [1280px dashboard](evidence/dashboard-1280.jpg) | Compact desktop layout and four-ship sector |
| [768px tablet](evidence/dashboard-768.jpg) | Stacked list-first layout |
| [390px phone](evidence/dashboard-390.jpg) | Phone layout and independent list |
| [320px phone](evidence/dashboard-320.jpg) | Narrow layout, final navigation spacing |
| [Expired session](evidence/session-expired.jpg) | Real polling denial returned to sign-in |
| [Packaged no-live state](evidence/packaged-no-live-runs.jpg) | Current jar after cleanup still shows catalog/history with no fabricated fleet |

Tablet/390 captures preceded the final dashboard-only 320px label adjustment and measured-density correction; their unchanged layout assertions remain applicable. Final 1440/1280/320 captures and package verification include those corrections. Full-page captures can be taller than the specified viewport; they do not imply a different CSS viewport. Counts and names in screenshots are synthetic test records, not shipped sample telemetry.

## Findings resolved during verification

1. Shared details-grid styling crushed the current-activity summary into a narrow column. Dashboard-specific block layout restored a full-width disclosure and readable agent details.
2. Intrinsic right-card heights exceeded the desktop panels. Fixed rail tracks, compact spacing and a bounded attention list aligned the cards; the sole blocked chat remains visible in the compact desktop card.
3. A 511×352px scene was too short for six ships. Compact heading/summary/footer increased scene height, but six ships at 511×468 still reached only 70.57px projected separation. Actual scene measurement now selects six/four/two ships at 500/430px thresholds; the original collision oracle passed without weakening it or changing the six paths.
4. The 320px navigation labels touched neighboring labels. Dashboard-only small-screen typography was tightened while retaining 58×55px button hit areas.
5. During implementation review, concurrent network failures could mask denied access; the store now prioritizes 401/403. Poll-driven fleet-page resets and misleading green queued labels were also corrected and tested.

Two initial synthetic fixture attempts failed because of global requirement-name uniqueness and the node-completion started-at constraint. The helper now suffixes names and records started-at for completed fixture nodes. These were harness setup failures, not product defects; those attempts' own unfinished runs were retired.

## Coverage limits and delivery state

The relevant contract/system-E2E/performance/migration specialist applicability decisions remain as documented in the test analysis: unchanged APIs and backend execution do not require a new compatibility, agent-delivery, load or migration suite for this increment. Local browser coverage is one engine, English and normal zoom. No formal accessibility certification, all-engine matrix, real token-accounting test, external delivery run, production benchmark or rendered-Mermaid verification is claimed. Supplemental browser 403, transport-outage and reduced-motion preference injection were not performed; deterministic denial/recovery/motion tests supply their stated bounded evidence.

The local website is running with the verified packaged frontend. Temporary fixture heartbeats stopped successfully; only their unfinished runs were retired. No remote push, merge, production deployment or user-data cleanup was performed. Branch changes and scoped documents are ready for review.
