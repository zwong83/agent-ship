# BRD — AgentShip Dashboard Command Center

| Document control | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-11-16 |
| Mode / scope | Brownfield dashboard change; business requirements |
| Business decision source | Requesting user in the current AgentShip chat |
| Delivery branch | `codex/dashboard-command-center` |
| Status | User-authorized scoped baseline for downstream requirements and delivery; not a production-release sign-off |
| Intended reviewers | Requesting user; downstream product, design, implementation and testing contributors |
| Delivery phase | Dashboard redesign increment |

## 1. Business context and source authority

AgentShip helps developers coordinate requirement delivery through agent workflows. The current dashboard presents operational requirements as ships and distributes summary data among telemetry cards. Its requirements list is secondary, and its visual treatment did not meet the user's desired futuristic appearance. Developers need to identify available requirements, see who is working on each one and how far it has progressed, and reach a blocked agent's conversation without chasing a moving target.

The governing change request is the user's request for a default scrollable requirements card with the current running agent and progress, followed by approval of the latest attached dashboard design and the instruction: **“Fine.. I prefer this. Create a new branch and start brd, prd until testing.”** This explicit instruction authorizes the scoped lifecycle work. It is not merely inferred from the presence of an image.

The accepted visual reference is [approved-dashboard.jpg](../../dashboard-command-center/approved-dashboard.jpg), copied from `1-Pasted-Image-1.jpg` in attachment folder `E1015500-D123-431F-AFB5-29FCFAFEBE33`. It shows full-width navigation, a summary strip, a prominent requirements list on the left, a six-path ship sphere in the center, and telemetry on the right. Its navy glass panels, mint/cyan lighting, soft off-white text and rose alerts govern this increment. Mockup numbers and names are illustrative, not promised live values.

Prior chat decisions continue to govern recognizable agent sailboats, independent orbital paths, medium-small ships with separation, continuously moving wakes, accessible blocked-chat controls and real recorded telemetry. Earlier broad MVP documents remain historical context; unrelated unresolved deployment, billing or execution policies are not reopened by this dashboard-only change.

## 2. Objectives and success evidence

| ID | Business outcome | Observable success evidence | Business KPI status |
|---|---|---|---|
| OBJ-D01 | Make available work discoverable from the dashboard | Every accessible requirement is reachable in the default list, including those without an active run | No time-saving or adoption target supplied |
| OBJ-D02 | Explain delivery progress and current responsibility | Each row identifies status, current agent activity and meaningful progress without implying that assigned or historical agents are currently executing | Acceptance evidence, not a fabricated productivity KPI |
| OBJ-D03 | Reduce friction in resolving blockers | An authorized user can open the relevant blocked requirement's chat from a stationary action or its red alert | No resolution-time target supplied |
| OBJ-D04 | Deliver the accepted futuristic visual identity consistently | Desktop and mobile review shows the accepted palette, hierarchy, glass depth and ship identity with readable controls | Visual acceptance against the supplied reference |
| OBJ-D05 | Preserve trust in operational information | Unavailable, stale and empty information is distinguishable from real zero values and running work | Reconciliation against controlled recorded data |

Research, analytics baselines, monetary benefit, delivery date and budget were not provided. They are not prerequisites for this bounded usability increment.

## 3. Stakeholders and responsibilities

| Role | Responsibility / boundary |
|---|---|
| Requesting user | Source of approved dashboard direction and final user acceptance |
| Developer / workspace user | Reviews requirements, focuses telemetry and follows permitted chat actions |
| Existing requirement/run access holders | Retain existing visibility and execution/chat rights; redesign grants no new rights |
| Delivery contributors | Derive traceable requirements, implement the authorized scope and retain verification evidence |

No additional organization owner, approver, service level, legal responsibility or production-release authority has been supplied or invented.

## 4. Scope and release boundary

