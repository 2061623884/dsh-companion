# DSH Companion

独立的 VS Code 扩展，把**已经运行的 Windows 桌面 DeepSeek Harness**接入右侧聊天栏。它不是模型服务，也不会安装、启动或修改另一套 DSH。

首版适配桌面 DSH **0.2.1-rc.2**；桌面前端接口尚未成为稳定公开 API，升级后需要重新验证。首版只支持 Windows 本地工作区，远程 SSH/WSL 工作区暂不支持。

## 使用

1. 打开已有桌面 DSH，并在桌面端完成模型和账号配置。
2. 安装本项目的 VSIX。在 VS Code 编辑器右上角点击鲸鱼图标，或运行 `DSH Companion: 打开右侧聊天`。
3. 工作目录自动跟随当前 VS Code 工作区；多根工作区跟随当前编辑文件所在目录。历史会话保留自己的目录，新会话采用当前目录。
4. 当前文件会成为输入框内的引用；选中代码时优先引用选区。点击引用的 × 可取消，同一选区编辑后不会自动加回，切换文件或选区后会重新引用。

选区发送当时保存的选中内容；整文件引用在发送时读取最新编辑缓冲区，包括未保存内容。引用内容会作为用户消息发送给桌面 DSH 使用的模型，请在发送前检查。不会后台发送代码。

桌面端重启或认证变化后，点击侧栏标题的重新连接按钮。发送失败不会自动重发；由用户检查草稿后决定重试。

`dshCompanion.diagnostics` 默认关闭。启用后输出到“DSH Companion”通道，只包含固定阶段名、耗时和字节数，不包含文件路径、代码或认证密钥。

拖拽的专门适配留待后续；没有额外的引用按钮和工作区路径提示。桌面端自己的插件、设置、历史和功能仍由桌面 DSH 管理。窄侧栏布局和主题只注入到本扩展页面，不修改桌面应用文件。

## 开发

需要 Node.js 22+ 和 npm：

```sh
npm ci
npm run check
npm test
npm run package
```

架构及兼容边界见 [docs/architecture.md](docs/architecture.md)，验收要求见 [docs/spec.md](docs/spec.md)，验证方法见 [docs/validation.md](docs/validation.md)。

包的发布者暂为 `local-development`，仅用于本地验证。开源或发布 Marketplace 前应由维护者填写自己的仓库地址、发布者标识并复核商标使用；本项目未发布到任何平台。

本项目从 DeepSeek Harness for VSCode 的定制原型整理而来，保留上游 MIT 许可与归属，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目与 DeepSeek 官方没有隶属关系。
