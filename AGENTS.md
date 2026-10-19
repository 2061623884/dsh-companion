# Development rules

Keep RuntimeConnection, EditorContext, ReferenceController and SidebarView cohesive. Runtime bootstrap and one-time import belong behind RuntimeConnection; DSH UI objects and DOM assumptions belong only in the private browser adapter. Test observable behavior through module interfaces.

Ship a pinned public DSH Web runtime and Node inside the VSIX. Use an independent DSH_HOME under globalStorageUri; never start, stop or change desktop DSH. Import compatible models, API keys and historical logs/attachments once without changing their source; do not import browser grants, WorkBuddy OAuth tokens, automation or connectors. WorkBuddy requires a new login. One named pipe owns one runtime per data directory; all VS Code windows share it. Stop and save after the last client disconnects, with a five-second reconnection grace. Never log credentials, authorization headers or source text. Network/user input are validation boundaries; preserve safe error codes, do not swallow unexpected failures or silently fall back.

Make the minimum required change. No speculative providers, remote modes, abstractions or unrelated refactors. Build/typecheck/tests and native integration acceptance are distinct; record unverified cases. Do not publish or push without an explicit request.