**Included:** default all-available requirements discovery; a scrollable list with search and status filters; per-requirement status, current agents, stage/node and progress; coordinated selection between the list and live fleet; summary and telemetry presentation; permission-aware blocker entry points; accepted visual treatment; responsive and keyboard-accessible use; loading, empty, stale, error and unavailable-data states; scoped verification.

**Excluded:** changing workflow execution, scheduling, agent permissions, registration, backend authorization, chat ownership, deployment topology, payment or pricing; inventing token accounting; changing the requirement creation process; replacing the approved ship asset; implementing the separate AI office proposal; pushing or merging this new branch or production deployment without a further request.

The named release phase is the dashboard redesign increment. No delivery date, staffing allocation or commercial commitment is implied.

## 5. Functional business requirements

All rows below have **Priority: Must**, **Decision: Confirmed for the authorized scope**, and **Delivery: Dashboard redesign increment**. The explicit defaults in section 6 operationalize the user's direction without expanding business permissions.

| ID | Requirement and intent | Acceptance criterion | Dependency |
|---|---|---|---|
| BR-D01 | A workspace user must see the available requirement inventory by default in one prominent scrollable dashboard card | Default All view includes accessible requirements across their lifecycle; more entries than fit remain reachable by scrolling; no requirement needs an active run to appear | Accessible requirement inventory |
| BR-D02 | The inventory must support finding work without replacing the workspace context | Search and status filtering expose matching requirements, display an honest no-results state and allow return to All | BR-D01 |
| BR-D03 | Each requirement must explain its current activity and delivery progress | Row contains name, explicit status, active agent information, current stage/node where available, and recorded progress; unstarted and unavailable cases have truthful labels | Recorded requirement/run activity |
| BR-D04 | Users must be able to focus telemetry on a requirement from either its row or ship | Both routes identify the same selected requirement; summary/telemetry make the focus clear; clearing focus restores the aggregate view; inventory remains available | BR-D01, BR-D03 |
| BR-D05 | The fleet must retain the recognizable agent-ship visualization | Six tilted paths surround a transparent sphere; operational ships move continuously with wakes and remain separated; empty capacity does not invent live work | Existing operational run information |
| BR-D06 | Users must identify and reach actionable blockers reliably | Blocked status uses text and rose/red emphasis; permitted red alerts and a stationary list/card action open the relevant chat; unavailable chat access is not offered as an executable action | Existing chat permission and run linkage |
| BR-D07 | The dashboard must present useful summary and scoped telemetry | Requirements, active agents, attention and workflow progress/steps are labeled consistently; activity, token availability, attention and output/device information reflect their disclosed scope | BR-D03, BR-D04 |
| BR-D08 | The redesign must express the user's accepted visual identity | Navigation, summary strip, three-column desktop hierarchy, navy glass depth, mint/cyan lighting, rose alerts and approved agent ship match the accepted reference while preserving legibility | Latest accepted image and existing ship asset |
| BR-D09 | The dashboard must remain usable across supported input and viewport sizes | List, selection, scrolling, filters and chat actions work with keyboard and touch; narrow screens retain the information and avoid horizontal page overflow; motion preferences remain respected | Existing browser support |
| BR-D10 | Users must not mistake missing or outdated data for current execution | Loading, refresh failure, stale data, unavailable token usage, no requirements and no operational ships have distinct truthful states; recovery can refresh the view | Existing data freshness and failure behavior |
| BR-D11 | The redesign must preserve access and operational boundaries | Only accessible requirements and permitted actions are displayed; selection/filtering never starts, stops or changes a workflow; denied or expired access follows existing behavior | Existing authorization |

## 6. Cross-cutting business rules and explicit defaults

