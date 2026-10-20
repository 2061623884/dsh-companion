# Review: independent runtime 0.3.0

## Read-only WorkBuddy reuse: 0.3.3

Standards and Spec reviewed the diff from fixed baseline 734fa697074e6de9fda8ab0dfb4618e1bc10e6f0 to implementation 79522ca independently. Each reported zero remaining actionable findings. Spec additionally checked native acceptance commit 66dca1d for unintended desktop writes/network operations and found none. All 23 automated checks and the installed native account/Webview acceptance passed; see docs/validation.md.

Standards: the composed credential adapter isolates ownership selection, expiry and logout protection from editor/sidebar code. The build-time seam checks the pinned upstream version and exact construction site; no prototype patch or shared writable desktop directory is introduced. Spec: existing independent login takes priority, borrowed refresh tokens are stripped, source updates are re-read, expiry fails clearly, and borrowing never refreshes/writes/deletes desktop credentials. The real account validation made catalog/billing reads only, with zero login/refresh/generation requests and an unchanged source credential. Long-term independent renewal remains outside the approved read-only scheme. No push or publication.

## Startup I/O optimization: 0.3.2

Standards and Spec were reviewed separately by parallel agents against fixed baseline 1b0fc84, through implementation commit 1ecf493. Both reported zero remaining actionable findings. Standards confirmed that dependency bundling stays in the clean runtime preparation step, and handshake EOF retry stays inside RuntimeClient with host spawning limited to missing/refused pipes. Spec confirmed preservation of all nine TypeBox entry points, declarations and shared state, with no replay of application requests or change to desktop ownership.

All 21 automated checks, typecheck and packaging passed. The final installed 0.3.2 entry matched the build hash; its TypeBox export/behavior contract passed with 26 reads. A native VS Code Webview run using that installed runtime reached authenticated readiness in 3,118ms, displayed the notice, dismissed it 296ms after clicking and verified persistent acknowledgement. Reviews explicitly preserve the evidence boundary: synchronous file reads explain most of the reproduced 23.676s wait, but the OS-level cause and elimination of long disk-cold openings remain unproven. No push or publication.

## Windows confirmation fix: 0.3.1

Reviewed separately on Standards and Spec axes against baseline 153fe72. No remaining actionable findings on either axis. Runtime directory normalization remains inside RuntimeClient; the connection/sidebar interfaces and desktop ownership boundaries are unchanged. The actual lowercase-drive settings regression, restart persistence and real Webview button flow now have explicit coverage. All 19 automated checks and typecheck passed; the expanded active-old-version lease check also passed after the final user-facing message change.

An active old-version window retains its tasks and receives no forced shutdown. A new version fails promptly with a reload instruction in that situation. After all old leases release, the new version waits through save/exit grace. Review confirmed this existing lifecycle choice rather than introducing a long blind wait. Startup performance limits are recorded in docs/validation.md; no claim is made that the occasional long first cold start is fully eliminated.

Fixed baseline: 0a6610a8987c1cadff75605616e6576b96e151df. Standards and Spec were reviewed by separate parallel agents; confirmed findings were repaired and each axis rechecked. Current contract: docs/spec.md and AGENTS.md. No push or publication.

## Standards

Four confirmed findings were repaired: retain the owner pipe until the owned process exits after saving; preserve safe shutdown errors; register the initial client before boot so rapid failures remain visible; clean unique temporary attachment files if an atomic replacement fails. Final review found no remaining actionable Standards issues.

RuntimeConnection retains start/reconnect/dispose as its interface. RuntimeClient owns the control lease, host owns bootstrap/lifecycle, and import owns migration. EditorContext and ReferenceController remain independent of runtime details; DSH object and DOM assumptions stay in the private browser adapter. The review found no new actionable coupling, interface leakage or speculative abstractions.

## Spec

Four confirmed findings were repaired: retry only the attachments referenced by eligible historical sessions; wait for an old version's last-client shutdown before launching its replacement; retain safe diagnostics for control-bind failure; validate existing destination attachments and atomically repair incomplete files before marking a retried session imported. Final review found no remaining actionable Spec issues.

The real bundled-runtime fixture now completes a previously skipped session, introduces a new desktop session and corrupts an existing destination attachment. Restart imports only the original skipped ID, excludes the new session, repairs the attachment, and preserves Companion configuration. The final affected check passed in 16.03s. Earlier full automated suite: 18 passed. Independent-home coexistence was additionally verified after extending the cold-start check.

Standards: 4 resolved, 0 remaining. Spec: 4 resolved, 0 remaining. Verification limits remain explicit in docs/validation.md; no account login, paid generation or official desktop simultaneous-window acceptance is claimed.
