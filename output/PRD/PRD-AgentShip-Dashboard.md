# PRD — AgentShip Dashboard Command Center

Version 1.0 · 2026-11-16 · Scope: dashboard redesign increment
Source: [BRD v1.0](../BRD/AgentShip-Dashboard/BRD-AgentShip-Dashboard.md) and the user's explicit instruction to deliver the selected design through testing. Owner: requesting repository user. Authoring role: Product Agent. Status: user-authorized scoped requirements baseline; formal production release and final user visual acceptance are not claimed.

## 1. Overview

Give workspace users one readable command center for discovering every accessible requirement, understanding its actual current activity and progress, and reaching blocked-agent conversations. Preserve the live six-path sailboat sphere and the accepted navy/mint dimensional identity.

## 2. Problem and evidence

The user finds the current cards insufficiently futuristic and wants a default scrollable requirement list showing current agents and progress. The current dashboard derives its inventory from operational runs, excluding unstarted and terminal requirements. Assigned roles can also be confused with agents actually executing. The accepted [visual reference](../dashboard-command-center/approved-dashboard.jpg) defines composition and styling; its sample numbers are not production values.

## 3. Users and constraints

Primary user: an authenticated workspace user with existing requirement/run visibility. Their task is to inspect work and follow permitted actions, not gain new access. No new persona research, commercial targets, locales, or permissions are introduced. English content, existing routes, existing ship artwork and current local web platform are retained.

## 4. Goals and success evidence

| Goal | Acceptance evidence | Outcome metric status |
|---|---|---|
| G1 Discover all available work | Controlled inventory appears in All, including unstarted and terminal items; long lists scroll | Adoption/time-saving baseline not supplied; no invented target |
| G2 Understand actual activity | Agent/state/progress reconciliation against recorded fixtures | Correctness is the release criterion |
| G3 Resolve blockers | Authorized stable row action and red dot reach the same blocked run chat | No resolution-time SLA supplied |
| G4 Deliver accepted visual identity | Desktop/mobile screenshots and keyboard review against approved reference | User retains final visual acceptance |

## 5. Stories and journeys

| Story | User outcome | Main and alternate paths |
|---|---|---|
| US-D1 | As a workspace user I want every available requirement in a scrollable list so I can find work without an active run | Open dashboard → All inventory → scroll/search/filter; empty and no-match states explain next action |
| US-D2 | I want each row's current agent, stage/node and progress so I know what is happening | Inspect running/parallel work; distinguish queued, blocked, unstarted and recorded history |
| US-D3 | I want to focus on a requirement without losing the inventory | Select row or ship → same focus → clear scope; a non-operational selection truthfully has no live telemetry |
| US-D4 | I want stable, permission-aware access to a blocked conversation | Row Open chat or red alert → existing chat; denied capability exposes no active chat shortcut |
| US-D5 | I want a readable futuristic dashboard that stays truthful when data fails | Accepted appearance and responsive layout → stale warning/retry; expired access clears protected data |

## 6. Functional requirements and acceptance

Every row is P0 (required for this increment), Confirmed within the user-authorized scope, and Included. No lower-priority expansion is introduced. The requesting user owns scope; frontend delivery owns these read-only user journeys. `AC-Dxx` is the acceptance oracle for its matching requirement.

