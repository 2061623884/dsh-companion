# DSH Companion

The VS Code client and its independently owned DSH execution environment.

## Language

**Companion runtime**: The DSH Web core owned by Companion, shared by VS Code windows using the same data home.
_Avoid_: desktop backend, hidden desktop

**Companion home**: The independent configuration, credentials, sessions and attachment data used by Companion.
_Avoid_: desktop profile

**Desktop home**: The existing desktop DSH data, used read-only during migration and for borrowed WorkBuddy access tokens.
_Avoid_: shared home

**Migration snapshot**: The initial copy of compatible configuration and historical data, with a recorded set of skipped session IDs.
_Avoid_: synchronization, shared history
