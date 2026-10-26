# Desktop connection preview

0.4.0-preview.1 changes Companion into a client of the installed Windows DeepSeek Harness Desktop Host. Desktop owns its process lifetime, credentials, profile settings and sessions. The extension owns a loopback HTTP/WebSocket proxy, the editor bridge and its page-scoped UI adapter.

Desktop discovery identifies the installed executable and listeners belonging to the Desktop Host process. Startup distinguishes not installed, not running, authentication/not-ready and incompatible frontend states. Only the user's open action starts the detected desktop executable. The download action opens the official Harness page.

The proxy authenticates through the desktop browser grant in memory. Healthy requests reuse the discovered target; a failed POST is never replayed. Disconnection invalidates the target, and the next connection discovers the current host/port. When an established sidebar loses Desktop, it displays the appropriate action and attempts reconnection for up to 45 seconds; further connection attempts remain available through the retry/open actions. Reloading obtains the current desktop frontend and reinjects the private adapter.

EditorContext, ReferenceController, the loading animation and navigation remain local to the extension. DSH data writes occur through the Desktop Host's own interfaces. The desktop application and its installed files are not patched. Closing VS Code releases proxy sockets only.

The VSIX excludes runtime/ entirely. Legacy runtime source/preparation scripts are retained only as historical test fixtures. Legacy Companion data is preserved without an automatic merge. Existing hosted workflows need an installed-desktop fixture before the next publication; this preview has local evidence only.
