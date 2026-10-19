# MVP acceptance

Independent extension identity, source project, reproducible build and installable VSIX. Preserve the old installed prototype for rollback.

- Reuse the running Windows desktop DSH, its model/account/plugin settings and history. No second backend and no desktop config mutations. Detect its dynamic port once on connection; never run PowerShell due only to elapsed idle time. On explicit reconnect or a failed connection, rediscover with single-flight control. Never silently replay a prompt that may have been accepted.
- Right sidebar button; narrow themed native DSH GUI; history/new-chat/more controls; first dense-number whale loading page. No workspace-path badge and no extra file/selection buttons. Drag/drop is deferred; do not add a custom drag feature.
- Automatically use the active editor's VS Code workspace (multi-root supported). Historical sessions keep their cwd. New sessions use the current workspace.
- Automatically show one compact file/selection reference. Selected code takes precedence and includes line numbers. X removes the draft reference; the same context stays removed after document edits. Changing file/range permits automatic context again. Keep the last valid editor while focusing chat.
- Selected code is an immutable buffer snapshot, including unsaved edits; whole-file references read the latest open buffer at send. Preserve typed text/manual references, handle failed serialization/submission without reinserting during send or losing the restored draft.
- Diagnostic mode records stages, duration and byte counts only. Local feedback and real extension-host bridge time must be distinguishable from model/network wait. No model calls in routine tests.

Review baseline: the initial local scaffold commit. Review all implementation against that fixed point using both Standards and Spec axes.
