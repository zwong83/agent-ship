# Dashboard theme correction

Date: 2026-11-16. Branch: `codex/dashboard-command-center`.

The user rejected the first implementation's visual fidelity and requested a correction against the approved image. This refinement retains the approved requirements and behavior; it does not introduce new backend features.

## Visual changes

- Blue glass panels with specular edges, stronger lighting and navy depth, retaining mint controls and rose attention states.
- Compact summary, headings and requirement rows. Each row shows the requirement, current executing agents, stage/node and recorded progress; a disclosure retains parallel execution details.
- Larger transparent blue sphere with a luminous rim, brighter cyan orbital wakes and the approved agent sailboat artwork.
- Persistent ship nameplates replace numeric callsigns. Their layout stays within the scene and avoids other nameplates; displaced labels have connectors. Full names remain available on hover/focus and in the list.
- Existing independent 52px red alert targets and direct permitted chat navigation remain intact. Motion, depth, reduced-motion behavior and six orbital paths are preserved.
- Existing catalog, selection scope, polling, permissions and unavailable-token states remain based on actual API data.

## Verification

TypeScript validation, Vite production build and Java 21 Maven packaging passed. All ten frontend test suites passed; see [test output](evidence/theme-correction-tests.log). The new nameplate test samples two complete orbital cycles at six desktop/mobile scene sizes and checks bounds and pairwise separation. Existing hull separation and alert-target tests also pass.

Browser checks used the local Java/PostgreSQL application with an isolated synthetic preview account. Desktop checks at 1280×800 and 1440×1000 confirmed the three-column composition and six visible ships. At 1280px, the measured scene is approximately 510×500px; the existing density thresholds therefore allow six ships. Mobile checks at 320px and 390px confirmed no horizontal document overflow and two ships per sector. Selecting a requirement scoped telemetry while retaining the catalog. Expanded execution details exposed the current agents. Activating a red alert opened its permitted blocked run's chat without acquiring control or sending a message.

Screenshots contain synthetic local records, not invented production telemetry:

- [1280px dashboard](evidence/theme-corrected-1280.jpg)
- [1440px dashboard](evidence/theme-corrected-1440.jpg)
- [320px dashboard](evidence/theme-corrected-320.jpg)

The synthetic account was signed out and its active preview runs retired after verification. The current application was repackaged for normal local startup. The earlier [verification report](verification.md) is retained as historical evidence for the broader functional checks.

This correction was visually inspected against the reference; it is not a claim of pixel-identical reproduction, all-browser certification, or measured GPU performance. The production backend test suite was not rerun because this correction changes frontend presentation and label layout only. No remote push, merge or production deployment was performed.