| ID / story / goal | Requirement and trigger | Acceptance (normal and exceptional) | BRD source |
|---|---|---|---|
| PR-D01 / US-D1 / G1 | Opening Dashboard defaults to All accessible requirements in one scrollable list | AC-D01: every returned catalog item appears once, including no-run/history-only items; list header/search remain available; zero catalog items shows an explicit empty state | BR-D01, RULE-D01–02 |
| PR-D02 / US-D1 / G1 | Search by requirement name and filter All, Running, Blocked or Queued | AC-D02: trimmed case-insensitive name search combines with status filter; counts reflect full inventory before search; no match can be reset; filters never silently change selected telemetry | BR-D02, RULE-D05 |
| PR-D03 / US-D2 / G2 | Each row displays its name and truthful lifecycle/activity status | AC-D03: operational blocked outranks running, running outranks queued; no run is Not started; history-only is explicitly historical and never appears live | BR-D03, RULE-D02–03 |
| PR-D04 / US-D2 / G2 | Show actual active agents and current stage/node information | AC-D04: only online operational running/leased agent/coordinator tasks on current unresolved nodes count as active; waiting agents are labeled separately; parallel execution remains inspectable; assigned roles alone do not claim activity | BR-D03, RULE-D03 |
| PR-D05 / US-D2 / G2 | Show recorded resolved-step progress and denominator | AC-D05: current runs aggregate per requirement, excluding historical runs when current work exists; no denominator displays —; history-only progress is labeled Recorded history; mockup percentages are never seeded | BR-D03, RULE-D04–05 |
| PR-D06 / US-D3 / G2 | Row and ship selection share a single requirement focus | AC-D06: same ID yields same scope; selecting another replaces focus; clear returns aggregate; list remains searchable; focus survives refresh while accessible, including no-run/history-only requirements | BR-D04, RULE-D05 |
| PR-D07 / US-D3 / G4 | Preserve six tilted paths and operational sailboat animation | AC-D07: one ship per operational requirement, no historical/no-run ship; six paths remain even if empty; continuous motion, separation, wakes and front/back depth remain; reduced motion is respected | BR-D05, RULE-D02 |
| PR-D08 / US-D4 / G3 | Display blockers and permission-aware direct chat controls | AC-D08: rose alert plus text/symbol, stationary Open chat and independently clickable red dot target an eligible blocked run; absent chat capability yields no enabled direct-chat action; controls never claim connection ownership | BR-D06, BR-D11, RULE-D06 |
| PR-D09 / US-D2–3 / G2 | Show a summary strip and scoped telemetry cards | AC-D09: default requirement count is full accessible catalog; selected count is one; active tasks, attention runs and workflow steps derive from operational scope; non-operational focus shows zero live counts, not historical agents; token usage remains Not reported | BR-D07, RULE-D05, RULE-D07 |
| PR-D10 / US-D5 / G4 | Apply the accepted dimensional navy/mint visual composition | AC-D10: nav/header/summary strip, left inventory, center fleet, right telemetry; approved ship image; no duplicate name-card roster under sphere; list replaces its stationary selection/chat function | BR-D08, RULE-D08 |
| PR-D11 / US-D5 / G1–4 | Retain accessible responsive operation | AC-D11: keyboard can reach search, filters, list selections and chat controls; status is not color-only; narrow layout preserves all content without horizontal page overflow; independent list scroll is operable | BR-D09 |
| PR-D12 / US-D5 / G2 | Report loading, stale, empty and denied data honestly | AC-D12: initial loading has no fake zero counts; refresh failure retains a clearly stale snapshot; retry recovers; 401 clears protected data and returns to sign-in; 403 clears inaccessible dashboard data; stale direct-chat shortcuts are disabled until successful capability refresh | BR-D10–11, RULE-D07 |

### Product defaults and state semantics

These are explicit bounded delivery decisions implementing the BRD, not new business policies. Operational states are queued, preparing, running, waiting and needs_attention. Existing operational blocker rules include actionable waits and offline devices; future dependency waits alone do not create a blocker. A requirement is Blocked if any operational run is blocked, otherwise Running if any operational run is beyond queued/preparing, otherwise Queued. All includes every lifecycle state; the other tabs contain only the named operational category. No-run items read Not started.

If no operational run exists, all returned terminal runs form Recorded history; do not infer which is latest. Uniform terminal history reads Completed, Failed or Stopped as applicable; mixed terminal history reads Recorded history. This summary does not assert a current failure. Historical task flags never produce an active agent or live attention count.

