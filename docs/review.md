# Structure review: 0.4.0-preview.3

The product remains a Desktop client. The review identified legacy independent-runtime source mixed into `src/`, a misleading runtime name for the authenticated Desktop proxy, and VSCE scanning large ignored fixture trees. Legacy source now lives in `tests/fixtures/legacy-runtime/`; the proxy is `DesktopConnection` under `src/desktop/`; packaging stages only the distributable files. Editor acceptance profiles use OS temporary directories, outside the repository's Node package scope: CLI installation of both old and new VSIX files succeeds there, while the old editor can crash during module resolution under the repository. Existing consumers were updated directly, without compatibility aliases or another facade.

Update checks sit behind `DesktopUpdates.check()` and do not depend on the proxy, editor or browser adapter. The extension owns notification presentation and lifetime. Existing `EditorContext`, `ReferenceController` and `SidebarView` retain their focused responsibilities. The private DSH DOM integration remains in `sidebar/client/`, because upstream UI changes still require explicit compatibility work.

The reported transient console was traced to an unrelated periodic background health task and corrected at that task's launcher. Desktop discovery and background launch already use hidden subprocesses; the regression checks preserve that behavior. No speculative process launcher, global window-hiding mechanism or duplicate runtime was added.

This is a scoped local review, not a claim that arbitrary future Desktop versions remain compatible. Validation commands and local evidence are recorded separately.

# Historical review: 0.3.7

## Shared login closeout

Scoped source review retains the existing independent runtime, migration and provider adapters. The only new upstream adaptation replaces the pinned account initializer's mismatched-issuer deletion with an explicit error; version and source checks reject upstream drift, and packaging preflight rejects an unprepared runtime. The editor receives a bounded error without credential values or platform URLs. Account settings are not inferred from the credential. Source and synthetic fixtures cover preserved grant bytes, corrected-configuration retry, shared sign-out, lifecycle and packaging gates; original per-test deadlines and multi-client assertions remain. The native installed-package runner requires shared-login results in both supported editor versions. Publication behavior is unchanged, and previous uncommitted release work remains preserved.

## Local candidate materials and rehearsal

Standards and Spec independently reviewed the working-tree changes/new files against b2a684e8140b2eab5eab37111dba3bc1871e17ee and the local release-material requirements in docs/spec.md. Spec found no implementation gaps. Standards identified scan-document staging accumulation; the finally cleanup now removes only the fresh scan's files and empty directory, with both successful scan and canary rejection covered. Re-review found no remaining actionable issues. Product source, extension identity/version and desktop ownership are unchanged. The local-only generator, external expected commit/hash checks and GET-only rehearsal do not implement upload, tag or Release writes.

## Installed first-use readiness

Standards and Spec independently reviewed the minimal welcome/input readiness correction against 91f9af953dd1f1a3e6a66df336d45a6189268d17 and found no actionable issues. The test waits for actual acknowledgement and an interactive composer, then confirms text is present before testing send feedback. It retains the original HTTP interceptor, timeouts, assertions and two-editor coverage. The corrected actual VSIX passed local acceptance on both 1.106.0 and 1.124.2; strict checks and all 30 unit cases passed. Hosted verification remains a separate gate.

## Hosted installed-package diagnostics

Standards and Spec separately reviewed the bounded diagnostic changes against 9d4bc3e6fab0b920fdcee154c17ec46a020d9388 and found no actionable issues. Only numeric phase/frame/prompt fields are exposed on failure, with explicit output bounds; raw logs remain ignored/local. Assertions, timeouts, two-version installation coverage and no-upload permissions are unchanged. Both editors passed the local rerun; that does not establish the cause or resolution of the hosted failure.

## Hosted public compiler-path collision

Reviewed the correction against 71cc2e14164ea5e8b4621e474d6ff05a77513fca. Standards review found no actionable issues. Spec review found the path-policy sentence had not documented the exact public-prebuild exception; the specification was synchronized with the existing privacy/release documentation. File path and content hash both remain required, workspace paths always fail, and scanner rules are unchanged. Synthetic regressions and the original archive reproduction passed; hosted validation remains separately required.

## Verify-only release preparation

Reviewed the working-tree changes and new files against 47957b57388ee7a75c3c2e80595ed3d38f059eee and docs/spec.md's release-preparation requirements. Separate Standards and Spec agents reviewed the change. Confirmed findings were fixed: archive validation now shares an explicit content-only personal-path predicate; native tests share the synthetic WorkBuddy profile fixture; outbound counters derive from observed requests with only the catalog/billing read endpoints permitted; and workspace binding is checked against the actual persisted synthetic session cwd after runtime shutdown. No production adapter or editor interface learned release/test details. Version metadata, CI admission, archive policy and installed-package acceptance retain separate responsibilities; no publication mode or speculative provider interface was added.

