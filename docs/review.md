# Review: independent runtime 0.3.0

Fixed baseline: 0a6610a8987c1cadff75605616e6576b96e151df. Standards and Spec were reviewed by separate parallel agents; confirmed findings were repaired and each axis rechecked. Current contract: docs/spec.md and AGENTS.md. No push or publication.

## Standards

Four confirmed findings were repaired: retain the owner pipe until the owned process exits after saving; preserve safe shutdown errors; register the initial client before boot so rapid failures remain visible; clean unique temporary attachment files if an atomic replacement fails. Final review found no remaining actionable Standards issues.

RuntimeConnection retains start/reconnect/dispose as its interface. RuntimeClient owns the control lease, host owns bootstrap/lifecycle, and import owns migration. EditorContext and ReferenceController remain independent of runtime details; DSH object and DOM assumptions stay in the private browser adapter. The review found no new actionable coupling, interface leakage or speculative abstractions.

## Spec

Four confirmed findings were repaired: retry only the attachments referenced by eligible historical sessions; wait for an old version's last-client shutdown before launching its replacement; retain safe diagnostics for control-bind failure; validate existing destination attachments and atomically repair incomplete files before marking a retried session imported. Final review found no remaining actionable Spec issues.

The real bundled-runtime fixture now completes a previously skipped session, introduces a new desktop session and corrupts an existing destination attachment. Restart imports only the original skipped ID, excludes the new session, repairs the attachment, and preserves Companion configuration. The final affected check passed in 16.03s. Earlier full automated suite: 18 passed. Independent-home coexistence was additionally verified after extending the cold-start check.

Standards: 4 resolved, 0 remaining. Spec: 4 resolved, 0 remaining. Verification limits remain explicit in docs/validation.md; no account login, paid generation or official desktop simultaneous-window acceptance is claimed.
