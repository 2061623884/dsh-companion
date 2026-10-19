# Development rules

Keep the four modules cohesive: DesktopConnection, EditorContext, ReferenceController and SidebarView. DSH-specific runtime objects and DOM assumptions belong only in the private browser adapter. Test observable behavior through module interfaces.

Only connect to an existing local desktop DSH. Never install, start, stop or reconfigure the user's backend. Never log credentials, authorization headers or source text. Network/user input are validation boundaries; preserve safe error codes, do not swallow unexpected failures or silently fall back.

Make the minimum required change. No speculative providers, remote modes, abstractions or unrelated refactors. Build/typecheck/tests and native integration acceptance are distinct; record unverified cases. Do not publish or push without an explicit request.
