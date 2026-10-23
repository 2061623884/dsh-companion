# DSH Companion

在 VS Code 中使用 DeepSeek Harness（DSH）：围绕当前项目对话、引用代码，并使用 DSH 的 Agent 工具完成开发任务。

DSH Companion 是一个 VS Code 插件，将 DSH 的聊天与工具界面放在编辑器右侧栏，自动关联当前工作区、文件和代码选区。安装包内置 Node.js 与 DSH 运行时，无需单独启动后台。配置和会话保存在插件的数据目录中；已使用桌面 DSH 的用户可以共用登录。

当前版本 **0.3.8**，支持 Windows x64 和本机 VS Code。下载入口见 [GitHub Releases](https://github.com/2061623884/dsh-companion/releases/latest)，开发进度与已知限制见[项目状态](docs/status.md)。

这是基于公开 DSH 组件构建的独立社区项目，与上游的品牌及第三方组件关系见[第三方说明](THIRD_PARTY_NOTICES.md)。

## 功能

- **右侧栏对话**：从编辑器标题栏的鲸鱼按钮或命令面板打开，支持新建会话、浏览历史和继续已有对话。
- **自动关联项目**：新会话绑定当前工作区，支持多根工作区；已有会话保留原来的工作路径。
- **代码上下文引用**：自动识别当前文件或选区，支持未保存的编辑内容，也可通过编辑器右键菜单显式引用；引用可单独移除。
- **跟随编辑器主题**：适配窄侧栏，颜色随 VS Code 主题变化；数字鲸鱼动画覆盖启动与界面加载，界面就绪后自然淡出。
- **DSH 功能入口**：在侧栏中选择模型、使用工具，并访问插件、自动化任务和设置。
- **后台自动管理**：同一数据目录下的多个 VS Code 窗口共享后台，最后一个连接释放后自动保存并退出。隐藏侧栏不会中断任务。
- **与桌面端共享登录**：与桌面 DSH 共用同一份凭据（如 DeepSeek 账号登录、API Key），任一端登录、退出或修改 Key，另一端即时生效，无需在插件中重复登录。
- **已有环境衔接**：首次使用时可导入已有桌面 DSH 的兼容模型配置和已完成的会话历史，保留原始数据。

## 支持环境

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows x64 |
| 编辑器 | VS Code 1.106.0 或以上 |
| 工作区 | 本机工作区，支持多根工作区 |
| 模型服务 | 在 DSH 设置中配置可用的模型连接 |

macOS、Linux、WSL 和远程工作区暂不在当前版本的支持范围内。

## 安装与使用

### 安装 VSIX

从 [GitHub Releases](https://github.com/2061623884/dsh-companion/releases/latest) 下载 Windows x64 的 `.vsix` 和 `SHA256SUMS`，核对 SHA-256 后安装。也可按下方[构建步骤](#从源码构建)自行生成安装包。

1. 打开 VS Code 的扩展视图。
2. 点击扩展视图右上角的 `…`，选择 **从 VSIX 安装…**（Install from VSIX）。
3. 选择下载或构建得到的 `dsh-companion-<版本号>-win32-x64.vsix`。
4. 安装完成后，按提示重新加载窗口；也可在命令面板执行 `Developer: Reload Window`。

### 开始对话

1. 打开项目文件夹或工作区。
2. 点击编辑器标题栏的鲸鱼按钮，或执行 `DSH Companion: 打开右侧聊天`。
3. 在设置中确认模型连接可用，选择模型并新建会话。
4. 打开文件或选中代码，确认输入框中的引用内容后发送消息。无需引用时，移除对应的引用项即可。

### 会话导航

当前源码中的顶部导航使用同一个位置切换入口：聊天页显示时钟图标，点击查看历史会话；历史页显示纯返回箭头，点击回到聊天。选择历史会话后会直接打开对话，入口恢复为时钟图标。插件、自动化任务和设置页面也使用同样的返回箭头，按钮尺寸和配色随编辑器主题保持一致。

此导航调整已合入主分支，尚未随新的发布版本分发；上方下载入口仍为 0.3.8。

### 更新与保留数据

更新时直接安装新的 VSIX，按提示重新加载窗口即可。插件的配置和会话与安装文件分开保存，覆盖安装无需清空数据目录。与桌面端共用的登录状态会继续保留。

### 常用命令

在 VS Code 命令面板中搜索 `DSH Companion`：

| 命令 | 用途 |
| --- | --- |
| `DSH Companion: 打开右侧聊天` | 显示聊天侧栏 |
| `DSH Companion: 重新连接后台` | 重新建立后台连接 |
| `DSH Companion: 引用当前文件或选区` | 将当前编辑器内容加入引用 |

## 从源码构建

### 准备工具

在 Windows x64 上准备：

- Node.js 24 和 npm。
- Git，并确保能够访问 GitHub 上的项目依赖。
- Windows PowerShell，运行时准备脚本会使用 `powershell.exe` 解压文件。
- 可访问 npm registry、GitHub 和 nodejs.org 的网络环境。

这些是构建工具要求。安装生成的 VSIX 后，插件使用包内运行时。

### 获取源码与依赖

在 PowerShell 中执行：

```powershell
git clone https://github.com/2061623884/dsh-companion.git
cd dsh-companion

npm ci
npm run check
npm test
```

日常检查、构建和单元测试只需要根目录依赖，不需要安装 DSH 运行时或准备内置 Node.js，也不会改写运行时依赖。

### 完整运行时验证与打包

```powershell
npm run prepare-runtime
npm run test:integration

# 已安装 Microsoft VS Code 时，可执行隔离的原生验收
npm run test:native

npm run package
```

生成的安装包位于 `.test-work/release/dsh-companion-<版本号>-win32-x64.vsix`，版本号取自 `package.json`。按照上方安装步骤加载即可。

`prepare-runtime` 安装锁定的 DSH 依赖，下载并校验内置 Node.js，完成依赖准备；修改运行时源码后，`build:runtime` 单独复制入口并应用受控适配。集成测试和打包会执行该构建步骤，日常单测不会执行。

`test:native` 自动生成合成多根工作区，并使用隔离的 VS Code 配置和桌面数据来源。默认查找当前用户安装的 Microsoft VS Code；其他安装位置可通过 `VSCODE_EXECUTABLE` 指定 `Code.exe`。不会使用真实登录或调用模型。生成的测试工作区和结果位于 `.test-work`。

| 脚本 | 作用 |
| --- | --- |
| `npm run prepare-runtime` | 准备干净、锁定版本的运行时依赖和内置 Node.js |
| `npm run build` | 仅构建扩展、侧栏和单元测试入口 |
| `npm run build:runtime` | 复制运行时入口并应用适配；需先准备运行时依赖 |
| `npm run check` | 严格检查 TypeScript，以及运行时和构建脚本的 JavaScript |
| `npm test` / `npm run test:unit` | 构建并运行轻量单元测试 |
| `npm run test:integration` | 验证真实运行时、多窗口、迁移和共享登录 |
| `npm run test:native` | 自动准备合成环境并执行真实 VS Code/Webview 验收 |
| `npm run package` | 检查运行时完整性、版本、许可证和必要契约，再生成 Windows x64 VSIX |
| `npm run check:release` | 检查最终 VSIX 的文件清单、内容、版本与隐私，生成 SHA-256；需先准备安全检查工具 |
| `npm run test:release` | 将检查过的 VSIX 安装到隔离环境，在最低版本与固定版本 VS Code 验收 |
| `npm run prepare:release` | 使用同一份已验收 VSIX，在本地生成发布清单、说明和校验文件 |
| `npm run check:candidate -- <目录> <提交SHA> <包SHA256>` | 校验候选文件、预期来源与校验信息 |
| `npm run preview:release -- <目录> <提交SHA> <包SHA256>` | 预演发布计划；始终不上传、不创建标签或 Release |

常规自动化测试使用合成用例和本地拦截，不调用付费模型。

## 数据与兼容性

DSH Companion 使用 VS Code 提供的独立数据目录。已有桌面 DSH 的数据来源根据当前用户环境发现，不依赖固定用户名或安装路径。

凭据例外：插件直接读写桌面数据目录中的 `.credentials.yaml`，与桌面端共用登录状态和 API Key，不在插件目录保存副本。两端账号模块解析出的 `platformOrigin` 必须一致；不一致时，插件保留登录并显示 `DSH_ACCOUNT_PLATFORM_MISMATCH`，统一两端账号平台配置后重新连接即可。插件不会根据凭据自动切换平台。自行保存凭据的第三方插件不属于这项通用共享机制。

首次导入用于衔接已有配置与历史，不会持续双向同步两端的配置和会话。未完成或包含待处理输入的历史会话会跳过；桌面端的会话置顶、排序、归档以及全部第三方插件状态不属于完整迁移范围。

模型连接、插件和工具的可用性取决于相应服务及其配置。更详细的数据范围与兼容性约定见[功能规范](docs/spec.md)。

## 文档与贡献

GitHub 日常自动检查见[CI 说明](docs/ci.md)，不构建或上传安装包。独立的[发布准备流程](docs/release.md)仅手动运行，在临时环境构建并验证 VSIX，不上传安装包、不创建标签或 Release。

- [项目状态](docs/status.md)：当前进度、验收结果与剩余问题。
- [功能规范](docs/spec.md)：功能范围、数据迁移与运行行为。
- [架构设计](docs/architecture.md)：运行时、编辑器上下文、引用和侧栏的职责划分。
- [隐私与发布规则](docs/privacy.md)：用户环境发现、敏感数据排除和发布前检查。
- [验证范围](docs/validation.md)：已有验证与未覆盖场景。

欢迎通过 [Issues](https://github.com/2061623884/dsh-companion/issues) 提交问题或建议。报告问题时请提供系统、VS Code 与插件版本、复现步骤和错误代码，并移除密钥、访问令牌、个人路径及真实会话内容。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方代码、运行时依赖和品牌标识的说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
