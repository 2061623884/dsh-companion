# Continuous integration

The checking workflow is .github/workflows/ci.yml. It runs on GitHub-hosted windows-2022 with Node read from runtime/node-version.json. No installation package is built/uploaded, and no Release or Marketplace publication is part of this workflow.

The separate main-only manual release preparation workflow is documented in [release.md](release.md). It builds and tests a candidate only after the exact commit's four CI jobs pass. It has no artifact upload, tag or publication step; ordinary CI behavior is unchanged.

| Check name | Events | Work |
| --- | --- | --- |
| Privacy and workflows | PR, main push, manual | Source inventory/home-path check, actionlint, fully redacted Gitleaks history scan |
| Quick checks | PR, main push, manual | Root npm ci, strict source checks, unit tests; no DSH runtime preparation |
| Windows runtime | After both checks pass | Clean runtime preparation, integration tests and runtime/dependency contracts |
| Native VS Code | After runtime, only main push or manual main | Download pinned VS Code, run the existing isolated native editor/Webview and send checks |

Manual dispatch on another branch runs the first three checks and deliberately skips Native VS Code. PRs do not run native GUI acceptance. Once the workflow has a successful hosted run, select Privacy and workflows, Quick checks and Windows runtime as required PR checks in repository rules. Native VS Code is not a PR-required check because its trigger intentionally excludes PRs. Repository rules are configured separately; adding YAML does not enable branch protection.

All jobs inherit contents: read and checkout uses persist-credentials: false. Actions are pinned to full commit SHAs; security-tool versions/HTTPS URLs/archive SHA-256 values and VS Code version are recorded in scripts/ci-tools.json. Changes to these pins require review. The only cache is the setup-node npm download cache, keyed by lockfiles. node_modules, prepared runtime graphs, source/desktop homes and native profiles are never cached or uploaded. No secrets or model credentials are needed.

The pinned public WorkBuddy dependency has an SSH URL in the existing lockfile. Workflow-scoped GIT_CONFIG environment entries translate that URL to anonymous HTTPS. This needs no SSH key or personal Git credentials and changes neither contributor Git configuration nor the locked dependency revision.

## Local validation

From the repository root on Windows x64:

```powershell
npm ci
npm run check
npm run check:source
npm test

./scripts/prepare-ci-tools.ps1
& ./.test-work/ci-tools/actionlint/actionlint.exe -oneline
& ./.test-work/ci-tools/gitleaks/gitleaks.exe git --log-opts=--all --redact=100 --no-banner --exit-code=1

# Match the workflow's anonymous public Git dependency transport in this shell.
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'url.https://github.com/.insteadOf'
$env:GIT_CONFIG_VALUE_0 = 'ssh://git@github.com/'
npm run prepare-runtime
npm run test:integration
node scripts/check-runtime.mjs

# Reproduce the CI editor preparation and existing native runner.
$env:GITHUB_ENV = Join-Path (Get-Location).Path '.test-work/ci-native-env.txt'
node scripts/prepare-native-ci.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native editor preparation failed' }
$env:VSCODE_EXECUTABLE = (Get-Content $env:GITHUB_ENV | Select-Object -Last 1).Substring('VSCODE_EXECUTABLE='.Length)
npm run test:native
```

check:source examines the tracked and non-ignored working source candidate, excluding tracked deletions. It rejects known generated/private locations, credential filenames, compiled/distribution/raw-data formats and literal Windows/macOS/Linux home paths. It reports only safe reason codes/counts, never offending contents/paths. It complements Gitleaks; neither check proves every arbitrary JSON fixture is synthetic, so normal code review still checks data provenance. Public dependency metadata and copyright notices remain valid source material.

The native runner uses synthetic workspaces/authorization and intercepted prompts, never a contributor's desktop home or account. Only short pass/fail summaries are logged. Raw .test-work results, profiles and network fixtures remain local to the ephemeral runner. Cold-start duration is a diagnostic observation, not a fixed CI speed threshold; dependency file-read budgets and behavior contracts remain enforced.

Local gates do not validate GitHub job scheduling, caches/permissions, hosted desktop behavior or repository rules. Those need a real hosted run after the workflow is pushed. A failed GUI job must be investigated explicitly; it must not silently fall back to a different editor or be reported as passed. The declared minimum VS Code version is a separate compatibility case; this initial native job uses the fixed already-validated version in ci-tools.json.
