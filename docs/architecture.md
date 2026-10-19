# Architecture

Four cohesive modules own different change reasons. `extension.ts` only assembles them.

| Module | Public interface | Hidden details |
| --- | --- | --- |
| `desktop/connection.ts` | start, reconnect, dispose | Windows process discovery/hidden startup, authenticated port probe, local credential format, signed cookies, HTTP/SSE/WebSocket forwarding |
| `context/editor-context.ts` | snapshot, onChange, read, dispose | VS Code focus, selection boundaries, multiple workspace folders, open unsaved documents, read authorization |
| `references/reference-controller.ts` | sync, remove, serialize, dispose | Per-session automatic-context identity, cancellation, serialization/pending-submission lifecycle |
| `sidebar/` | view provider and open/reference commands | Webview host bridge, theme, loading page, private native DSH UI adapter |

`DraftPort` is the actual seam needed to test reference state without a running DSH. It exposes draft reference operations, not DSH stores or DOM nodes. `sidebar/client/dsh-adapter.js` is the only module that accesses native draft offsets, plugin services, native composer selectors and layout attributes. It is intentionally private: it is the compatibility cost of embedding the existing desktop GUI. Native DSH frontend source is loaded from the user's running application, not copied into this repository or bundle.

## Connection lifecycle

The first connection prepares the existing application and verifies its host using the existing desktop browser-session grant. If neither a shell nor a host exists, `ensureWindowsDesktop` starts the installed application with Windows `WindowStyle Hidden` and waits for its loopback listener. It does not directly launch a second standalone Host: upstream desktop code cannot attach to one. Instead, the original Electron single-instance lock owns the backend, and a later desktop launch shows that owner's window without starting another Host. A current-user Windows named mutex protects the check/start decision across extension hosts, so racing plugin windows do not send Electron a second-instance focus request. Startup checks the normal per-user install directory and the Windows uninstall registration; it never downloads a runtime or patches the application.

Concurrent callers within a connection share the preparation promise. A successful target stays cached regardless of idle time. Each forwarded request receives a fresh short-lived signed cookie in memory; browser code never receives the signing secret or upstream Set-Cookie headers.

Only a connection failure, HTTP 401 or explicit reconnect invalidates the cached target. The next request may discover or start the existing application and read its changed port/credential; the failed request is returned to its caller and is never replayed automatically, especially for prompts. The stable local proxy URL lets a healthy stream continue without a five-second discovery timer. Shutdown closes local and upgraded sockets, leaving the shared DSH process running. Its tray/desktop retains normal lifetime ownership.

The proxy listens on loopback and checks Host/Origin. This is a same-user desktop integration, not a network service or independent credential store. No credentials are written. A desktop update that changes the boot contract fails visibly rather than starting another backend.

## Context and submission

The host sends a compact file descriptor, or an immutable selected-buffer snapshot. Context identity is URI plus exact selection coordinates, independent of document version. Thus edits do not undo cancellation, but a different range on the same line is a different context. Whole-file bodies cross the host bridge only when serializing a submitted reference.

The reference controller never edits free text or manual references. Serialization holds automatic-context insertion until native pending submission has settled. The native submission implementation owns draft rollback; the controller respects the restored occurrence instead of creating another reference. Bridge results are scoped to the originating view generation, so a disposed page cannot write to its replacement.

Native UI changes are coalesced through animation frames. After mounting, the observer watches layout attributes and top-level portals, not every streamed message DOM mutation. Native input/session stores drive reference controls.

## Compatibility and future scope

Validated target: Windows local VS Code 1.124.2, desktop DSH 0.2.1-rc.2. `engines.vscode` is the minimum declared API baseline, not a claim that all supported versions were tested. The private adapter depends on DSH's ModuleLoader, page-owned plugin lifecycle and UI service interfaces. An upstream stable embed SDK could replace this adapter without changing context or reference logic.

No custom agent engine, backend installation, remote workspace mapping, drag protocol or publishing pipeline is included in this MVP. Build/test artifacts and machine-specific fixtures are excluded from the VSIX and public source archive. Hidden startup is specifically a Windows desktop behavior and must be revalidated after upstream shell changes.