| Rule | Definition | Traces |
|---|---|---|
| RULE-D01 | **All available** means the requirements returned under the current user's existing visibility rights, including unstarted and terminal requirements. This is the delivery interpretation of the user's phrase; it does not mean all users' private work. | BR-D01, BR-D11 |
| RULE-D02 | Inventory and live-fleet scope are different. The inventory includes available requirements; a live ship represents operational work only. A queued operational run may occupy a path, but an unstarted catalog entry must not appear to be running. | BR-D01, BR-D03, BR-D05 |
| RULE-D03 | Current running agents are determined by recorded execution state. Assigned roles, waiting agents and previously completed agents must not be presented as currently running. Parallel current agents must not be silently collapsed into a false single owner. | BR-D03, BR-D07 |
| RULE-D04 | Progress is based on recorded workflow completion and its disclosed denominator, not animation, elapsed time or mockup percentages. Requirements with no workflow or no known denominator show **Not started** or **Progress unavailable (—)** as applicable, never an invented 0%. | BR-D03, BR-D07 |
| RULE-D05 | Default telemetry aggregates operational work; explicit selection scopes it to the selected requirement's applicable recorded work. History-only requirements remain discoverable with historical context and no live agent; they do not occupy the live fleet. The product specification must state current-versus-historical context clearly for non-operational selections and must not fabricate a latest-run ordering without timestamps. Filtering the list alone does not silently change telemetry scope. | BR-D04, BR-D07 |
| RULE-D06 | Red/rose status is accompanied by text or an alert symbol. Chat availability follows existing permissions; the stable list action complements the moving fleet alert. | BR-D06, BR-D09, BR-D11 |
| RULE-D07 | Missing token consumption remains **Not reported**. No projected token values, decorative usage charts implying measurements, cost estimates or mockup metrics are introduced. | BR-D07, BR-D10 |
| RULE-D08 | The current authorized product state and latest explicit user direction take precedence over older mockups or historical proposal text for this increment. The screenshot is a visual acceptance reference, not proof of data, a new API contract, or approval of production release. | BR-D08, BR-D10 |

Detailed calculation, precedence, filter membership and concurrent-run handling belong in PRD/SRS/FRS. They must preserve these business outcomes and identify routine defaults transparently.

## 7. Data, integration and non-functional needs

The view consumes existing accessible requirements, run status and history, stages/nodes, agent task activity, permitted actions, artifacts and device connectivity. It introduces no business entity, new contact information, retention rule, deletion policy or third-party sharing. Existing retention and access policies remain unchanged.

Business integration is limited to existing requirement creation and run-chat journeys and the existing operational data source. No external vendor or new service integration is required. A data-source failure must be visible and must not imply execution stopped or completed.

Usability requires readable names/status/progress, operable controls, visible focus and reliable scrolling. Motion supports the fleet metaphor while text and stable controls remain usable independently. Continuous normal-motion operation and existing reduced-motion preference handling coexist. Performance, refresh timing and precise viewport criteria are to be retained or measured in downstream design/testing; no unsupported service-level claim is made here.

Payments, commercial handling, fulfillment geography, reservations/capacity policies, outbound notifications, legal review, new backups and new administrative powers are **Not Applicable**: this increment changes dashboard presentation and discovery only.

## 8. Risks and dependencies

| Risk / dependency | Impact | Mitigation and responsible delivery role |
|---|---|---|
| Multiple runs or parallel agents | Misleading progress or ownership | Product/design define explicit scope; implementation/testing reconcile multi-run fixtures |
| Mockup values treated as real | False operational confidence | Use recorded data and explicit unavailable states; testing includes no-data cases |
| Heavy glow or overlapping ships | Poor readability and inaccessible alerts | Frontend design preserves contrast and spacing; verify stable alert controls and responsive layout |
| Inventory and fleet filter coupling | Requirements disappear unexpectedly | Product/design retain inventory independence; test list/selection/filter transitions |
| Stale or revoked data | Outdated or unauthorized display | Preserve existing stale/error and authorization handling; verify failure/access cases |
| Large available inventory | Slow or unreachable list items | Design/test scrolling and data loading with a larger inventory; no fixed business limit invented |

Likelihood and monetary impact have not been estimated. Existing operational data and permission behavior are dependencies; any discovered inability to meet the scope must return to the owning design/product decision rather than silently invent data.

