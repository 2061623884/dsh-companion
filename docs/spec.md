# Independent bundled runtime (0.3.0)

## Shared desktop credential store

Approved direction: Companion shares sign-in with desktop DSH the way the Codex extension shares its CLI login. No commit, push or publication.

- The Companion runtime uses desktop home's `.credentials.yaml` as its credential store via a host-written overlay; Companion home holds no credential copy. Sign-in, sign-out and API-key changes on either side apply to the other through the pinned store's cross-process lock and watched reload. Existing migrated homes adopt this on next boot.
- Migration no longer copies credentials. Sessions, settings and the WorkBuddy adapter are unchanged.
- Test with synthetic stores only: the desktop browser grant authenticates Companion's connection; a desktop DeepSeek account grant reads as signed in without a Companion login, and its removal on desktop signs Companion out live; cold start without desktop creates the store where desktop would own it. Never read or write the developer's real store in tests.
- Companion's pinned account initializer must preserve a grant whose issuer differs from its resolved platform origin. Report `DSH_ACCOUNT_PLATFORM_MISMATCH` to the editor and stop startup without exposing the grant or changing the origin; matching the account configuration must allow retry with the original grant. Prepare this narrow upstream change only in the bundled runtime and require it at packaging preflight.
- Run integration files sequentially to avoid unrelated complete-runtime startups contending for resources; preserve each test's deadlines and explicit concurrent-client assertions. Verify shared sign-in and extension-side sign-out through the actual installed sidebar in isolated VS Code profiles using synthetic credentials and intercepted network calls. Generate a new local package without installing into the contributor's normal profile, committing, pushing or publishing.

## Local release materials and dry run

Review baseline: b2a684e8140b2eab5eab37111dba3bc1871e17ee to the working tree including new files. Implement local candidate material generation, integrity/source checks and a read-only publication rehearsal. No commit, push, package upload, tag, Release or product/desktop changes.

- Reuse the exact VSIX after archive/privacy and installed-package acceptance; never rebuild or change its version during candidate preparation or rehearsal. Bind the package to its build-time Git commit, dirty state and current source-content digest; reject stale or mismatched reports/source.
- Emit exactly the VSIX, release.json, SHA256SUMS and release-notes.md in an ignored candidate directory. The checksum list covers the VSIX and both documents. Versioned user-facing CHANGELOG content supplies notes, alongside supported platform/editor versions, installation/checksum instructions and source identity. Only allowlisted metadata/counts/hashes are copied from reports; no raw diagnostics, machine paths, credentials or source text. Scan candidate documents as well as the already scanned VSIX.
- Local preparation is explicitly local evidence, including uncommitted work. Hosted material generation requires a clean main checkout matching the dispatch SHA and the exact CI gate receipt. This stage retains files on the runner only and adds no upload permission or step.
- Candidate checks require expected full commit and package SHA-256 from outside the candidate; reject altered files, unexpected entries/symlinks, source/version/hash/size mismatch and incomplete evidence. Existing candidate directories may be reused only for identical content.
- Preview is always a dry run, with no publishing implementation or write API. Offline preview does not claim verified GitHub provenance or remote version availability. Optional online preview uses GET only, verifies the exact CI/preparation runs and successful jobs on trusted main workflows, and rejects existing remote version tags/releases. Local tag conflicts also fail. Local/dirty evidence cannot pass online readiness.
- Test source/hash/version conflicts, invalid reports, extra private data, candidate reuse/conflicts, missing files and failed/untrusted hosted runs using synthetic fixtures; retain Standards and Spec review and distinguish local validation from hosted execution.

## Release preparation: verify only

Review baseline: 47957b57388ee7a75c3c2e80595ed3d38f059eee to the working tree, including new files. Implement the approved second-stage verification path only. No commit, push, artifact upload, tag, Release, Marketplace publication or desktop data/configuration changes.

