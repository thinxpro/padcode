# Padcode

用游戏手柄操作你自己的 AI Coding Agent。

Padcode 是计划通过终端安装的本地开发工具。用户自行选择终端、项目、Agent 和账号；Padcode 提供手柄输入、按键映射、终端会话桥接，以及可选的 Agent 适配能力。

**当前状态：方案与开发准备阶段，尚无可安装的软件包或可运行实现。** 仓库目前为 private，计划在完成首版验证和发布准备后再转为 public。Padcode 是暂定名称，npm 和 Homebrew 名称可用性尚未确认。

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

后续在项目目录运行 `padcode` 即使用已保存的配置。计划提供 `padcode config` 和 `padcode doctor`，用于配置和诊断。

## 首版范围

macOS + DualShock 4 USB + 单个前台终端会话。用户可通过通用模式启动自己的交互式 CLI，手柄映射基础按键，键盘继续可用。蓝牙随后验证，Windows/Linux 逐平台验证后再声明支持。

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

下一步从 [P0 技术验证](docs/roadmap.md#p0技术验证) 开始：先验证 SDL3 输入和 PTY 透明转发，再实现配置向导。当前仓库没有源码构建、测试或安装命令。

开源许可证尚未选择；转 public 前由维护者确定。当前没有授予开源许可。
