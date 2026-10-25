# Third-party notices

The narrow sidebar UI adapter, CSS, bootstrap integration and whale path were derived from the user's customized **DeepSeek Harness for VSCode**, publisher **Vithrive**, original package `vithrive.deepseek-harness-vscode` 1.0.0. Its included license is MIT, copyright 2026 dsh-vscode-panel contributors. That notice is retained in `LICENSE`. The independent project reorganizes and extends the integration; it does not claim exclusive authorship of those parts.

The DeepSeek name and whale mark belong to their respective owners and are used to identify DeepSeek Harness integration. An MIT source license does not grant trademark rights. No official affiliation is implied.

`js-yaml` is distributed under the MIT license. Its complete copyright and license notice follow below. Development dependencies retain their own licenses. Bundled runtime dependencies are listed in runtime/package-lock.json and runtime/licenses.json, with their license files retained inside runtime/node_modules.

The VSIX bundles public DeepSeek Harness 0.2.1-rc.2 packages (MIT), WorkBuddy Connect 0.6.10 from public Git commit 4738217d156c46f088d424dedc83a66e7308f64a (MIT), pnpm and Node 24.21.0. Their original notices remain in runtime/node_modules and runtime/bin/NODE-LICENSE. No private desktop Host or Electron application is copied. Account configuration, credentials and conversation data are never included in the VSIX or source archive.

As of 2026-10-25, the former `masknull/dsh-workbuddy-connect` download address returns 404. Builds fetch the same pinned commit from the public [Lewis-0710/dsh-workbuddy-connect fork](https://github.com/Lewis-0710/dsh-workbuddy-connect/commit/4738217d156c46f088d424dedc83a66e7308f64a). The commit, version, lockfile integrity and original copyright/license remain unchanged; no newer fork changes are included.

TypeBox 1.3.27 (MIT) is rebundled with esbuild to reduce startup file reads. Its public ESM entry paths, adjacent declarations and shared module identity are preserved. Original license files and notices remain in its package directory; runtime/bundle-manifest.json records the build tool and generated files.

The pinned zod 4.4.3, execa 10.2.0, yaml 2.9.1 and semver 7.8.5 libraries (MIT/ISC as recorded in their retained license files) are also rebundled with esbuild to reduce startup file reads. Public paths, shared library state and declarations remain in their package directories. runtime/startup-bundle-manifest.json records generated artifacts and hashes. Zod's CommonJS distribution and YAML's browser distribution are unchanged.

The packaged WorkBuddy Connect 0.6.10 host entry has one checked modification at credential-store construction, composing the Companion-owned read-only desktop access adapter. Its original license and notices are retained. Desktop-installed packages and credentials are not modified.

## js-yaml license

(The MIT License)

Copyright (C) 2011-2015 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
