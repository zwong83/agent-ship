# FRS — AgentShip Dashboard Command Center

Version 1.0 · 2026-11-16 · Author: Product Agent · Owner: requesting repository user
Sources: [SRS v1.0](../SRS/SRS-AgentShip-Dashboard.md), [PRD v1.0](../PRD/PRD-AgentShip-Dashboard.md), [BRD v1.0](../BRD/AgentShip-Dashboard/BRD-AgentShip-Dashboard.md), explicit user authorization to deliver the selected dashboard through testing. Status: scoped functional baseline ready for design and implementation under that authorization. Final user visual acceptance and production release are not claimed.

## 1. Scope and shared preconditions

These eight features cover the authenticated dashboard only. A viewer has an existing session and sees only catalog/run data authorized by existing services. Search, filters, focus, paging and refresh are local/read-only actions. No workflow, permission, chat ownership, persistence, retention, execution, migration or token-accounting policy changes are allowed. Each functional requirement is P0/Must, Confirmed within this dashboard increment. Existing dependency data is authoritative; sample screenshot values are not.

## 2. Shared rules and state model

| Rule | Exact behavior |
|---|---|
| R-D01 Current scope | Operational run states: queued, preparing, running, waiting, needs_attention. Per requirement use all operational runs when present; otherwise all terminal runs form explicitly Recorded history. No assumed latest run ordering. |
| R-D02 Current nodes | Within each run, the highest wave of each node identity is current. Current progress, blockers and active/waiting agent calculations ignore superseded node waves. |
| R-D03 Row precedence | Any blocked operational run → Blocked. Otherwise any operational run beyond queued/preparing → Running. Otherwise operational work → Queued. No runs → Not started. Uniform terminal history → Completed/Failed/Stopped. Mixed terminal history → Recorded history. |
| R-D04 Blocker | Operational run waiting/needs_attention, offline device, or a current node waiting_reply/needs_attention/failed. A future dependency-blocked node alone is not an alert. |
| R-D05 Progress | Resolved states: complete/completed/succeeded/skipped. Percent = rounded (resolved current nodes / all current nodes × 100) over applicable row runs. Show resolved/total steps alongside percent. Zero denominator → — / Progress unavailable, not 0%. No-run row also says Not started. History says Recorded history. A repair can truthfully reduce percent. |
| R-D06 Agent activity | Current unresolved-node agent/coordinator tasks running or leased on online operational runs are active; waiting_reply is separate waiting activity. Deduplicate task identities by runId:taskId. Names come from task role display name, otherwise neutral Agent/Coordinator label. Merely assigned roles, terminal runs, superseded waves, future nodes and offline devices cannot claim active execution. |
| R-D07 Selection | One requirement ID is selected or none. Inventory/search/filter counts remain global. Default telemetry operational aggregate; selected telemetry only its operational runs; a non-operational selection has No live run and zero live counts. Requirement summary count is full catalog by default, one when selected. |
| R-D08 Telemetry | Unique artifacts may count across all recorded waves of scoped operational runs; repairs use current check records; devices deduplicate by identity. Missing token telemetry remains Not reported. No fake measured chart, value or zero. |

Ordinary refresh replaces data only after a complete successful snapshot. User selection/filter actions during refresh remain effective; polling does not reset them except when the selected catalog identity is no longer accessible. No business data is created/changed by these features. There are no notification transmissions or new retention rules.

## 3. F-D01 — Discover and scroll requirements

Sources: SYS-D01, SYS-D10–11; PR-D01/10/11; UAT-D01/02/06. Actor: authenticated viewer. Trigger: dashboard entry or completed refresh.

- FR-D01.1: Show all accessible requirements once, sorted by displayed name with ID tie-break. Default filter is All and query empty on initial page entry.
- FR-D01.2: Present name, explicit lifecycle status, current activity/context and progress for every row. Keep no-run and terminal entries discoverable.
- FR-D01.3: Keep the list header, filters and search available while its entries independently scroll. Long inventories remain reachable by pointer, touch and keyboard.
- FR-D01.4: With a valid empty catalog show No requirements yet and the existing Start requirement entry; with no snapshot show loading/unavailable, not a false empty catalog.

Acceptance F-AC01: Given eight accessible requirements spanning running, blocked, queued, unstarted and terminal states, All exposes all eight and each ID once; scrolling reaches the final row; no live run is needed for inclusion. No prohibited requirement becomes visible. Short and empty lists require no artificial scrollbar content.

## 4. F-D02 — Search and filter

Sources: SYS-D02; PR-D02; UAT-D02. Trigger: query edit, filter activation or reset. Preconditions: catalog snapshot available; stale mode may filter the retained marked snapshot.

