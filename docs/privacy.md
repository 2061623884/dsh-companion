# User-independent integration and publication privacy

## Supported users and authorization sources

The current release supports local Windows x64 VS Code. The desktop source is resolved from the current user's `DSH_HOME`, or their home directory's `.dsh` folder when unset. Companion storage is supplied by VS Code's `globalStorageUri`. No developer username, account ID, absolute installation path, bearer token or port is part of this discovery contract. Desktop's standard `profiles/desktop` location is a product convention, not a personal directory.

WorkBuddy is the first read-only authorization adapter. Every user supplies their own existing authorization through their local environment; no authorization from a developer machine is distributed. CN and international credentials remain separate, independent Companion authorization retains priority, and borrowed authorization is never copied/refreshed/deleted. Expiry and revocation are not bypassed. Tests cover different source directories with spaces/Unicode and separate CN/global identities; they do not establish live acceptance for every account or unsupported platform.

Future providers belong in their own runtime authorization adapters beside `src/runtime/workbuddy-auth.mjs`, wired through a checked provider construction seam. Their storage format, realm, refresh behavior and ownership must be checked independently before enabling reuse. Editor context and sidebar code must not learn provider credential formats. This is the extension location; no hypothetical common credential registry or automatic OAuth-token copying is required.

## Repository and artifacts

Only implementation, synthetic fixtures, public dependency metadata/licenses and sanitized aggregate validation belong in Git. Do not commit credentials, real account identity, personal email/phone, machine paths, raw request bodies, session content, screenshots of accounts, local profiles or diagnostic dumps. Required upstream copyright notices and the public repository owner URL remain project metadata.

`.gitignore` excludes known credentials, environments, runtime data and generated output. `.vscodeignore` separately excludes them from the VSIX. Ignore rules do not remove already tracked files or Git history: inspect tracked files, all reachable commits and the source archive/VSIX before publication. Validation records should contain counts, safe codes, timings and boolean checks; never raw authorization or account identifiers. Local untracked reports are not automatically public artifacts.

Before committing/pushing, run a current Gitleaks CLI locally with full redaction:

```sh
gitleaks git --log-opts=--all --redact=100 --no-banner .
gitleaks git --staged --redact=100 --no-banner .
```

Scan final source and installation archives using `gitleaks dir --max-archive-depth=1 --redact=100 <archive>`. Also review for personal paths/identities and visible screenshots; a secret scanner does not prove complete absence of personal information. Keep any raw/redacted scanner reports outside the public repository. This development workflow neither uploads code to a scanning service nor publishes/pushes automatically.
