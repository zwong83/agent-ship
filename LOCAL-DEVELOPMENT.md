# Running AgentShip on this Windows computer

The current website uses React, TypeScript, Java 21, Spring Boot, and PostgreSQL.
The Node application in `src/` and `web/` is a historical prototype.

## Start the current website

From the repository directory in PowerShell 7:

```powershell
./scripts/start-local.ps1
```

To rebuild after changing the source:

```powershell
./scripts/start-local.ps1 -Build
```

Stop any running copy first. The website runs at http://127.0.0.1:4173.
Press Ctrl+C in its terminal to stop it. PostgreSQL remains running for reuse.

## Local installation

- Java 21 is installed under `%LOCALAPPDATA%/AgentShip/runtime/`.
- The startup script selects this JDK without changing other projects' Java settings.
- PostgreSQL 16 uses a separate cluster under `%LOCALAPPDATA%/AgentShip/postgres-data/`.
- The database listens only on `127.0.0.1:55432`.
- Database: `agentship`. Local development role: `agentship_dev`.
- The generated database password and registration verification key are kept in the ignored `.agentship/` directory.
- Database logs are in `%LOCALAPPDATA%/AgentShip/postgres.log`.
- Existing PostgreSQL databases on port 5432 are independent of this installation.

The startup script is configured for this machine and requires the installed runtimes above.
It uses local HTTP. Contact verification is temporarily disabled.

## Create an account

Open the website, select **Create account**, and enter your registration details.
Passwords must contain 8–128 characters, including a lowercase letter, an uppercase
letter, a number, and a symbol. Confirm password becomes available when all requirements
are met. Email and phone number are optional; supplied values must be valid. Select **Create account**,
then sign in immediately with your username (or your email if you provided one).
No email or phone verification step is shown.

The backend setting `AGENTSHIP_REQUIRE_CONTACT_VERIFICATION` defaults to `false`.
The local startup script explicitly disables it. Verification code remains available
for later re-enablement. When enabled, it requires verification of supplied phone numbers and email
verification only when an email was supplied. Disabling verification does not mark
contacts as verified and does not activate previously pending registrations.

Migration V6 makes email nullable, preserves uniqueness for supplied emails, and
records whether verification is required for each new account. Existing account
data and verification timestamps are preserved. Registration and personal-project
creation remain in one transaction. No new datastore or indexes are needed.

Prototype accounts are stored separately and are not migrated into PostgreSQL.

## Configure delivery

Create the required roles on **Agents**, then create a workflow on **Workflows**.
Add named stages and nodes, select a coordinator and the required sub-agents, and
finish with an end node. Check nodes require both pass and repair routes.

Node **Basics** contains only name and type. Enable **Workflow behavior → Gather
requirement details** for steps that collect a missing requirement description.
The description must be present before that step can finish.

Configure **Agents → Agent permissions → Workspace access** to allow reading or
editing workspace files. New agents default to read-only. Check coordinators
always remain read-only. Agent versions and effective permissions are pinned
when a workflow version is saved; editing an agent does not alter existing runs.

Migration V8 preserves historical requirement-gathering flags and materializes
each assignment's previous file access. Existing agents show **Preserve existing
assignments**, since one agent could previously have different access in different
nodes. Resaving those assignments preserves their access. The old API `purpose`
field remains accepted for compatibility, but new configuration uses
`collectRequirements` and `workspaceAccess`. Workers must use the updated build
to enforce explicit workspace permissions.

Run `platform/test/verify_workflow_permissions.py` with `--java` and
`--postgres-bin` paths for isolated PostgreSQL, HTTP dispatch, scheduling and
worker permission checks. Supply `--baseline-jar` with a pre-V8 build to also test
the historical migration.

Open **Local devices** to pair a worker. Use the generated command on the computer
that will execute the run. Pairing alone does not enable Git or agent execution.
Choose the appropriate execution mode on that page. Real GitHub mode requires a
locally configured GitHub token; real agent execution requires a locally signed-in Codex.