- FR-D02.1: Search matches requirement name by trimmed case-insensitive substring; empty/whitespace query matches all names. Search is not regex or command execution.
- FR-D02.2: All, Running, Blocked and Queued use R-D03. All includes lifecycle states absent from the other three filters. Counts describe global catalog membership before the query is applied.
- FR-D02.3: Query and filter intersect. No matches gives an explicit No matching requirements state and a reset action restoring All plus an empty query.
- FR-D02.4: Search/filter does not change selected requirement or scoped telemetry. A selection hidden by filtering remains named in the scope control and can be cleared.

Acceptance F-AC02: Query '  API  ' finds 'API delivery'; combining it with Blocked excludes a running API entry; no-match reset restores inventory; focusing another requirement before search leaves that focus unchanged.

## 5. F-D03 — Inspect current agents, stages and progress

Sources: SYS-D03–05, SYS-D09; PR-D03–05; UAT-D03. Trigger: snapshot render/refresh.

- FR-D03.1: Derive row classification with R-D01–04 and expose current vs recorded-history context in text.
- FR-D03.2: Display active agent names only under R-D06. If none, say No active agent; an explicit waiting task may instead be described as Waiting for reply, never Executing. Queued work may say Waiting to start or Preparing without fabricating a working agent.
- FR-D03.3: Show relevant current stage/node names for parallel work. A compact primary line may show one context plus a count, provided all concurrent contexts and agents are accessible through expansion or an equally operable detail presentation. Assigned coordinator data must be labeled assigned if shown without active task evidence.
- FR-D03.4: Apply R-D05 to known current nodes. Keep the numeric percentage and resolved/total meaningful; no denominator yields —. Keep history-only progress explicitly historical and active counts zero.

Acceptance F-AC03a: One current resolved node and one current running node yields 50%, 1 of 2 steps. An older resolved wave of the running node does not change denominator or falsely resolve it. A historical failed wave superseded by a running wave does not leave a blocker.

Acceptance F-AC03b: Two online running/leased agent tasks in parallel expose both names; an assigned-only third role is not active. Moving the device offline changes the requirement to Blocked and removes the active-execution claim. A completed run whose last task still says leased is never active.

Acceptance F-AC03c: A live run plus completed/failed history uses only live progress; a history-only mixed-status requirement reads Recorded history and is not assigned a fictitious latest state. No runs means Not started and —.

## 6. F-D04 — Focus and restore aggregate telemetry

Sources: SYS-D06/09; PR-D06/09; UAT-D04. Trigger: row/ship selection or All scope control.

- FR-D04.1: Row and ship selection of the same ID yield the same requirement focus. Selecting a different item replaces it; selecting the same item again or choosing All clears it.
- FR-D04.2: Keep catalog list/counts independent of focus. Update live summary/right telemetry to selected operational runs; clearly display the selected requirement name. No-run/history-only selection remains valid with No live run and zero live metrics.
- FR-D04.3: On successful refresh retain focus while its catalog ID exists, even if its runs become terminal. Clear focus if the ID disappears/revokes. Renaming updates display text without losing focus.
- FR-D04.4: Selecting an operational requirement outside the currently visible fleet sector reveals its sector. Selection does not start a run, mutate a requirement or connect an operator.

Acceptance F-AC04: Focus A from row, then B from ship; numbers follow the correct operational runs while the list stays global. Select an unstarted row and refresh; selection remains, live metrics remain zero. Clear selection restores global operational totals without clearing deliberate search/filter state.

## 7. F-D05 — Fleet presentation and accessible alerts

Sources: SYS-D07/08/10/11; PR-D07/08/10/11; UAT-D05/06. Trigger: valid catalog/run snapshot, animation frame or user navigation.

- FR-D05.1: Retain six tilted circular paths around a transparent sphere, continuous normal-motion sailing/wakes, front/back depth and medium-small separated approved agent-ship artwork. A ship represents one operational requirement across its concurrent runs. Empty paths do not invent data.
- FR-D05.2: Keep blocked alerts rose with an exclamation/text cue; running and queued states remain distinguishable. Future dependency waits do not manufacture red alerts. Stale snapshots label status as last known.
- FR-D05.3: Alert targets remain independent of hull depth and at least 52×52 CSS pixels. Hover or keyboard focus pins the alert target while its ship continues moving. The stationary left-list action remains available.
- FR-D05.4: Preserve paging for more live requirements than the current screen's ship capacity; all catalog rows remain available regardless of page. Remove the duplicate name-card roster beneath the sphere, since the left list provides stable selection/chat.
- FR-D05.5: Reduced-motion preference gives a static formation with fully operable selection/chat; empty live fleet has a truthful no-live-work state even when catalog requirements exist.

Acceptance F-AC05: Six operational fixtures occupy six distinct paths; a seventh is reachable through paging and list focus. A historical/unstarted catalog entry creates no ship. Alert target stays above sphere and focus pins only its target. Existing geometric separation evidence must remain valid for changed scene sizes.

## 8. F-D06 — Open blocked chat

Sources: SYS-D08; PR-D08; UAT-D05. Actor: viewer with existing chat capability for an operational blocked run.

