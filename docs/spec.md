# Desktop-connected preview specification

The approved 0.4.0-preview.1 direction is to connect directly to the installed desktop application and share its runtime, login, configuration and sessions. No independent runtime is started or bundled. This replaces the independent-runtime specifications used by versions through 0.3.10.

- Keep the blue whale editor-title entry, theme, narrow sidebar, loading animation, history-first navigation and code references including unsaved selections.
- Use Desktop's own authenticated loopback interfaces. Do not copy, merge or directly edit credentials, profiles or session files.
- Missing installation: offer the official download page. Installed but stopped: offer an explicit open action. Ready: connect. Interrupted: preserve a clear recovery action and rediscover the Host after restart.
- Reuse the running Desktop version. Do not promise compatibility with arbitrary future private UI contracts; fail visibly when incompatible.
- Preserve legacy independent Companion data, without automatic migration or deletion.
- Validate using the installed desktop runtime and isolated synthetic data. Do not use daily login/sessions or call real models.
- Deliver a local preview package and rendered evidence. Do not install into the daily environment, commit, push, tag or publish during this preview request.
