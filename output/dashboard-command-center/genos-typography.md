# Genos typography

Implemented 2026-11-16 at the user's request. The shared typography layer uses
locally bundled Genos variable normal/italic faces and retains the current colors,
materials and motion. Font source and SIL Open Font License are stored with the
assets in `frontend/public/fonts/genos/`.

Page headings use 700, card headings 650, buttons and metrics 600, labels 500 and
body text 400. Small operational labels were enlarged for Genos's compact letter
forms. Code and copyable terminal commands retain their monospaced face.

Validation: TypeScript, Vite production build, Java packaging and whitespace checks
passed. The packaged local font returned HTTP 200 (135,320 bytes). Browser inspection
confirmed the Genos family and distinct heading sizes/weights on the dashboard;
workflow library and create-agent layouts were visually inspected. Dashboard at
390px and registration at 320px had no horizontal document overflow. No account,
agent or workflow was created during these checks. The existing preview account
was signed out afterward. No new automated tests were added for this typography-only
change; full functional and backend suites were not rerun.

Evidence: [dashboard](evidence/genos-dashboard.jpg),
[mobile dashboard](evidence/genos-dashboard-mobile.jpg),
[sign in](evidence/genos-sign-in.jpg).