- FR-D06.1: Choose a blocked run with existing open-chat capability when one exists; stable row action and red alert navigate to that same run's existing chat page.
- FR-D06.2: If blocked runs exist but none permit chat, show unavailable access rather than an enabled direct-chat control. Never create/assume permission from selected requirement ownership.
- FR-D06.3: Activating an action does not connect to agents, send a message, take over an operator or bypass destination authorization. Those remain explicit existing chat-page actions.

Acceptance F-AC06: With two blocked runs, one permitted, both shortcuts reach the permitted run. Without capability neither shortcut offers an executable chat action. A denied destination shows the existing denial flow; dashboard never grants access.

## 9. F-D07 — Summary, telemetry and accepted composition

Sources: SYS-D09–11; PR-D09–11; UAT-D03/04/06.

- FR-D07.1: Summary strip displays Requirements, Active agents, Needs attention and Workflow steps. Requirements count follows R-D07; remaining live metrics follow scoped operational runs. Agent count reflects unique active tasks (agent/coordinator work), not configured role count. Attention counts blocked runs, with label/copy making this unit clear when multiple runs share one requirement.
- FR-D07.2: Right-side Agent activity shows actual executing/waiting task counts; Token consumption says Not reported; attention lists actionable blocked requirements/runs; Delivery output displays recorded artifacts and online/assigned devices. No fake token graph or sample numbers.
- FR-D07.3: Use the approved navy-blue dimensional glass, mint/cyan highlights, rose alerts, top navigation, compact header and three-column desktop composition. Narrow layouts prioritize inventory, then fleet and telemetry, preserving all controls and content.
- FR-D07.4: Status/selection has text and semantic state, not color alone. Full names and parallel context remain inspectable; input controls have accessible names; numeric progress has an accessible label/value when available.

Acceptance F-AC07: Reference comparison identifies the approved hierarchy and asset; no duplicate lower roster. Zero active work displays zero only after valid load, while unknown token usage stays Not reported. At local desktop/mobile verification sizes there is no horizontal overflow or clipped action; keyboard traversal can filter, select and open permitted chat.

## 10. F-D08 — Refresh, stale data and access recovery

Sources: SYS-D12, NFR-D01/02/06, SEC-D01; PR-D12; UAT-D07.

- FR-D08.1: Initial load shows loading indicators and unknown counts. A first-load failure shows unavailable/retry, not a valid zero inventory.
- FR-D08.2: Retain existing five-second visible-page polling and manual refresh. Do not overlap loads; abort departed-view reads. Publish a fresh snapshot only after all required catalog/run reads finish successfully. Do not reset list scroll or search/filter/focus on ordinary refresh.
- FR-D08.3: An ordinary refresh failure retains the last good snapshot with visible stale/connection-interrupted state and last successful update time. While stale, retain last-known text but suppress executable direct-chat shortcuts until a successful refresh revalidates capability. Recovery replaces the snapshot, restores eligible actions and clears the stale message.
- FR-D08.4: Authorization failure differs from transient failure: 401 clears protected data/cache/selection and returns to sign-in; 403 clears protected dashboard data/cache/selection and displays access error. Do not keep stale protected names after either denial.
- FR-D08.5: Repeated/late responses from a superseded load cannot overwrite newer state or restore removed access. Local selection/filter changes during refresh are preserved according to F-D04.

Acceptance F-AC08: Empty success, first failure, stale retained success, recovered success, 401 and 403 each have distinct visible outcomes. No user action implies a refresh changed workflow execution. Leaving the dashboard prevents later completion from updating the departed view.

## 11. Traceability, quality gate and handoff

| FRS feature | SRS | PRD | BRD UAT |
|---|---|---|---|
| F-D01 | SYS-D01/10/11 | PR-D01/10/11 | UAT-D01/02/06 |
| F-D02 | SYS-D02 | PR-D02 | UAT-D02 |
| F-D03 | SYS-D03–05/09 | PR-D03–05 | UAT-D03 |
| F-D04 | SYS-D06/09 | PR-D06/09 | UAT-D04 |
| F-D05 | SYS-D07/08/10/11 | PR-D07/08/10/11 | UAT-D05/06 |
| F-D06 | SYS-D08 | PR-D08 | UAT-D05 |
| F-D07 | SYS-D09–11 | PR-D09–11 | UAT-D03/04/06 |
| F-D08 | SYS-D12 | PR-D12 | UAT-D07 |

Input, source/scope/actor, functional behavior, acceptance/traceability, quality/boundary and decision-readiness gates: **Pass for scoped design/implementation handoff**. All SYS-D01–12 and PR-D01–12 have acceptance coverage. No material open functional decision remains. Detailed component/layout/API inheritance and verification allocation belong downstream; no implementation or test verdict is asserted by this document. Read-only features create no new audit/retention/notification obligation. Version 1.0; any changed progress, state precedence, permissions or focus semantics must update PRD/SRS/FRS and related cases together.
