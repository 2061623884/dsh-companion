# Release preparation and local rehearsal

## Local release materials

Preparation remains verification-only. After package scanning and actual installed acceptance, `npm run prepare:release` creates an ignored `.test-work/release/candidate-<package-hash-prefix>-<source-hash-prefix>` directory containing exactly four files: the original VSIX, `release.json`, `release-notes.md` and `SHA256SUMS`. It never builds another VSIX, uploads an artifact or creates a Git tag/Release. Identical existing candidates may be reused; different existing bytes fail instead of being overwritten. A failed/incomplete candidate is not publishable.

Packaging records `build-source.json` outside the candidate: the actual VSIX SHA-256, Git commit, dirty state and a digest of tracked/unignored source filenames and bytes. Source must remain unchanged during packaging and until candidate preparation. Archive and installed acceptance reports must match the same package hash/version and include both required editor versions. Only fixed metadata, hashes and validated summary counts are copied; raw reports, environment variables, account data, paths, PIDs and fixture content are not copied.

The version section in `CHANGELOG.md` supplies user-facing changes. Generated notes include Windows support, actual accepted editor versions, install/hash instructions and source identity. Local notes clearly say local rehearsal; local or dirty work does not establish hosted provenance. `SHA256SUMS` hashes the VSIX and both documents, excluding itself. Candidate document contents are also scanned by the verified Gitleaks stdin scanner; only the VSIX is covered by the separate full archive scan. Both gates are required.

`check:candidate` and `preview:release` require an expected full commit and VSIX SHA-256 supplied from **outside** the candidate. Checksums bundled alongside a file are not an authenticity proof by themselves. Use trusted build/verification records and the checkout for the exact source version, with matching source-content digest. An imported candidate must never choose its own expected identity. Missing/extra files, symlinks, changed bytes, changed source, incorrect versions, incomplete reports and checksum conflicts fail.

Example after running the existing package/check/install commands:

```powershell
npm run prepare:release
# Set this to the candidate directory printed above; no absolute personal path is needed.
$candidate = '.test-work/release/candidate-<package-hash-prefix>-<source-hash-prefix>'
$build = Get-Content .test-work/release/build-source.json -Raw | ConvertFrom-Json
npm run check:candidate -- $candidate $build.commit $build.sha256
npm run preview:release -- $candidate $build.commit $build.sha256
```

Preview always returns `mode: dry-run` and `publicationEnabled: false`. It does not implement tag creation, asset upload or Release publication. Offline rehearsal checks local tag conflicts and explicitly leaves remote provenance/version availability unverified. To verify those read-only, add `--online` to preview with optional read-only `GH_TOKEN`. Online preview accepts only clean hosted candidate evidence, checks the named repository, exact CI/preparation run SHA, main branch, trusted workflow paths, event, successful jobs and preparation attempt, then rejects existing remote version tags or Releases. Requests are GET only; HTTP failures are fatal. A verified preview still requires separate explicit publication authorization and a future publishing implementation.

In GitHub the existing manual workflow runs material generation last, still with read-only permissions and no upload step. The gate writes its receipt to `RUNNER_TEMP` through the absolute `RELEASE_CI_RECEIPT` path; candidate preparation reads that same path after the second checkout. Checkout keeps its default clean behavior. Preparation rechecks the receipt's repository, commit and positive CI run ID against the project and checked-out source. It requires a clean checkout matching the dispatch SHA; selecting a historical commit differing from the dispatch SHA cannot produce hosted release materials. Its preparation run is necessarily in progress during generation: that run's completed success must be checked later by online rehearsal. Run IDs inside a local JSON file alone are not verified provenance.

The installed-package runner and candidate preparation share `scripts/installed-acceptance.mjs`. Every required result must be exactly `true`, including shared login, shared sign-out and loading dismissal; missing or false results reject candidate generation. Editor version, intercepted prompt count and absence of generation calls remain part of the same contract.

Candidate retention/transfer is deferred until explicitly authorized. Existing verification runs without retained artifacts cannot supply an old runner's package for promotion. Future publication must consume a retained original candidate and recheck its hash; an expired or absent artifact must fail rather than silently rebuild. This stage does not add upload controls, write permissions, automatic version changes or Marketplace publication.

## Verification workflow

The manual workflow `.github/workflows/release.yml` prepares a Windows x64 candidate on an ephemeral runner. It has no upload, tag, Release or Marketplace step. There is no publication mode in this stage. The ordinary CI workflow retains its existing no-package behavior.