- Ordinary CI remains unchanged. Add a main-only manual preparation workflow with contents/actions read permissions, no persistent checkout credentials and pinned Actions. Accept a full main commit SHA; require successful completed CI and all four named jobs for exactly that SHA, excluding PR/other-branch runs.
- Derive the win32-x64 VSIX filename from the extension version. Require root/runtime manifest and lockfile versions to agree; preserve extension identity and current version. Prepare clean locked runtime dependencies before packaging.
- Inspect the actual VSIX: safe and expected paths, CRC/size integrity, shipped manifest identity/version/platform, required built assets, runtime and licenses. Scan contents including vendored dependencies; require a synthetic canary to prove scanner coverage. Reviewed public upstream findings may be accepted only for the exact unchanged file hash and rule, with a documented non-personal origin. Exclude unnecessary upstream CI credential files and test examples.
- Preserve repository privacy gates. Owned assets reject literal home paths; all bundled bytes reject this builder's actual home/workspace paths. Public pinned dependencies may retain upstream documentation/compiler paths. If a public prebuild's compiler home matches the hosted runner home, only a reviewed exact archive path and unchanged file hash with verified public origin may pass that home-name collision; workspace paths and secret scanning remain enforced. This exception does not allow developer configuration, account evidence, credentials or real test data. Diagnostics remain ignored/local; workflow logs expose only bounded summaries.
- Install the exact scanned VSIX in isolated editor/extension/data directories, using only an empty development harness, never the source Companion extension. Exercise real sidebar startup, automatic workspace binding, unsaved script references, intercepted send feedback/failure restoration and owned-runtime shutdown. Verify both the declared minimum and pinned VS Code versions with synthetic desktop data and no external generation calls. Verify artifact SHA-256 remains unchanged.
- Document reproducible local commands, ownership boundaries and actual validation limits. Review Standards and Spec independently; repair confirmed findings. Hosted workflow execution remains unverified until a separately authorized push/run.

## Hosted CI follow-up

Review baseline: 03e3b89a1b9a80531f8497b020da95071887e4f8 to the working tree. Push the approved source-only CI changes and verify the actual hosted checks. Correct confirmed failures and rerun; no installation package build/upload/publication, personal configuration, credentials or real test data.

- Investigate the first hosted run's 401/RUNTIME_AUTH_FAILED results and integration-worker non-exit. Keep request authentication, HMAC/authority checks, the five-minute signed lifetime and no-replay behavior. Accommodate a small receiver clock lag at signing, using a deterministic real-runtime regression that changes only a synthetic child process's Date.now.
- Ensure the cold-start integration test releases its connection even if startup/assertions fail. Do not force-exit the test runner, ignore errors or increase timeouts to claim success. Record the actual hosted outcome and distinguish observed CI errors from a simulated clock offset; no precise VM clock skew was captured.
- Diagnose native send acceptance without exposing input or auth data. Exercise both bundled DSH languages in the synthetic profile, using each selected locale's accessible send label. Preserve real Webview rendering, the two file sizes, response interception, feedback-before-response and failure-restoration assertions. Keep locale changes confined to the synthetic owned home; do not change user or desktop language preferences.

## GitHub checks, stage one

Review baseline: 7608f3c56ca8a08d89918ba4ac1b02ebf7a534a4 to the working tree. Implement the approved checking stage only; no commit, push, branch-rule changes, installation package build/upload, Release or Marketplace publication.

- Run independent fast checks and source/privacy/workflow checks on pull requests, main pushes and manual dispatch, on GitHub-hosted Windows. Use Node from existing pinned runtime metadata. Keep the fast gate free of DSH runtime preparation.
- Run the existing real-runtime integration/preflight gates after the fast/privacy gates pass. Use clean pinned dependency preparation and existing synthetic fixtures, with no real model/account or desktop data. Run existing native acceptance on main/manual main, with a downloaded fixed VS Code version and isolated profiles. Do not claim hosted execution until it actually happens.
- Give the workflow read-only contents permission, disable checkout credential persistence, pin Actions to full verified commit SHAs, and verify downloaded check tools against recorded SHA-256 values. Do not run fork code through pull_request_target, publish artifacts, log secret values or upload raw test directories. Cache only npm downloads, never a patched runtime/home.
- Make source inventory/home-path privacy checks runnable locally. Preserve existing public metadata, licenses and synthetic fixtures while rejecting generated/private entries. Preserve all product behavior and desktop ownership. Keep failure codes visible without including offending source text or personal paths.
- Document triggers, local validation, remaining hosted-run uncertainty and the three PR-applicable required checks to select only after a successful hosted run. Review Standards and Spec independently and correct confirmed findings. Release/version-naming work belongs to a later stage.

## Cold-start file access round (0.3.6)

Review against the saved 0.3.5 source snapshot, preserving previous uncommitted stages. No commit, push or publication.

