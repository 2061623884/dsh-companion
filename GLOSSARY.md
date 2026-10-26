# DSH Companion

The VS Code client of the existing DeepSeek Harness desktop application.

**Desktop Host**: The backend process owned and started by the installed desktop application. It is the sole runtime and data owner used by the product.

**Desktop home**: The existing DSH data directory, resolved from DSH_HOME or the current user's default .dsh directory. Configuration, credentials and sessions remain managed by Desktop.

**Desktop connection**: The extension's authenticated loopback HTTP/WebSocket proxy. It discovers the existing Host and forwards requests; releasing it does not stop Desktop.

**Private browser adapter**: The page-scoped navigation, editor context and reference integration injected only into the VS Code view. It does not modify the desktop application's installed files or layout.

**Legacy Companion home**: Data previously created by independent-runtime releases. The desktop-connected preview preserves it without automatic migration or deletion.
