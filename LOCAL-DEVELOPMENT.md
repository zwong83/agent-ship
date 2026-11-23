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
Agent configuration includes **Local agents & skills**, a searchable list of
installed agent workflows and skills. Select an entry to connect its skill;
empty name, role ID and instruction fields on a new agent receive suggestions.
Existing edits and saved agent fields are preserved. Manual skill references
remain available for other workers.

The local launcher enables `AGENTSHIP_LOCAL_CATALOG_ENABLED=true`. Discovery
requires a signed-in, direct loopback request and reads only bounded `SKILL.md`
frontmatter from the server user's `~/.agents/skills` and `$CODEX_HOME/skills`
(default `~/.codex/skills`). It does not execute or install skills, expose absolute
paths or skill bodies, or inspect arbitrary browser-supplied directories. It skips
symlinks and malformed files, deduplicates names with `.agents/skills` first, and
reports partial scans. The setting defaults to disabled for shared deployments.
This is the library on the **AgentShip host**, not automatic discovery from a
remote browser or paired worker. Codex still checks skill availability at run time.

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

The workspace uses a compact top navigation. Dashboard telemetry defaults to all
running requirements (including queued, preparing and blocked runs); completed,
stopped, failed and unstarted requirements are excluded. Selecting a requirement
ship scopes every card to its live runs. Ships can be searched and paged without
changing the selected scope. Clearing the selection restores the aggregate view.
The dashboard refreshes every five seconds while visible, limits detail requests
to four concurrent calls, and reuses unchanged terminal runs. A failed refresh
marks the retained snapshot as stale; authorization failures clear it.

Requirement status, agent tasks, resolved steps, blockers, artifacts, repair
cycles and assigned-device connectivity come from the existing APIs. Token usage
is explicitly shown as not reported because the execution service does not yet
persist token counts. No token or cost estimates are synthesized.

The center is a large transparent holographic sphere with no geographic Earth.
The scene always displays six distinct tilted circular orbital paths. Up to six
live requirement ships occupy them on wide desktops, four on tablets and two on
phones. Empty paths do not fabricate agents or wakes. Coordinated phases share an 84-second cycle so separation cannot drift; ships follow perspective-projected 3D circles through both
hemispheres, bank gently with the tangent, shrink/dim behind the translucent glass and
pass in front when approaching. Wakes use the same projected curve and split into
a fading center trail and two spreading ripples. Render depth places rear hulls
below the glass and front hulls above it. Numbered stationary name cards preserve
readability and keyboard access when paths cross in projection. Ships and cards
focus telemetry, and red dots retain direct chat access. Fleet paging never changes
aggregate telemetry.
The approved navy-and-mint agent sailboat image is shared by the fleet, sign-in,
account creation, workspace brand and browser icon. Its mast stays upright with
a gentle bank so the agent face remains recognizable. Medium-small 76px hulls
have a screen-space size cap at close projected crossings.
The alert HUD is independent of ship depth, with separated 52px hit targets above
the glass. Pointer hover or keyboard focus pins an alert in place while its ship
keeps moving. A connector identifies its ship. Every blocked requirement also has
a stationary red chat button in its name card, subject to existing permissions.
Selected paths brighten and blocked paths turn red. Rendering is capped at 30
frames per second and pixel density at 2. OS reduced-motion preferences render a
static formation. Frames, observers and listeners clean up on exit.

Green beacons indicate in-progress requirements; red beacons indicate blockers
or offline execution devices. A red beacon opens the blocked run's chat directly
when the existing API permission permits it. Existing chat connection ownership
still applies. Future dependency waits do not trigger false red alerts. The
scrollable Live execution card supplies stationary, keyboard-accessible controls
and lists current stages, nodes, coordinators and assigned agents, including
parallel nodes. Stale snapshots are explicitly labeled and use muted beacons.

Run `node frontend/test/dashboard-model.test.mjs` for aggregation, scope and
blocker checks, and `node frontend/test/earth-formation.test.mjs` for six distinct circular planes, 360-degree loops, front/back perspective, tangent headings, exact wakes and empty-slot rendering checks.
