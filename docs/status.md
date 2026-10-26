# Current status

0.4.0-preview.4 is a desktop-connected local preview with capability-gated background startup and official Desktop update reminders. 0.3.10 remains the published independent-runtime release; no 0.4 preview installer is published.

Implemented: desktop process/port discovery, loopback authentication and proxying; missing/stopped desktop actions; desktop-owned login, configuration and sessions; existing sidebar, history-first navigation and unsaved code references; six-hour and manual update checks with user-controlled downloads. `src/desktop/` owns the desktop integration; independent-runtime source lives only in historical test fixtures. Packaging stages only the public distribution files.

Validation evidence for this preview will be recorded in validation.md and local package reports. It uses the installed desktop program's Host with synthetic data, not a second bundled runtime or the user's daily profile.

Before later publication, hosted CI needs a verified desktop installer/fixture preparation step. Future desktop UI protocol changes may require an extension update. Legacy independent-plugin data is retained and is not automatically merged into Desktop.

The background-reuse prerequisite failed on Desktop 0.2.1-rc.2: launching the desktop shell while a standalone Host runs starts a second Host against the same isolated profile. Both can read a previously saved session, but the shell does not attach to the first process. Automatic standalone Host startup is deliberately unimplemented. See [the reproduction and remaining questions](desktop-host-reuse.md). This is separate from the passing connection tests against one existing Host.

The coordinated Desktop 0.2.1-rc.3.20261026.1 build and Companion preview.2 passed local Windows packaging and installed-editor acceptance, including shared Host ownership, before the preview.3 refinement. The shell owns the single Host. These results do not change the historical stock-rc.2 limitation. A future official Desktop without the background-start capability retains the explicit-open action; reminders do not install or preserve unofficial patches automatically. See [shared-session-solution.md](shared-session-solution.md).
