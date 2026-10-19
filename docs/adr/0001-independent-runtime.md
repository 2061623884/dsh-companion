# Independent runtime and one-time migration

Companion bundles its own public DSH Web runtime and uses an independent home. Desktop DSH remains unmodified. This replaces hidden desktop startup and deliberately gives up live cross-client configuration sharing: the current DSH JSON domain storage has no cross-process write locking and schedulers are host-local.

All VS Code windows using the same Companion home share one named-pipe-owned runtime. The last client disconnect triggers bounded shutdown after a five-second reconnection grace. Configuration and completed historical sessions are imported once; WorkBuddy receives a fresh login, and only previously skipped historical IDs may be retried on later startup.