For each run, current step/status/activity uses the highest recorded wave for each node identity. Older repair waves do not inflate the current progress denominator or leave a false blocker/active agent. Progress is rounded resolved current nodes / total current nodes × 100; resolved includes complete, completed, succeeded and skipped. Artifacts may include deduplicated outputs across recorded waves; repair counts use current check records. Search affects inventory visibility only. Fleet remains an operational workspace overview with the selected requirement highlighted; selection of an operational row on another fleet page reveals its page. Selection of a non-operational row preserves the fleet context and explains No live run in its focused telemetry. Default and focused telemetry scope labels stay visible. Returning to All clears focus but preserves deliberate list search/filter choices.

## 7. Non-functional requirements

Retain five-second visible-page refresh and manual retry, bounded concurrent reads, cancellation on exit and cached unchanged terminal detail. Preserve semantic controls, visible focus, keyboard scrolling, text alternatives, 44px minimum touch actions where layout permits and the existing independent 52px fleet-alert targets. Respect reduced motion while normal mode remains continuously animated. Verify desktop 1440×1000, narrow desktop 1280×800 and mobile 390×844; these are local verification sizes, not a new cross-browser support claim. No horizontal page overflow at those sizes. User text remains escaped; no new telemetry collection or personal-data sharing.

## 8. Technical and data constraints

Reuse existing authorized catalog/run information and existing chat/requirement routes. No new API, schema, permission, token-accounting service or external dependency is required by product scope. Preserve current backend authority. Detailed projection and component ownership belong to SRS/SA/SD.

## 9. UI/UX and content

The accepted image governs full-width navigation, dimensional navy-blue glass, mint/cyan lighting, muted text and rose blockers. Use depth, controlled highlights and readable progress; do not hardcode illustrative data. At narrow widths stack the inventory before fleet and telemetry so discovery remains primary. Keep each row's full name available, expose parallel agent/stage information without losing the primary title/progress, and pair any truncated preview with an accessible way to inspect complete text. Empty fleet and empty catalog are distinct states. Tokens without telemetry read Not reported, never 0.

## 10. Exclusions

BRD exclusions apply: no scheduling/workflow edits, permission or auth policy changes, execution service, token estimates, account redesign, AI office implementation, deployment, remote push or merge. Supplied mockup values and fixture identities are not production requirements.

## 11. Milestones and gates

BRD → PRD → SRS → FRS → SA/SD → implementation → testing. All P0 requirements require traceable evidence. Dates/budget are not committed. This scoped sequence is already authorized; document readiness is distinct from production release approval.

## 12. Risks

Concurrent runs and stale task flags can mislead ownership/progress: use explicit scope and test parallel/history/offline cases. Heavy glow can reduce legibility: compare real rendered screenshots and focus controls. Large catalogs can hide rows: verify scrolling/search and full paginated retrieval. Access changes can expose stale data: clear on authorization errors and retain server checks.

## 13. Readiness, coverage and open questions

BR-D01→PR-D01; BR-D02→PR-D02; BR-D03→PR-D03–05; BR-D04→PR-D06; BR-D05→PR-D07; BR-D06→PR-D08; BR-D07→PR-D09; BR-D08→PR-D10; BR-D09→PR-D11; BR-D10→PR-D12; BR-D11→PR-D08/12. RULE-D01–08 are covered by the source column and explicit semantics. UAT-D01–07 retain their BRD meaning.

Quality gate: input readiness, product clarity, scope/prioritization, complete functional coverage, requirement quality, decision readiness and technical-boundary checks **Pass for scoped SRS progression**. No material product decision is unresolved. Unprovided commercial KPIs and broad production support/SLA commitments are out of this increment, not hidden blockers. No additional stakeholder signature is invented. Runtime test evidence and final user visual acceptance remain downstream. Version 1.0 is the initial scoped baseline; material scope changes must update this document and dependent requirements.