Start a run by selecting a requirement, work type, and saved workflow. Runs remain
bound to their original computer. The dashboard shows progress, blockers, agent results,
and artifacts. **Run controls** provides chat and authorized recovery actions.

## Checks performed during setup

- TypeScript compilation and Vite production build.
- Java 21 compilation and executable Spring Boot packaging.
- All five Flyway migrations applied to PostgreSQL.
- Registration, dual-channel verification, login, authenticated access, and logout via HTTP.
- The current English sign-in page loaded in the browser.

Real GitHub and Codex execution require separate acceptance checks with your selected repository and local worker.


## Fleet dashboard

The command center uses the approved navy, mint and cyan glass theme with a compact
navigation bar, summary strip, requirements catalog, orbital fleet and telemetry.
The **All** list includes every accessible requirement, including unstarted and
historical work. Search and Running/Blocked/Queued filters affect only the list.
Each row shows recorded progress, actual executing agents and stage/node context;
expand current activity to inspect parallel agents or agents awaiting a reply.
Unknown progress is shown as unavailable, and historical progress is labeled.

Select a row, ship or scope dropdown to focus telemetry on that requirement's live
runs. The catalog stays available. Clear focus to restore all operational runs.
No-run and completed requirements remain selectable without inventing live work.
Focus survives rename/completion and clears when catalog access is removed.

The fleet always has six tilted circular paths around a transparent sphere. It
shows six ships when the shorter scene dimension is at least 500px, four at
430–499px, and two below 430px. Paging makes every live requirement reachable.
The shared 84-second cycle preserves projected separation. Approved agent sailboats
move through front/rear depth and leave glowing wakes on their own paths. The
separate roster grid has been replaced by the requirements list; ship names remain
visible in separated nameplates, with full names available on hover/focus and in
the list. Independent 52px alert targets pin on hover/focus while
ships continue moving. Red alerts and row chat buttons open the permitted blocked
run's chat; they do not acquire chat control or send a message. Queued ships have
gray beacons, running ships green, blocked ships red.

Progress uses current node waves. Activity uses actual online agent/coordinator
tasks on unresolved current nodes, not assigned roles. Tokens remain **Not reported**
until the service supplies usage telemetry. The dashboard refreshes every five
seconds while visible, limits detail reads to four, and caches unchanged terminal
details. Failed reads retain a clearly stale snapshot and disable direct chat;
401/403 clear protected data. Reduced-motion preferences produce a static formation.
Rendering remains capped at 30fps and DPR 2, with effect cleanup on exit.

The scoped [delivery index](output/dashboard-command-center/README.md) links the
BRD, PRD, SRS, FRS, SA, SD, implementation evidence and verification report. Run all
focused frontend suites from the repository in PowerShell:

```powershell
Get-ChildItem frontend/test -Filter '*.test.mjs' | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test failed: $($_.Name)" }
}
npx.cmd --prefix frontend --no-install tsc --project frontend/tsconfig.json --noEmit
```

`platform/test/dashboard_preview.py` is an optional local-only synthetic fixture
helper for the running Java/PostgreSQL site. It creates its own test account and
recorded runs without executing GitHub or Codex. Create `.agentship/stop-dashboard-preview`
to stop its heartbeats and retire only its own unfinished runs. Synthetic metadata
stays under ignored `.agentship/`; these records are not production agent evidence.

The current dashboard places the scrollable requirements table below the central
fleet, with three telemetry cards on either side. Workflow progress counts current
resolved nodes; Recent activity displays persisted run/task events with timestamps,
scoped to the selected requirement or all current runs. If no current runs exist,
the activity card labels its historical records. Its run-detail payload is limited
to 30 events per run and the card shows the latest 30 across its scope.

After starting the local stack and generating a dashboard preview fixture, run
`python platform/test/verify_dashboard_activity.py` for real API/database timestamp
and access-isolation checks. See the [layout delivery addendum](output/dashboard-command-center/bottom-layout-delivery.md).