- Reproduce slow startup with a fresh synthetic Companion home and a nonexistent desktop source. Separate process/entry imports, migration, module imports, profile discovery, core initialization and web readiness. Report synchronous read totals separately from overlapping asynchronous durations. The earlier 16.6-second run has no detailed phase trace; do not invent one or claim that it can be reconstructed.
- Optimize only measured startup dependency file access at preparation time. Fold pinned zod 4.4.3, execa 10.2.0, yaml 2.9.1 and semver 7.8.5 graphs. Preserve public entry paths, named/default exports, function names, ESM/CommonJS behavior, shared registries/constructors, Zod entry initialization order and SemVer deep requires. Keep adjacent declarations, license notices and package versions. Do not trim DSH plugins/providers or introduce production filesystem hooks, compile caches, services, prewarming or desktop changes.
- Extend preparation/preflight and regression coverage for these artifacts. Fail explicitly on stale/incomplete bundles. A normal build/unit test must still work without runtime dependencies and must never prepare them.
- Compare real startup and a controlled synthetic slow-file replay separately; do not label a repeated process launch as a disk-cold measurement or promise an upper bound. Validate the actual bundled runtime and native editor/Webview behavior, with synthetic authorization and intercepted prompts only. Preserve migration, read-only desktop ownership, references, draft restoration and all existing UI/functions. Review Standards and Spec independently, correct confirmed findings, and install the resulting local VSIX without forcing a user-window reload.

## Maintainability round (0.3.5)

Review against the saved 0.3.4 source snapshot, including its uncommitted reliability fixes. No push or publication.

- Separate root-only build/typecheck/unit tests from installing/preparing DSH and from runtime integration/native acceptance. The fast workflow must work without runtime/node_modules or runtime/bin, must not patch dependencies and must not start DSH. Keep existing runtime regressions in an explicit integration command.
- Move the outer frame's executable script out of HTML strings into a separately checked browser entry; embed only its generated bundle under the existing nonce/CSP. Strictly check production TypeScript plus runtime/browser/build JavaScript with checkJs. Keep pinned upstream contracts narrow and private; do not copy the whole upstream type system or disable strict checks to hide gaps.
- Separate the private adapter into parent-message/read lifecycle, DSH draft/reference/send adaptation, and layout/theme/workspace responsibilities. Keep a small composition/disposal entry. Preserve reference order/removal, pending sends and restored drafts, automatic workspace selection, toolbar actions, theme and narrow layout. Do not introduce a general plugin/provider framework.
- Reject incomplete/stale runtime packaging before VSIX creation: required Node/license assets, version alignment, current generated entries, provider adaptation, TypeBox bundle manifest and public contracts. Do not silently install or repair during checking.
- Provide reproducible synthetic native workspace/profile setup independent of personal paths and credentials. Validate actual VS Code/Webview behavior and use only intercepted prompt requests.
- Preserve independent Companion storage and all desktop read-only ownership rules. Review Standards and Spec separately, repair confirmed findings, and record actual verification limits. Dependency trimming, CI, remote publication and new product features belong to later work.

## Reliability round (0.3.4)

Review baseline for this round: d78e3ef45aab2065aadb37a14d7b5ef8111f4d9f, including working-tree changes. Implement only the approved first-stage reliability and latency diagnosis; no push or publication.

- Reject malformed external control records without uncaught exceptions or handshake retries. Invalid ordinary-text reference markers remain plain text.
- Only the adapter's installed-listener handshake makes business messaging ready; iframe load alone must not drain queued references.
- Bound total background startup (including migration) to 90 seconds, preserving the client's 120-second connection deadline. After the five-second reconnection grace, request cancellation and graceful saving, with a ten-second owner shutdown deadline. Never release the owner pipe before process exit or affect another window's active lease.
- Cancel migration before further session/attachment commits or initial home publication. Replace retry records atomically. Invalid records must fail explicitly, preserve existing data and explain restoration from backup; never silently reinitialize a home.
- Preserve upstream sign-in semantics while distinguishing borrowed read-only authorization from independent authorization. Expose borrowed usability/expiry without refresh, login, credential copying or desktop modification, and remove automatic-renewal promises for borrowed credentials.
- Measure startup separately from UI readiness, workspace binding, reference reads/serialization and observable send feedback. Diagnostics contain only fixed stage names, durations and byte counts. Distinguish reproduced slow startup from first-send behavior that does not reproduce; do not claim a guaranteed disk-cold startup bound.
- Validate synthetic regressions and real bundled runtime/VS Code Webview behavior, without paid model calls. Preserve all existing UI, migration ownership, code reference and draft restoration behavior. Review Standards and Spec separately and repair confirmed findings.

Review baseline: 0a6610a8987c1cadff75605616e6576b96e151df. Review all changes since this commit on Standards and Spec axes.

