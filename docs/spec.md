# Independent bundled runtime (0.3.0)

Review baseline: 0a6610a8987c1cadff75605616e6576b96e151df. Review all changes since this commit on Standards and Spec axes.

## Runtime and lifecycle

- Windows x64 local VS Code only. Ship pinned Node, pnpm and the public DSH Web composition in the VSIX. A desktop DSH installation and system Node must not be required. Never launch, stop or modify desktop DSH.
- Use an independent DSH_HOME under ExtensionContext.globalStorageUri, with a companion profile. One Windows named pipe owns one runtime per canonical home. Concurrent VS Code clients share its PID. Distinct desktop and Companion cores may coexist because they own independent data.
- Wait for Web service readiness, obtain its dynamic loopback port, and authenticate using Companion's own browser grant. Do not scan processes or run PowerShell on startup or on the send path. Never replay an accepted or potentially accepted prompt.
- Hiding the sidebar leaves tasks alone. After the last extension client disconnects, wait five seconds for reload/reconnection, then cancel tasks, flush sessions and dispose the runtime. No permanent system service. One window exiting must not stop other windows' tasks.
- If another active window still owns an older runtime version, fail promptly with an instruction to reload those windows; do not interrupt its tasks or wait for the entire startup timeout. Once its last lease ends, wait through its save/exit grace before starting the new version.
- Startup failures must expose a safe stage/error code and diagnostic stack frames without credential values or source content.

## First-use migration

- Preserve desktop files read-only. Atomically initialize a new Companion home; never overwrite an existing initialized home or continuously synchronize desktop configuration.
- Import only compatible provider/model/default-route settings and API-key references/records. Exclude startup agent declarations, browser grants, connectors, schedules and other runtime state. Incompatible input must fail visibly rather than silently initialize a blank profile.
- Include the pinned WorkBuddy model provider and compatible model/context preferences. Do not copy OAuth tokens. User signs in once inside Companion; automatic check-in stays disabled.
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
- Cover cold start without desktop/system Node, concurrent clients, last-client shutdown, failed startup/retry, independent data, one-time import, unfinished-history exclusion, credential isolation and no automatic replay.
- Install the resulting local VSIX. Deliver a reproducible source archive, runtime version/license records and validation evidence. Do not publish or push.
- Review after implementation using both Standards and Spec sub-agents; also inspect cohesion, coupling, interface leakage and speculative abstractions. Repair confirmed findings and rerun affected checks.