Native execution found test CLI-layout/interception coverage issues, which were corrected without changing product code; both editor versions passed actual installed-package acceptance. Final Standards and Spec re-reviews of those corrections reported zero remaining actionable findings. Validation evidence and the explicit hosted-run limitation are in docs/validation.md. No commit, push, artifact upload, tag or Release is part of this delivery.

## Native hosted acceptance follow-up

Reviewed the bounded phase diagnostics and bilingual test setup against ddf0203c7d4b524a265c2d59610eeeea3e6095b8, including diagnostic commit 45f3ed2 and the working-tree locale fix. Independent Standards and Spec reviews each found zero remaining actionable issues. The trace reuses fixed numeric stage/visibility fields and timeout reports only stage/visibility/counts. Locale settings are asserted through RPC in a new synthetic owned home; no production UI or contributor preferences change. The same real Webview, file sizes, intercepted responses, feedback threshold and failure-restoration assertions remain. The raw probe wire encodes visibility as 0/1 in the existing numeric bytes field and converts it to a boolean locally; the spec does not require a new production protocol field.

## Hosted CI repair

Reviewed the working-tree follow-up against 03e3b89a1b9a80531f8497b020da95071887e4f8 using docs/spec.md's Hosted CI follow-up requirements. Independent Standards and Spec reviews each found zero remaining actionable issues. The change backdates only the owned runtime's freshly signed cookie by one second and keeps its encoded lifetime at five minutes; HMAC/authority checks and no-replay behavior remain. A real-runtime synthetic child-clock regression covers authentication discovery and RPC. The cold-start test registers connection cleanup before startup, including failure paths. No desktop data/credentials, dependency versions, installation package or workflow timeouts were changed. The actual VM clock offset was not measured; docs/validation.md distinguishes the hosted failures from the deterministic clock reproduction.

## GitHub checks, stage one

Reviewed the working-tree delta against 7608f3c56ca8a08d89918ba4ac1b02ebf7a534a4, including new untracked CI files. Standards and Spec were reviewed independently by parallel agents against docs/spec.md and the repository ownership, privacy and minimal-change rules. No product modules, runtime dependency locks, installed extension or desktop data were changed.

Standards: one confirmed finding resolved, zero remaining. The source privacy expression initially missed a literal user home root without a following separator. It now detects both Windows separators and Unix/macOS home roots; synthetic regression cases cover the omission. The CI tooling stays in small preparation/check scripts; existing build, integration and native runners remain the behavior owners. Native editor preparation now preserves underlying download errors instead of suppressing them through SilentReporter.

Spec: one confirmed finding resolved, zero remaining. The existing pinned public WorkBuddy Git dependency used an SSH URL; workflow-scoped Git environment entries now translate it to anonymous HTTPS without modifying the lockfile revision or contributor Git configuration. A credential-free isolated environment with SSH disabled verified that transport. Read-only permissions, non-persistent checkout credentials, full Action commit pins, verified tool archives, npm-only caches and native main-only triggering were retained. There is no packaging/upload/publication step or repository-rule mutation. Local execution evidence and its hosted-run limits are recorded in docs/validation.md.

## Cold-start file access round: 0.3.6

Reviewed against the preserved 0.3.5 source snapshot, excluding earlier uncommitted reliability/maintainability work from this round's delta. HEAD remains d78e3ef45aab2065aadb37a14d7b5ef8111f4d9f; no new commit or push. Standards and Spec were reviewed independently by parallel agents against docs/spec.md and the ownership, privacy and minimal-change rules.

Standards: one confirmed finding resolved, zero remaining. The first Zod single-file prototype pulled classic initialization into core-only imports. A fresh-subprocess core/custom-locale/mini/classic regression first failed, then passed after introducing separate entry groups with shared chunks. Re-review closed the finding: root imports keep v3/mini lazy, registry identity is shared, and classic initializes its locale at the original point. CommonJS facades preserve original detected ESM export names and SemVer deep identity. Preparation stays in one dedicated build module; host/client/sidebar interfaces and production startup code are unchanged. The suspected repeat-build failure was withdrawn after confirming that build:runtime does not invoke the clean-only bundler; prepare-runtime itself always starts with npm ci.

Spec: zero confirmed functional findings. Only the four measured pinned library graphs are transformed at preparation time; licenses/declarations/entry paths remain. Preflight checks every output/facade hash plus real public contracts. No plugins/providers, desktop files, independent storage, borrowed authorization rules or visible UI behavior were changed. Measurements distinguish the new 12.534s reproduction, unavailable detailed trace of the older 16.6s run, repeated process starts and artificial slow-file replay. No claim of a disk-cold bound is made. The non-blocking core-only parse-cost observation was measured explicitly; three local samples improved from 34–37ms to 12–23ms without OS cache flushing.

Final verification after repair: strict checks, 24 unit tests, 12 integration tests, both native acceptance runners, real dependency/preflight contracts and the root-only clean-source gate all passed. Secret scans included the newly generated code. Actual measurements and their limits are in docs/validation.md. Standards: 1 resolved, 0 remaining. Spec: 0 functional findings, 0 remaining. No commit, push or publication.

