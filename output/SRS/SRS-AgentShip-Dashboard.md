# SRS — AgentShip Dashboard Command Center

Version 1.0 · 2026-11-16 · New scoped SRS from [PRD v1.0](../PRD/PRD-AgentShip-Dashboard.md) and [BRD v1.0](../BRD/AgentShip-Dashboard/BRD-AgentShip-Dashboard.md). Owner: requesting user. Author: Product Agent. Status: user-authorized scoped baseline, ready for FRS/design; not production-release approval. No prior scoped FRS exists; FRS follows this document. The current user change request and approved screenshot govern this increment.

## 1. Purpose, context and boundary

The authenticated dashboard is a read-only presentation of accessible requirements and recorded delivery activity. Its actors are workspace viewers and users already permitted to open run chat. Existing catalog, execution records, permissions and chat journeys remain external authorities. The dashboard does not start/stop work through search, selection or refresh and does not grant chat access.

Scope includes catalog discovery, per-requirement activity/progress, focus, six-path fleet, summary/right telemetry, visual composition and state recovery. Excludes API/schema/migration changes, scheduling, token collection, new analytics, production deployment and remote Git operations. Existing React/TypeScript–Java/PostgreSQL application is a compatibility constraint, not reselected architecture.

## 2. Normative system requirements

All SYS-D requirements are Must/P0, Confirmed for this increment. Actor is authenticated dashboard user unless stated; triggers and exact outcomes are below. AC-D references retain the corresponding PRD acceptance; UAT references are in BRD.

| ID | Trigger / system obligation | Validation, exception and acceptance | Trace |
|---|---|---|---|
| SYS-D01 | On opening or refreshing, the system shall present every accessible catalog requirement once | Complete paginated retrieval; stable name order with identity tie-break; no-run and history-only entries retained; empty inventory distinguished from loading | PR-D01 / AC-D01 / UAT-D01 |
| SYS-D02 | On search/filter change, the system shall show catalog entries matching both criteria | Trim query, case-insensitive name substring; All includes every state; Running/Blocked/Queued use exclusive current classifications; no match offers reset; selection remains unchanged | PR-D02 / AC-D02 / UAT-D02 |
| SYS-D03 | On valid snapshot, the system shall classify each requirement using current operational records before history | Blocked > Running > Queued precedence; no-run Not started; history-only uniform terminal status or mixed Recorded history; assigned roles/future dependency waits alone cannot create Running/Blocked | PR-D03 / AC-D03 / UAT-D03 |
| SYS-D04 | The system shall display actual active and waiting agent responsibilities with current stage/node context | Agent/coordinator tasks only; online operational running/leased tasks are active; waiting_reply separately labeled; terminal/old waves never active; show all parallel contexts or an accessible expansion | PR-D04 / AC-D04 / UAT-D03 |
| SYS-D05 | The system shall show per-requirement current or explicitly historical resolved-step progress | Highest wave per node identity per run, then aggregate applicable runs; rounded resolved/total percent; no denominator means —; history excludes invented newest ordering | PR-D05 / AC-D05 / UAT-D03 |
| SYS-D06 | Selecting a row or ship shall set the same requirement focus and scope live telemetry | Second selection replaces focus; selecting the selected item may clear it; explicit All clears focus; refreshed accessible non-operational selection persists; removed/revoked selection clears; list remains globally browsable | PR-D06 / AC-D06 / UAT-D04 |
| SYS-D07 | The fleet shall show one ship per operational requirement on six preserved tilted paths | Empty slots draw no fabricated ships/wakes; pager handles excess ships; selected live row reveals its sector; stable alerts and stationary list actions remain available | PR-D07 / AC-D07 / UAT-D05 |
| SYS-D08 | Activating a permitted blocker action shall navigate to its eligible blocked run chat | Prefer a blocked run with chat capability; unavailable capability gives no enabled shortcut; rose alert has text/symbol; navigation does not claim chat connection ownership | PR-D08 / AC-D08 / UAT-D05 |
| SYS-D09 | Summary/right telemetry shall disclose and reflect aggregate or selected operational scope | Default requirement count=catalog size, selected=1; other live metrics exclude terminal runs; selected no-live-run metrics zero with No live run; tokens Not reported; artifacts deduplicated by ID | PR-D09 / AC-D09 / UAT-D03–04 |
| SYS-D10 | The dashboard shall render the accepted visual hierarchy and recognizable ship branding | Summary strip, left list, center sphere, right cards; navy glass/mint-cyan/rose accents; duplicate lower roster removed; sample values not seeded | PR-D10 / AC-D10 / UAT-D06 |
| SYS-D11 | The dashboard shall expose operable responsive and accessible controls | Keyboard search/filter/list/chat, independent list scroll, visible focus, text status, non-overflow at specified local sizes, reduced-motion alternative | PR-D11 / AC-D11 / UAT-D06 |
| SYS-D12 | Refresh failures and access changes shall produce truthful safe states | No fabricated first-load zeros; last good snapshot labeled stale on ordinary failure; stale direct-chat shortcuts disabled until successful refresh; manual retry/next successful poll recovers; 401 clears and signs out; 403 clears protected dashboard snapshot, cache and selection | PR-D12 / AC-D12 / UAT-D07 |

