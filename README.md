# DSH Companion

将 DeepSeek Harness 集成到 VS Code 右侧栏，在当前项目中进行 AI 对话、引用代码和使用 Agent 工具。

插件内置独立的 DSH 运行时，打开侧栏即可自动准备后台，无需预先启动桌面应用，也无需为插件运行额外安装 Node.js。

## 功能

- **右侧栏对话**：从编辑器标题栏的鲸鱼按钮或命令面板打开，支持新建会话和浏览历史。
- **自动关联项目**：新会话绑定当前工作区，支持多根工作区；已有会话保留原来的工作路径。
- **代码上下文引用**：自动识别当前文件或选区，支持未保存的编辑内容，也可通过编辑器右键菜单显式引用；引用可单独移除。
- **跟随编辑器主题**：适配窄侧栏，颜色随 VS Code 主题变化。
- **DSH 功能入口**：在侧栏中选择模型、使用工具，并访问插件、自动化任务和设置。
- **后台自动管理**：同一数据目录下的多个 VS Code 窗口共享后台，最后一个连接释放后自动保存并退出。隐藏侧栏不会中断任务。
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

先按下方[构建步骤](#从源码构建)生成 `.vsix` 文件，再安装到 VS Code。安装包不直接存放在源码仓库中。

1. 打开 VS Code 的扩展视图。
2. 点击扩展视图右上角的 `…`，选择 **从 VSIX 安装…**（Install from VSIX）。
3. 选择生成的 `dsh-companion-<版本号>.vsix`。
4. 安装完成后，按提示重新加载窗口；也可在命令面板执行 `Developer: Reload Window`。

### 开始对话

1. 打开项目文件夹或工作区。
2. 点击编辑器标题栏的鲸鱼按钮，或执行 `DSH Companion: 打开右侧聊天`。
3. 在设置中确认模型连接可用，选择模型并新建会话。
4. 打开文件或选中代码，确认输入框中的引用内容后发送消息。无需引用时，移除对应的引用项即可。

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

New-Item -ItemType Directory -Force -Path ..\outputs | Out-Null
npm run package
```

生成的安装包位于 `../outputs/dsh-companion-<版本号>.vsix`，版本号取自 `package.json`。按照上方安装步骤加载即可。

`prepare-runtime` 安装锁定的 DSH 依赖，下载并校验内置 Node.js，完成依赖准备；修改运行时源码后，`build:runtime` 单独复制入口并应用受控适配。集成测试和打包会执行该构建步骤，日常单测不会执行。

`test:native` 自动生成合成多根工作区，并使用隔离的 VS Code 配置和桌面数据来源。默认查找当前用户安装的 Microsoft VS Code；其他安装位置可通过 `VSCODE_EXECUTABLE` 指定 `Code.exe`。不会使用真实登录或调用模型。生成的测试工作区和结果位于 `.test-work`。

| 脚本 | 作用 |
| --- | --- |
| `npm run prepare-runtime` | 准备干净、锁定版本的运行时依赖和内置 Node.js |
| `npm run build` | 仅构建扩展、侧栏和单元测试入口 |
| `npm run build:runtime` | 复制运行时入口并应用适配；需先准备运行时依赖 |
| `npm run check` | 严格检查 TypeScript，以及运行时和构建脚本的 JavaScript |
| `npm test` / `npm run test:unit` | 构建并运行轻量单元测试 |
| `npm run test:integration` | 验证真实运行时、多窗口、迁移和授权隔离 |
| `npm run test:native` | 自动准备合成环境并执行真实 VS Code/Webview 验收 |
| `npm run package` | 检查运行时完整性、版本、许可证和必要契约，再生成 Windows x64 VSIX |

常规自动化测试使用合成用例和本地拦截，不调用付费模型。

## 数据与兼容性

DSH Companion 使用 VS Code 提供的独立数据目录。已有桌面 DSH 的数据来源根据当前用户环境发现，不依赖固定用户名或安装路径。

首次导入用于衔接已有配置与历史，不会持续双向同步两端的配置和会话。未完成或包含待处理输入的历史会话会跳过；桌面端的会话置顶、排序、归档以及全部第三方插件状态不属于完整迁移范围。

模型连接、插件和工具的可用性取决于相应服务及其配置。更详细的数据范围与兼容性约定见[功能规范](docs/spec.md)。

## 文档与贡献

GitHub 自动检查的触发条件、检查范围及本地复现步骤见[CI 说明](docs/ci.md)。检查流程不构建或上传安装包，不执行发布。

- [功能规范](docs/spec.md)：功能范围、数据迁移与运行行为。
- [架构设计](docs/architecture.md)：运行时、编辑器上下文、引用和侧栏的职责划分。
- [隐私与发布规则](docs/privacy.md)：用户环境发现、敏感数据排除和发布前检查。
- [验证范围](docs/validation.md)：已有验证与未覆盖场景。

欢迎通过 [Issues](https://github.com/2061623884/dsh-companion/issues) 提交问题或建议。报告问题时请提供系统、VS Code 与插件版本、复现步骤和错误代码，并移除密钥、访问令牌、个人路径及真实会话内容。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方代码、运行时依赖和品牌标识的说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
