# Publication privacy

The desktop-connected VSIX contains only Companion-owned built JavaScript/CSS, its UI mark, package metadata, README/changelog and license notices. runtime/, tests, source, profiles, credentials, sessions and diagnostic records are excluded. Runtime dependencies retained for historical development fixtures are not product assets.

Desktop installation discovery and data location resolution use the current Windows environment. The desktop browser grant is read only for in-memory loopback authentication. Credentials, personal paths, raw diagnostic records and source contents must never be committed or uploaded.

Run check:source and a redacted Gitleaks source/history scan before any later publication. check:release validates every ZIP entry, identity/version, generated assets, personal paths and full-file secret coverage. Public dependency exceptions are exact-hash/rule based; no dependency directory is excluded from scanning. In the desktop-connected archive, runtime entries are rejected entirely.

Installed acceptance uses synthetic desktop homes, isolated VS Code profiles and intercepted external requests. Daily desktop settings, credentials and conversations remain outside the fixture. Results copied to public metadata must be limited to versions, hashes, counts and verification booleans.

The current request authorizes a source push only, with no tag, Release or installer publication. A later hosted release must first provision and verify the desktop fixture used by its runtime/native jobs, then validate the final original VSIX bytes.