## Runtime and lifecycle

- Windows x64 local VS Code only. Ship pinned Node, pnpm and the public DSH Web composition in the VSIX. A desktop DSH installation and system Node must not be required. Never launch, stop or modify desktop DSH.
- Reduce measured startup file I/O at packaging time by bundling the pinned TypeBox leaf dependency, preserving all public ESM entry paths, declarations, function names and shared state. Record actual startup separately from artificial slow-I/O experiments; do not claim a guaranteed cold-start limit.
- Use an independent DSH_HOME under ExtensionContext.globalStorageUri, with a companion profile. One Windows named pipe owns one runtime per canonical home. Concurrent VS Code clients share its PID. Distinct desktop and Companion cores may coexist because they own independent data.
- Wait for Web service readiness, obtain its dynamic loopback port, and authenticate using Companion's own browser grant. Do not scan processes or run PowerShell on startup or on the send path. Never replay an accepted or potentially accepted prompt.
- Hiding the sidebar leaves tasks alone. After the last extension client disconnects, wait five seconds for reload/reconnection, then cancel tasks, flush sessions and dispose the runtime. No permanent system service. One window exiting must not stop other windows' tasks.
- If another active window still owns an older runtime version, fail promptly with an instruction to reload those windows; do not interrupt its tasks or wait for the entire startup timeout. Once its last lease ends, wait through its save/exit grace before starting the new version.
- Startup failures must expose a safe stage/error code and diagnostic stack frames without credential values or source content.
- A control pipe can close during owner handoff before replying. Retry only this startup handshake within its existing deadline; create a host only when the pipe is absent/refused, and never replay application requests.

## First-use migration

- Preserve desktop files read-only. Atomically initialize a new Companion home; never overwrite an existing initialized home or continuously synchronize desktop configuration.
- Import only compatible provider/model/default-route settings; credentials are shared in place, not imported (see Shared desktop credential store). Exclude startup agent declarations, connectors, schedules and other runtime state. Incompatible input must fail visibly rather than silently initialize a blank profile.
- Include the pinned WorkBuddy model provider and compatible model/context preferences. Do not copy OAuth tokens; automatic check-in stays disabled. Preserve an existing independent Companion login. Otherwise automatically use the desktop profile's WorkBuddy access token read-only in memory, with no login prompt while usable desktop auth exists. Re-read updates, strip borrowed refresh tokens, never call refresh or write/delete desktop credentials. Reject expired/invalid borrowed credentials with a clear diagnostic. Logout while borrowing must explain read-only desktop ownership and preserve its files. Without either credential source, keep the normal provider login flow.
- Read historical compressed logs using the pinned public DSH read-only persistence interface. Copy valid completed sessions and attachments. Skip pending inboxes, unclosed turns, incompatible logs or snapshots that change during copying, and record safe identifiers/reasons. Rebuild caches and workspace grouping from log headers; custom desktop pin/order/archive metadata is not imported.
- On a later background startup, retry only the historical session IDs recorded as skipped in the original import. Never import newly created desktop sessions, resync configuration or overwrite existing Companion sessions. Do not automatically resume any imported work.
- Without desktop data, initialize the normal Web settings/login flow.

## Existing UI and code context

- Preserve the right sidebar entry, themed narrow Web UI, dense-number whale animation, history/new controls and directly visible plugin/schedule/settings buttons. No overflow submenu, workspace-path badge, extra file/selection buttons or custom drag/drop feature.
- New sessions automatically use the current VS Code workspace, including multi-root selection. Historical sessions keep their cwd.
- Preserve compact removable file/selection references, unsaved selection snapshots, latest full-file buffer serialization, last-editor retention while focusing chat, and per-session reference dismissal.
- Preserve typed text/manual references and draft restoration on failure. No reinsertion while serialization/submission is pending. Healthy sends must not perform startup or process discovery; local UI feedback must be measured separately from model/network wait.

## Verification and delivery

- Typecheck/build, automated interface tests and actual VS Code/Webview acceptance are separate gates. Routine tests make no paid model calls.
- Cover cold start without desktop/system Node, concurrent clients, last-client shutdown, failed startup/retry, independent data, one-time import, unfinished-history exclusion, shared desktop credentials and no automatic replay.
- Install the resulting local VSIX. Deliver a reproducible source archive, runtime version/license records and validation evidence. Do not publish or push.
- Review after implementation using both Standards and Spec sub-agents; also inspect cohesion, coupling, interface leakage and speculative abstractions. Repair confirmed findings and rerun affected checks.