## Maintainability round: 0.3.5

Reviewed the second-stage delta against the preserved 0.3.4 working-tree snapshot, rather than attributing the previous uncommitted reliability fixes to this stage. The snapshot manifest SHA-256 is a9d83500c35d6a600e76350be86ebd66db1cc9e4d8eaa95d0a2a9af9b1807120. Standards and Spec were reviewed independently by parallel agents against the Maintainability round in docs/spec.md, repository ownership/privacy rules and the minimal-change requirement. HEAD remains d78e3ef; no commit or push was made.

Standards: zero actionable findings. The private adapter now composes transport, input/reference and layout modules, with narrow pinned upstream contracts and explicit disposal. The outer frame script is checked source, not a handwritten HTML script body. Strict TypeScript/checkJs includes runtime and build preparation without importing the installed DSH dependency tree. A proposed non-Error rejection concern was withdrawn after checking the pinned workspace/session/gateway implementation: its documented failures extend Error, and the preexisting error.message handling is unchanged. No speculative defensive fallback was added.

Spec: one scope finding resolved, zero remaining. A bulk version edit had unnecessarily changed a transitive lockfile declaration; it was restored while keeping the project release at 0.3.5 and resolved dependencies unchanged. The fast build/unit gate no longer prepares runtime files. Integration and native gates remain explicit; native workspaces and VS Code profiles are generated and isolated. Preflight detects incomplete/stale runtime artifacts without repairing them. Desktop data ownership, read-only authorization and existing UI/functionality are preserved.

Final verification includes 24 unit and 11 integration checks, both native acceptance runners, the clean-source/no-runtime fast gate and real browser send/status-card acceptance. Timing limits and the remaining variable cold-start delay are recorded in docs/validation.md. Standards: 0 findings. Spec: 1 resolved, 0 remaining.

## Reliability round: 0.3.4

Fixed baseline d78e3ef45aab2065aadb37a14d7b5ef8111f4d9f to the working tree; no new commits. Standards and Spec were reviewed by separate parallel agents against the Reliability round section of docs/spec.md and the existing ownership/privacy rules.

Standards: one boundary finding was repaired. The provider status-card expression and locale assumptions originally lived in runtime preparation; they now belong to tests/fixtures/legacy-runtime/workbuddy-status.mjs behind adaptWorkBuddyStatusClient. The preparation script calls that private compatibility boundary, checks the pinned provider construction/status seam and fails on incompatible anchors. Re-review closed the finding and found no remaining actionable standard or cohesion/coupling issue.

Spec: zero actionable findings. The review checked protocol validation, adapter-only readiness, startup cancellation/deadlines, owner retention during shutdown, atomic migration records and non-destructive corruption failure, borrowed authorization usability/expiry and preservation of desktop ownership. No stage-two dependency/CI/framework work was introduced. Startup and first-send conclusions remain bounded by the measurements in docs/validation.md: a slow file-access startup reproduced, while native synthetic first-send acceptance did not reproduce a freeze. No model-latency or disk-cold upper-bound claim is made.

Standards: 1 resolved, 0 remaining. Spec: 0 remaining. Typecheck/build, the full 31-test suite, the later added mid-retry cancellation check, real bundled-provider HTTP checks and native/browser UI acceptance passed. No commit, push or publication.

## User-independent discovery and privacy hardening

Standards and Spec reviewed baseline a58f610cc993a2d08abcd49b92758ba1c76ca744 through 39367f0 separately: zero actionable findings on each axis. The diff adds sensitive-file exclusions, documents user-derived discovery and provider adapter placement, and tests isolation between synthetic custom homes; no runtime behavior was changed or hypothetical authorization framework introduced. Affected tests passed. Secret/history/archive scans and their scope limits are recorded in docs/validation.md. No push or publication.

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

DesktopConnection retains start/reconnect/dispose as its interface. RuntimeClient owns the control lease, host owns bootstrap/lifecycle, and import owns migration. EditorContext and ReferenceController remain independent of runtime details; DSH object and DOM assumptions stay in the private browser adapter. The review found no new actionable coupling, interface leakage or speculative abstractions.

## Spec

Four confirmed findings were repaired: retry only the attachments referenced by eligible historical sessions; wait for an old version's last-client shutdown before launching its replacement; retain safe diagnostics for control-bind failure; validate existing destination attachments and atomically repair incomplete files before marking a retried session imported. Final review found no remaining actionable Spec issues.

The real bundled-runtime fixture now completes a previously skipped session, introduces a new desktop session and corrupts an existing destination attachment. Restart imports only the original skipped ID, excludes the new session, repairs the attachment, and preserves Companion configuration. The final affected check passed in 16.03s. Earlier full automated suite: 18 passed. Independent-home coexistence was additionally verified after extending the cold-start check.

Standards: 4 resolved, 0 remaining. Spec: 4 resolved, 0 remaining. Verification limits remain explicit in docs/validation.md; no account login, paid generation or official desktop simultaneous-window acceptance is claimed.