## 3. Logical data and precedence

| Term | Requirement-level meaning |
|---|---|
| Catalog | Requirements returned under existing viewer permissions; identity is stable even after rename |
| Operational run | Recorded state queued, preparing, running, waiting or needs_attention |
| Current node | Highest recorded wave for each node identity within a run; a repair supersedes its older wave for current-state calculations |
| Resolved current node | Current state complete, completed, succeeded or skipped; skipped counts as resolved, not as evidence of successful execution |
| Active task | Current unresolved-node agent/coordinator task in running or leased state on an online operational run; deduplicate task identity |
| Waiting task | Current-node agent/coordinator task explicitly waiting_reply; distinguish from executing and future assigned role |
| Blocked run | Operational run waiting/needs_attention, offline device, or current-node waiting_reply/needs_attention/failed; future dependency-blocked nodes alone do not alert |
| Applicable row runs | All operational runs for that requirement when any exist; otherwise all recorded terminal runs with Recorded history context |
| Historical context | No assumed latest run, no active agent, no operational ship or live attention metric |

Stable row status: any blocked operational run → Blocked; else any operational run beyond queued/preparing → Running; else operational runs → Queued; else no runs → Not started; else all terminal runs same status → Completed/Failed/Stopped; else → Recorded history. Progress uses applicable row runs and current nodes. A live repair may reduce progress when previously resolved work is reopened; this is truthful, not an error. Current agents with absent display names use a neutral role-kind label, never a fabricated named agent.

Summary scope differs deliberately from list scope: the inventory/filter counts always remain global; selection changes the summary requirement count to one and other metrics to that requirement's operational runs. The selection label states No live run when appropriate. All scope uses all operational runs of accessible catalog requirements; orphan runs without visible catalog entries must not leak requirement names.

## 4. External interface requirements

| Interface / existing owner | Business data and timing | Failure / fallback |
|---|---|---|
| Requirement catalog / existing configuration service | Identity, name and allowed actions; initial and refreshed complete inventory | Ordinary failure retains marked stale snapshot; access denial clears protected content |
| Run read service / existing execution service | Run identity/state/device, stages/node waves/task roles/progress, artifacts and allowed actions | No guessed missing details; refresh remains atomic at snapshot level; retry available |
| Existing requirement/chat navigation | Selected requirement ID or permitted blocked run ID on user action | Existing route authorization and chat operator controls remain authoritative |
| Browser input/preferences | Keyboard/touch, viewport and reduced-motion preference | Responsive reflow and static reduced-motion formation; all textual controls remain usable |

No new hardware, outbound notification, payment, vendor or machine-to-machine interface is introduced. No protocol payloads or endpoint contracts are defined here; design references existing interfaces.

## 5. Quality and operational requirements

| ID | Measurable requirement / retained constraint | Trace |
|---|---|---|
| NFR-D01 | Preserve visible-page refresh every five seconds plus manual refresh; avoid overlapping loads and abort departed-page requests | SYS-D12 |
| NFR-D02 | Preserve bounded concurrent detail requests and reuse unchanged terminal details; never partially replace a successful snapshot with an incomplete one | SYS-D01, SYS-D12 |
| NFR-D03 | Motion remains capped by existing rendering limits; preserve 30fps cap and pixel ratio cap 2; no React state update per animation frame | SYS-D07, SYS-D10 |
| NFR-D04 | At 1440×1000, 1280×800 and 390×844 local checks, no horizontal page overflow or unreachable controls; list independently scrolls with overflow data | SYS-D11 |
| NFR-D05 | Keep 52×52 CSS-pixel independent fleet alert targets with hover/focus pinning; stable list action complements them; keyboard focus remains visible | SYS-D08, SYS-D11 |
| NFR-D06 | Loading, unknown and stale states must remain distinct from measured zero; no unsupported token/cost chart | SYS-D09, SYS-D12 |
| SEC-D01 | Preserve server permission authority; escape all user names/labels; no new sensitive storage/logging/sharing; authorization failures clear stale protected content | SYS-D08, SYS-D12 |

Browser/version evidence must name the environment actually checked; no broad certification is inferred. New availability SLA, capacity target, retention policy, legal compliance commitment, infrastructure backup or disaster recovery are Not Applicable to this presentation-only change. Existing application recovery and retention remain unchanged.

## 6. Verification, risks and readiness

Tests must cover mixed catalog lifecycle, parallel agents/runs, repeated node waves, offline activity, assigned-only roles, unknown denominator, history focus, filter/selection independence, stale/recovery/access denial, ship clearance and direct chat permission. Visual and interaction evidence is separate from arithmetic/unit evidence. A passing build alone does not satisfy the visual/behavioral criteria.

Input, source/scope, requirement quality, interface/data, NFR, traceability and boundary quality gates: **Pass for scoped FRS/design progression**. PR-D01–12 map one-to-one to SYS-D01–12; all BRD obligations remain covered through PRD. No material unresolved system decision. API availability and final runtime/browser validation remain execution dependencies, not invented pass evidence. Product scope is user-authorized; release approval and final visual acceptance are not asserted. Version 1.0; changes to current/history or permission semantics require synchronized downstream updates.
