# 配套桌面端源码补丁

`desktop-background-start.patch` 是针对 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的增量补丁。准确基线为 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，对应 DSH `0.2.1-rc.3`。补丁保留上游 MIT 许可归属，不包含运行时、安装包、账号、配置或会话数据。

在该上游源码检出目录中执行，补丁路径替换为本仓库的实际位置：

```powershell
git checkout --detach 22ddee3792402c3e70ec5f86a63c3e3e895a2f60
git apply --check <companion-repository>/patches/desktop-background-start.patch
git apply <companion-repository>/patches/desktop-background-start.patch
```

补丁包含桌面外壳的后台启动意图、单实例唤起行为、能力声明及相关测试。它已经与本机已验证桌面构建的源码逐项核对，并在准确基线的隔离索引上通过适用性检查。构建前仍需遵守上游 `AGENTS.md`、Windows 打包/签名指南及完整版本号确认流程。本地已验收的测试版本为 `0.2.1-rc.3.20261026.1`；仓库中没有该安装包。

仅安装 Companion 不会给官方桌面端新增后台模式。安装从该补丁构建的桌面端后，Companion 才能通过其能力声明请求后台启动。不要给未修改的桌面端手工添加能力文件。实现和兼容范围见 [源码方案](../docs/shared-session-solution.md)，本地验证范围见 [验证记录](../docs/validation.md)。
