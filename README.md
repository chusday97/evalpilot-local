# EvalPilot Local

EvalPilot Local 在你的电脑上评测 Web 产品：连接一个本地项目，模拟用户完成关键任务，保存截图与操作轨迹，并把问题整理成可交给 AI 编码工具的修复任务。代码和评测证据默认不离开本机。

> Public Alpha `0.5.0-alpha.1`。正式验证平台为 macOS；Linux 为实验性支持，Windows 暂未承诺。

## 三步开始

需要 Node.js 20.19.0 或更高版本。

```bash
npm install --global evalpilot-local@alpha
evalpilot doctor
evalpilot dashboard
```

如果 `doctor` 显示 Chromium 缺失，在确认会下载浏览器后运行：

```bash
evalpilot setup --install-chromium --confirmed
```

Dashboard 打开后，按照首页唯一高亮的下一步操作：

```mermaid
flowchart LR
  A["1. 添加项目"] --> B["2. 运行核心评测"]
  B --> C["3. 查看问题与证据"]
  C --> D["4. 选择 AI 修复"]
  D --> E["测试并复测后决定是否应用"]
```

第一次使用时，你需要准备：被测项目文件夹、可访问的本地测试网址，以及该项目的启动命令。目标是在 15 分钟内打开第一份报告。

如果你是首次使用者，可以按 [Public Alpha 15 分钟测试指南](https://github.com/chusday97/evalpilot-local/blob/main/docs/04-validation/PUBLIC_ALPHA_TEST_GUIDE.md) 完成一次不需要了解内部术语的验收。反馈前请先脱敏，不要上传源码、Trace、密钥或完整评测目录。

## Dashboard

![EvalPilot Local Dashboard](https://raw.githubusercontent.com/chusday97/evalpilot-local/main/docs/assets/dashboard.png)

首页用四步流程说明当前进度，右侧显示最近一次评测；评测完成后会自动进入对应报告，不需要识别内部运行编号。

## Public Alpha 支持范围

| 能力 | Codex | Claude Code | Antigravity | 其他 Agent |
|---|---|---|---|---|
| 发现近期工作区 | 支持安全路径元数据 | 不读取会话文件，手动选文件夹 | 检测到公开工作区元数据时支持 | 手动选文件夹 |
| 直接修改 | 暂不支持 | 暂不支持 | 暂不支持 | 暂不支持 |
| 导出修复任务包 | 支持 | 支持 | 支持 | 支持 |

Public Alpha 尚未完成真实 Codex before/after 验收，因此所有 Agent 都只提供任务包交接，不会自动修改或合并代码。Claude Code 和 Antigravity 不会被静默转交给 Codex。未实现的竞品搜索不会显示在当前 Dashboard 或正式 API 中。

## 评测结果是什么

EvalPilot 分开显示“通过、失败、阻塞、不适用”。如果项目没有业务 API，API 异常案例会标记为“不适用”，页面、按钮、表单和用户路径评测仍会继续；“不适用”不计为产品失败。

问题详情包含：发生页面、失败步骤、目标控件、实际与期望路径、截图/Trace/控制台/网络证据、可能原因、建议修改和复测标准。推测不会被包装成已确认根因。

## 数据与隐私

- 默认数据目录：`~/.evalpilot-local`
- 临时指定目录：`evalpilot --data-dir /path/to/data dashboard`
- 环境变量：`EVALPILOT_DATA_DIR=/path/to/data`
- 默认启动不会选择或写入旧项目内 `.evalpilot`。只读查看时可显式传入 `--data-dir .evalpilot`；迁移请在旧项目目录运行 `evalpilot migrate --confirmed`，原目录不会被覆盖。
- 不读取 `.env`、密钥、Token、Agent 对话或 Claude 会话 JSONL。
- 不自动上传代码、截图、Trace、日志或报告。
- 浏览器探索默认不执行删除、支付、发送、发布等不可逆操作。

分享报告或任务包前，请检查页面文本和截图是否包含业务或个人信息。

## 常用命令

```bash
evalpilot --version
evalpilot doctor
evalpilot doctor --json
evalpilot dashboard
evalpilot dashboard --port 4180
evalpilot --data-dir /path/to/data dashboard
```

底层分步 CLI（`init`、`scan`、`generate-background`、`generate-blueprint`、`generate-cases`、`run`、`report`）仍保留给需要调试流水线的开发者。

## 已知限制

- Public Alpha 仍需要具备 Node.js 环境的开发者协助安装。
- 只正式验证 macOS + Chromium。
- Codex、Claude Code、Antigravity 当前只提供任务包交接，不会自动执行或自动合并。
- 不提供云端账号、数据库、遥测或自动证据上传。
- AI 模拟与工程证据不等于真实用户满意度或业务指标。

## 从源码开发

```bash
git clone https://github.com/chusday97/evalpilot-local.git
cd evalpilot-local
npm ci
npm run check
npm test
npm run build
```

发布包还需通过：

```bash
npm run audit:package
npm run test:consumer
```

参见 [贡献指南](CONTRIBUTING.md)、[安全说明](SECURITY.md)、[支持说明](SUPPORT.md) 和 [路线图](ROADMAP.md)。

## License

[MIT](LICENSE)
