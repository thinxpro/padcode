# Padcode

用游戏手柄操作你自己的 AI Coding Agent。

Padcode 是计划通过终端安装的本地开发工具。用户自行选择终端、项目、Agent 和账号；Padcode 提供手柄输入、按键映射、终端会话桥接，以及可选的 Agent 适配能力。

**当前状态：蓝牙优先终端配置开发版，实体手柄验收待完成。** 已实现首次向导、本地配置、macOS 蓝牙扫描/配对/连接、SDL 输入验证和游戏风格仪表盘；尚未实现 Agent 会话或发布 npm registry 软件包。仓库目前为 private，完成验证和发布准备后再决定转 public。Padcode 是暂定名称，npm 和 Homebrew 名称可用性尚未确认。

## 运行当前开发版

开发前置：Node.js 22.14+（推荐 Node 22 LTS）、npm、CMake 3.24+、C/C++ 编译器；macOS 使用 Xcode/Command Line Tools。完整测试还需要 Python 3 和 `pgrep`。这些是开发者要求，最终用户免编译安装将在 P1 实现。

```sh
npm ci --ignore-scripts
npm run check
node dist/cli.js demo
node dist/cli.js
```

首次原生构建会从 SDL 官方 GitHub 下载校验和锁定的源码，需要联网。`demo` 为明确标记的模拟预览；`controllers` 显示真实设备状态。Q / Esc 退出，Ctrl+C 中断。`controllers --json` 输出事件流，支持管道。界面支持窄终端、`NO_COLOR` 和 `TERM=dumb`；没有硬件时显示等待连接。

无参数交互启动会进入首次向导，已有配置时进入 Player Hub。`node dist/cli.js config` 重新配置。配置保存在 `$XDG_CONFIG_HOME/padcode/config.json`（环境变量须为绝对路径），默认 `~/.config/padcode/config.json`。当前工具只保存选定的 Agent 命令与参数，不启动 Agent、不收集凭据。

完整使用流程和 macOS 系统授权边界见 [终端配置指南](docs/setup.md)。物理硬件结果以 [蓝牙阶段验收报告](docs/stages/p0-config-validation.md) 为准。

## 用 npm 安装本地测试包

本地构建并测试通过后可以生成当前机器平台专用包；不用 npm 发布账号：

```sh
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
npm install -g ./artifacts/padcode-0.1.0-dev.1.tgz
padcode
```

包内包含已编译 helper，安装不运行编译脚本。该测试包仅适用于构建时的平台/CPU，不是已发布的通用包。CI 会在临时目录执行同等安装并测试向导，避免修改用户全局环境。

## 产品边界

- 通过 CLI 安装和启动，不交付独立桌面 App 或 DMG。
- 用户自带并登录 AI Coding Agent；支持选择已安装命令或填写自定义命令。
- 保留所选 Agent 原有的终端交互，键盘与手柄可以并用。
- 无自建模型服务、账号体系、提示词代理、云端执行或托管代码服务。
- 配置和运行记录保存在本机；所选 Agent 的联网、模型计费和数据处理由它自身决定。
- 语音输入和桌面控制属于可选扩展，不是基础使用条件。

## 预期使用体验

以下为目标体验，**目前请勿把这些命令当作安装说明执行**：

```sh
npm install -g padcode
cd my-project
padcode
```

首次启动：检测控制器 → 选择本机 Agent 命令或自定义命令 → 选择按键方案 → 启动会话。

当前 `padcode` 提供终端向导/Player Hub，`padcode config` 已实现；Agent 会话启动与 `padcode doctor` 仍待后续阶段。

## 首版范围

目标首版为 macOS + DualShock 4 蓝牙优先 + 单个前台终端会话。USB 为备选。用户将可通过通用模式启动自己的交互式 CLI，手柄映射基础按键，键盘继续可用。Windows/Linux 逐平台验证后再声明物理手柄支持。

首版不内置 Coding Agent，也不强制依赖某个厂商的 API。结构化 Agent 适配、语音、全局鼠标控制、多会话和后台驻留留待后续阶段。

## 方案文档

| 文档 | 内容 |
| --- | --- |
| [产品方案](docs/product.md) | 用户流程、功能范围、交互约束 |
| [技术架构](docs/architecture.md) | CLI、SDL3、PTY、输入路由与进程生命周期 |
| [Agent 兼容设计](docs/agent-integration.md) | 通用模式、按键配置、可选结构化适配 |
| [安装与发布](docs/distribution.md) | npm 优先、二进制分发、Homebrew/curl、公开准备 |
| [开发路线与验收](docs/roadmap.md) | 阶段任务、验证方法、完成标准 |
| [决策记录](docs/decisions.md) | 已确定事项与待验证事项 |
| [协作约定](CONTRIBUTING.md) | 开发范围、PR 与测试记录 |

## 开始开发

当前执行 [蓝牙优先配置阶段](docs/stages/p0-config-bluetooth.md)，依赖 Controller Lab。下一独立任务为 P0-2 PTY 会话桥接，需先提交该阶段计划和验收标准，再编写代码。每个任务通过 PR 提交，自动化检查全部通过且必需真机验收完成后才可标记 ready。

项目使用 [MIT License](LICENSE)。第三方依赖适用各自许可证，见 [依赖声明](THIRD_PARTY_NOTICES.md)。
