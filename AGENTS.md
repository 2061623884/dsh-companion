# Development rules

Keep desktop discovery/connection, EditorContext, ReferenceController and SidebarView cohesive. DSH UI objects and DOM assumptions belong only in the private browser adapter.

The product connects to the existing local Windows DeepSeek Harness Desktop Host. Desktop owns the runtime, login, profile settings and sessions. Never start a second DSH runtime, copy a profile or write session/configuration files directly. Read the browser grant only to authenticate the loopback connection. Show an official download action when Desktop is not installed, and open the detected application only after the user clicks the open action. Dispose only Companion connections; never stop Desktop. Desktop upgrades are followed by rediscovery/reconnection, with explicit errors for incompatible UI contracts.

Preserve the existing sidebar UI, navigation, automatic workspace binding and unsaved code references. Retain older independent Companion data without importing, merging or deleting it automatically. Legacy runtime preparation/source files may serve test fixtures but must never enter the VSIX or production dependency graph.

Make the minimum required change. No speculative providers, remote modes, abstractions or unrelated refactors. Build/typecheck/tests and native installed acceptance are distinct; record unverified cases. Use isolated synthetic desktop profiles and intercept external model traffic during acceptance. Do not install into the daily environment, commit, push or publish without an explicit request.

Derive installation/data locations from the current environment. Never log credentials, authorization headers or source text. Network/user input are validation boundaries; preserve safe error codes and do not swallow unexpected failures. Before publication inspect tracked files, reachable Git history and final archives for secrets and personal information; never commit local account evidence, raw diagnostics or personal paths. See docs/privacy.md.