## 9. UAT and delivery gates

| UAT ID | Scenario and expected result | Requirements |
|---|---|---|
| UAT-D01 | Open a workspace with running, queued, blocked, unstarted and completed requirements. All accessible entries appear or are reachable in the default scrollable inventory, with truthful states. | BR-D01, BR-D03, BR-D10, BR-D11 |
| UAT-D02 | Search/filter a long inventory, reach lower rows, clear filters and recover from no matches. Selection and inventory context remain understandable. | BR-D02, BR-D04, BR-D09 |
| UAT-D03 | Inspect requirements with parallel agents and multiple runs. Agent activity, stage/node and progress match the disclosed recorded scope, including no-active-agent cases. | BR-D03, BR-D07 |
| UAT-D04 | Select a row, select a ship, then restore All requirements. Focused metrics agree with the selection; the inventory remains available. | BR-D04, BR-D07 |
| UAT-D05 | Observe the fleet through front/back movement and use a blocked alert and stationary chat action. Paths, ship identity, spacing and permission-aware chat destination are preserved. | BR-D05, BR-D06, BR-D11 |
| UAT-D06 | Compare desktop and narrow-screen displays to the accepted reference and operate keyboard/touch controls. Accepted theme and content hierarchy remain clear without clipped controls or horizontal overflow. | BR-D08, BR-D09 |
| UAT-D07 | Exercise initial loading, empty inventory, no operational runs, failed refresh and lost access. The view reports the correct state and avoids fabricated telemetry or unauthorized content. | BR-D07, BR-D10, BR-D11 |

Delivery proceeds through BRD → PRD → SRS → FRS → analysis/design → scoped implementation → testing under the user's lifecycle instruction. Artifacts and evidence must remain traceable. All Must requirements need implemented behavior and retained verification evidence before claiming this increment complete. Visual review uses the accepted attachment plus runtime screenshots, and tests use clearly identified sample data. Test completion is not a production-deployment or merge authorization.

## 10. Decisions, authorization and change control

| Item | Status / source |
|---|---|
| Dashboard structure and latest visual direction | Confirmed by the user's preference and explicit instruction to start the delivery lifecycle |
| Default scrollable requirements card with current agent and progress | Confirmed by the user's preceding request |
| Ship metaphor, six paths, continuous motion and accessible red chat alerts | Confirmed by prior instructions; preserved within this increment |
| Scope execution through testing on a new branch | Authorized by the latest user request |
| Separate formal organizational sign-off | Not supplied; no such authority is invented or required by this bounded local delivery instruction |
| Push, merge, deployment or release acceptance | Outside this request; not claimed |
| Material unresolved business decisions | None identified for this dashboard increment. Routine detailed behavior must be specified downstream within the rules above. |

Version 1.0 establishes the scoped baseline. New business scope, permission changes, fabricated reporting or a different visual direction requires an explicit recorded user decision. Ordinary implementation choices remain with the authorized delivery workflow.

## 11. BRD quality-gate result

| Gate | Result | Evidence |
|---|---|---|
| Input readiness | Pass | Named brownfield change, explicit user problem, accepted reference and lifecycle authorization |
| Structure | Pass | Objectives, roles, scope, requirements, rules, data, risks, UAT and change control present; irrelevant commercial modules excluded with reasons |
| Requirement quality | Pass | BR-D01–11 have stable IDs, separate priority/decision/delivery statuses and observable acceptance |
| Decision readiness | Pass for scoped downstream drafting | Source authority and routine defaults are explicit; no fabricated owners, KPIs or unresolved material business policy |
| Delivery readiness | Pass for requirements/design progression | Must/UAT coverage defined; runtime implementation, verification and user visual acceptance remain future evidence |
| Boundary | Pass | No API schema, architecture, physical data model or implementation tasks included |

**Handoff:** product-agent may derive PRD, SRS and FRS for this user-authorized scope. This BRD reports readiness for that progression, not a test verdict or production-release approval.
