# DSH Companion

A Windows x64 VS Code sidebar for DeepSeek Harness with its own bundled runtime. Desktop DSH and a system Node installation are not required.

## Install and use

Install the local VSIX and reload VS Code. Open the blue whale entry in the editor title bar or the secondary sidebar. Companion starts its own background automatically. The first launch imports compatible model/API-key settings and completed history from an existing desktop home, without changing the original files. WorkBuddy requires a fresh login under Settings / Plugins; its OAuth tokens are not copied.

The sidebar follows VS Code themes, binds new chats to the current workspace and includes removable current-file/selection references. Plugin management, automation and settings remain available in the Web UI. Multiple VS Code windows share one Companion runtime; after the last window exits it stops tasks and saves sessions. Closing or hiding only the sidebar does not stop work.

Desktop and Companion data are independent after migration. Historical sessions with queued inputs or interrupted turns are skipped and reported in the Companion home migration.json; only these skipped IDs are retried on later background starts. Desktop workspace pinning, ordering and archive flags are not imported. Remote/WSL extension windows are not supported in this release.

## Build on Windows x64

1. Run npm ci in this directory.
2. Run npm run prepare-runtime to install clean locked runtime packages, download/check Node and bundle the TypeBox entry points. Run this complete command again when rebuilding dependencies; it restores pristine inputs before bundling.
3. Run npm run check and npm test.
4. Run npm run package to build the win32-x64 VSIX in ../outputs.

All runtime packages are included in the VSIX; first use does not download the core. Installing optional future plugins may use the bundled pnpm and the network. No credentials or user history are part of the source/archive/VSIX.

## Design and verification

See docs/spec.md, docs/architecture.md, docs/validation.md and docs/adr/0001-independent-runtime.md. Runtime lifecycle, editor context, references and sidebar UI have separate module interfaces. Tests do not call paid models. This project is locally developed and has not been published by this task.