Run the workflow from `main` and supply a full lowercase commit SHA reachable from `origin/main`. The gate queries the `ci.yml` workflow for that exact SHA and requires a completed successful main push/manual run with successful Privacy and workflows, Quick checks, Windows runtime and Native VS Code jobs. An overall green result with a skipped native job is insufficient. The candidate must already contain these preparation scripts. Checks use GitHub's [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow) and [jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run) read APIs. Only the gate receives the temporary GitHub token; candidate build/test processes do not receive it. Checkout credentials are not persisted.

The job checks source inventory and reachable history, prepares locked dependencies and verified Node, and builds `.test-work/release/dsh-companion-<version>-win32-x64.vsix`. Packaging reads the version instead of maintaining a second filename version. Root/runtime package and lockfile versions must agree; extension publisher/identity is unchanged. This stage does not bump a version.

## Actual package checks

`check:release` checks every ZIP entry's path, expected location, size and CRC; rejects duplicates, symlinks, credential/local-state filenames and raw data; checks required runtime/assets/licenses; compares built assets with the build input; and checks the VSIX identity, version and Windows target. Only the pinned Node and runtime dependencies are allowed as generated runtime content. New product assets require an explicit inventory update.

Owned assets reject generic literal home paths. Every entry, including third-party files, rejects the current builder's actual home and workspace paths, including JSON-escaped Windows paths. Two public pnpm prebuilds embed an upstream compiler home that can equal a hosted runner's home: only their reviewed exact path and file hash may pass that home-name collision. This never permits a current workspace path or suppresses secret scanning. Public dependencies contain upstream documentation examples and compiler paths; those are distinct from the builder's personal environment. Fresh `npm ci` and lockfile integrity establish their public package provenance. Filename/secret scanning complements these checks; it cannot establish the provenance of arbitrary handwritten JSON, images or encrypted payloads, so normal review remains necessary.

Gitleaks' [pinned default configuration](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml) excludes node_modules during directory scans. Therefore the archive checker feeds **all extracted file bytes** to the verified scanner's stdin, including vendor files, with inline allow comments disabled and an explicit default-rules configuration. A generated canary in a synthetic vendor file must be detected before candidate preparation. Public secret-scanner false positives are documented in `scripts/release-public-findings.json`: each record requires an exact file SHA-256 plus rule ID. These cover SDK namespace assignments/documentation, public localization IDs, prebuilt/catalog checksums, certificate-pinning examples and Chromium DevTools' public CrUX application key. No directory-wide finding exemption is used. Changed dependency files require renewed review. Unneeded upstream Coveralls configuration and TypeScript test examples are excluded from the VSIX.

Only after these gates pass are `SHA256SUMS` and `archive-check.json` written locally. `test:release` verifies that hash, installs the exact VSIX via VS Code's CLI into fresh extension/profile directories, and loads an empty test harness; Companion itself is never loaded from the source development directory. It runs the real installed sidebar in the declared minimum VS Code and the fixed version in `scripts/ci-tools.json`, using the bundled runtime, synthetic desktop authorization/workspaces and intercepted outbound traffic. A test-only loopback transport redirects the installed proxy's prompt request to a delayed failure response before backend/model admission, including when the browser uses worker RPC. The installed files and remaining routes are unchanged. The draft must clear while pending and return after failure; unsaved script text must have been serialized. The installed sidebar must read the synthetic desktop account login without a Companion credential copy, and extension-side sign-out must remove that grant from the shared store while preserving the browser grant. Outbound fixture records allow only catalog/account reads and the explicitly intercepted synthetic sign-out; refresh and generation requests remain forbidden. The existing provider-owned desktop authorization file must remain unchanged and the owned runtime must exit after the editor closes. The runner correlates the submitted session ID with its persisted header and requires its cwd to equal the active file's second workspace folder; first-use UI may also create an empty default session. The archive hash is checked again, and only safe booleans/counts/versions enter `installed-check.json`.

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

## Manual GitHub publication

With explicit publication authorization, a maintainer may publish a GitHub Release from an audited source commit. Update README and project status before the final build, scan source/staged changes and reachable history, build and scan the final VSIX, and run installed acceptance against those same bytes. Publish the version tag at the audited commit and attach only the verified VSIX, checksum file and reviewed release notes. Record the commit, package SHA-256 and validation scope in the notes. Local evidence must be labeled as local; it does not establish hosted build provenance. The verify-only workflow remains unchanged and Marketplace publication is separate.
