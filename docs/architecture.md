# Architecture

RuntimeConnection exposes start/reconnect/dispose and hides the bundled process, dynamic port, browser authentication and local HTTP/SSE/WebSocket proxy. RuntimeClient privately maintains a named-pipe lease. The owning host binds the pipe before importing or starting DSH; losing startup contenders exit without booting another core. A ready response is sent only after the Web server and connection services are available.

The host owns one-time migration, public runProfile bootstrap and last-client shutdown. Migration uses a small read-only Cordis persistence scope; it never creates or resumes an Agent. It filters settings and credential records, checks source revisions, and excludes durable pending inputs/unclosed turns. Caches are generated only in Companion home.

EditorContext and ReferenceController remain independent of the runtime. SidebarView consumes the connection interface and editor messages. DSH-specific browser objects remain in the private browser adapter. The existing proxy injects adaptation assets into Companion's frontend only.

The packaged core dependency family is pinned to 0.2.1-rc.2; overrides prevent WorkBuddy's broad peer ranges from installing a second DSH generation. WorkBuddy 0.6.10 is built from its fixed public Git commit. Node 24.21.0 is downloaded from nodejs.org and SHA256-verified at packaging time. User startup performs no runtime download.

Desktop DSH may run concurrently with its own home and process. Companion neither attaches to nor controls it. See ADR 0001 and docs/spec.md for lifecycle and migration decisions.
