# Release preparation (verification only)

The manual workflow `.github/workflows/release.yml` prepares a Windows x64 candidate on an ephemeral runner. It has no upload, tag, Release or Marketplace step. There is no publication mode in this stage. The ordinary CI workflow retains its existing no-package behavior.

Run the workflow from `main` and supply a full lowercase commit SHA reachable from `origin/main`. The gate queries the `ci.yml` workflow for that exact SHA and requires a completed successful main push/manual run with successful Privacy and workflows, Quick checks, Windows runtime and Native VS Code jobs. An overall green result with a skipped native job is insufficient. The candidate must already contain these preparation scripts. Checks use GitHub's [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow) and [jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run) read APIs. Only the gate receives the temporary GitHub token; candidate build/test processes do not receive it. Checkout credentials are not persisted.

The job checks source inventory and reachable history, prepares locked dependencies and verified Node, and builds `.test-work/release/dsh-companion-<version>-win32-x64.vsix`. Packaging reads the version instead of maintaining a second filename version. Root/runtime package and lockfile versions must agree; extension publisher/identity is unchanged. This stage does not bump a version.

## Actual package checks

`check:release` checks every ZIP entry's path, expected location, size and CRC; rejects duplicates, symlinks, credential/local-state filenames and raw data; checks required runtime/assets/licenses; compares built assets with the build input; and checks the VSIX identity, version and Windows target. Only the pinned Node and runtime dependencies are allowed as generated runtime content. New product assets require an explicit inventory update.

Owned assets reject generic literal home paths. Every entry, including third-party files, rejects the current builder's actual home and workspace paths, including JSON-escaped Windows paths. Two public pnpm prebuilds embed an upstream compiler home that can equal a hosted runner's home: only their reviewed exact path and file hash may pass that home-name collision. This never permits a current workspace path or suppresses secret scanning. Public dependencies contain upstream documentation examples and compiler paths; those are distinct from the builder's personal environment. Fresh `npm ci` and lockfile integrity establish their public package provenance. Filename/secret scanning complements these checks; it cannot establish the provenance of arbitrary handwritten JSON, images or encrypted payloads, so normal review remains necessary.

Gitleaks' [pinned default configuration](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml) excludes node_modules during directory scans. Therefore the archive checker feeds **all extracted file bytes** to the verified scanner's stdin, including vendor files, with inline allow comments disabled and an explicit default-rules configuration. A generated canary in a synthetic vendor file must be detected before candidate preparation. Public secret-scanner false positives are documented in `scripts/release-public-findings.json`: each record requires an exact file SHA-256 plus rule ID. These cover SDK namespace assignments/documentation, public localization IDs, prebuilt/catalog checksums, certificate-pinning examples and Chromium DevTools' public CrUX application key. No directory-wide finding exemption is used. Changed dependency files require renewed review. Unneeded upstream Coveralls configuration and TypeScript test examples are excluded from the VSIX.

Only after these gates pass are `SHA256SUMS` and `archive-check.json` written locally. `test:release` verifies that hash, installs the exact VSIX via VS Code's CLI into fresh extension/profile directories, and loads an empty test harness; Companion itself is never loaded from the source development directory. It runs the real installed sidebar in the declared minimum VS Code and the fixed version in `scripts/ci-tools.json`, using the bundled runtime, synthetic desktop authorization/workspaces and intercepted outbound traffic. A test-only loopback transport redirects the installed proxy's prompt request to a delayed failure response before backend/model admission, including when the browser uses worker RPC. The installed files and remaining routes are unchanged. The draft must clear while pending and return after failure; unsaved script text must have been serialized. Outbound fixture records must contain only catalog/billing reads, with no refresh headers or paths. The non-read request counter must be zero. Synthetic desktop authorization must remain unchanged and the owned runtime must exit after the editor closes. The runner then reads the single synthetic persisted session header and requires its cwd to equal the active file's second workspace folder. The archive hash is checked again, and only safe booleans/counts/versions enter `installed-check.json`.

Raw scanner/editor diagnostics, profiles, synthetic credentials, the extracted scan directory and the VSIX stay under ignored `.test-work`. No directory is uploaded. Only npm downloads are cached; prepared runtimes, packages and test data are not cached. The token has only contents/actions read permissions.

## Local reproduction

On Windows x64, from the repository root:

```powershell
npm ci --no-audit --no-fund
npm run check:source
npm test
./scripts/prepare-ci-tools.ps1
& ./.test-work/ci-tools/actionlint/actionlint.exe -oneline
& ./.test-work/ci-tools/gitleaks/gitleaks.exe git --log-opts=--all --redact=100 --no-banner --exit-code=1
New-Item -ItemType Directory -Force -Path .test-work/release | Out-Null
node --test tests/release-privacy.cjs

$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'url.https://github.com/.insteadOf'
$env:GIT_CONFIG_VALUE_0 = 'ssh://git@github.com/'
npm run prepare-runtime
npm run package
npm run check:release
npm run test:release
```

Check each command's exit status; do not continue after failure. The installed-package runner downloads the two explicit editor versions, never silently substitutes another version, and leaves the contributor's installed extensions/profile untouched. Local execution of these commands does not claim a successful hosted CI gate for uncommitted changes. Hosted permissions, scheduling and the real gate must be verified after a separately authorized push.

Draft creation, artifact transfer, version tags and public publication are future steps requiring separate implementation/authorization. Promotion should reuse the already tested bytes and SHA-256, not silently rebuild a different package.
