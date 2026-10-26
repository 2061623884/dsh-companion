# Publication privacy

The desktop-connected VSIX contains only Companion-owned built JavaScript/CSS, its UI mark, package metadata, README/changelog and license notices. runtime/, tests, source, profiles, credentials, sessions and diagnostic records are excluded. Runtime dependencies retained for historical development fixtures are not product assets.

Desktop installation discovery and data location resolution use the current Windows environment. The desktop browser grant is read only for in-memory loopback authentication. Credentials, personal paths, raw diagnostic records and source contents must never be committed or uploaded.

Update checks read executable version metadata and the installed channel, then request a fixed public feed from download.deepseek.com without authentication. Code, session contents and credentials are not sent. Only the last notified version is stored in VS Code extension state. Diagnostics contain a bounded error code/name rather than raw server responses or local paths.

Run check:source and a redacted Gitleaks source/history scan before any later publication. check:release validates every ZIP entry, identity/version, generated assets, personal paths and full-file secret coverage. Public dependency exceptions are exact-hash/rule based; no dependency directory is excluded from scanning. In the desktop-connected archive, runtime entries are rejected entirely.

Installed acceptance uses synthetic desktop homes, isolated VS Code profiles and intercepted external requests. Daily desktop settings, credentials and conversations remain outside the fixture. Results copied to public metadata must be limited to versions, hashes, counts and verification booleans.

The current request authorizes committing and pushing the verified Companion source and its matching Desktop source patch. It does not authorize tags, Releases or installer uploads. Local builds and installed acceptance remain local evidence. A later hosted release must first provision and verify the desktop fixture used by its runtime/native jobs, then validate the final original VSIX bytes.
