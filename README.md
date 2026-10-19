# BlockCraft AI

> 把想法，搭成现实 —— 和吉祥物 Mochi 一起，用"积木"的方式把一句创意变成可用的表单/名单/统计/计时应用。
> 状态：课程演示阶段（前端 React 19 + Vite 8 + TypeScript；后端 Node 原生 HTTP，无第三方运行时依赖；生成入口带付费网关与授权门）。

## 演示入口（三个页面）

| 路由 | 内容 | 演示定位 |
| --- | --- | --- |
| `/ai-create` | **AI 创作主线**："创建方式"二选一——**可信番茄钟（离线演示）**：一键加载固定 25 分钟番茄钟应用，零网络零密钥；**AI 应用（原有 v1）**：一句话生成应用（需服务端授权），然后 Workshop 编辑（B 模式）/运行（C 模式） | **正式演示主线** |
| `/` | 旧版"学习管理 Demo"（需求澄清 + MochiPanel，面板标注 **Mock**，不调用 AI） | 历史演示，可作为辅助 |
| `/app-renderer` | 通用应用预览示例（社团报名 / 阅读记录 两套内置示例） | 展示 C 模式渲染能力 |

## 本地启动

要求：Node >= 22.16（推荐 24，QA 在 24.21 实测）；浏览器测试另需 Playwright Chromium。

```sh
npm install                           # 根目录安装即可，server 目录无需单独安装
npm --prefix server run build         # 首次需要：生成 server/.generated（QA 实测缺失会导致后端无法启动）
npm --prefix server start             # 终端 1：后端，监听 127.0.0.1:3001
npm run dev -- --host 127.0.0.1       # 终端 2：前端 Vite（默认 5173），/api 自动代理到 3001
```

打开 `http://127.0.0.1:5173/ai-create`（以 Vite 实际端口为准）。

## 测试与构建

```sh
npm test                    # 根目录单测（node --test，无需网络与密钥）
npm --prefix server test    # server 侧测试
npm run build               # tsc -b && vite build
npm run test:workshop-export:browser        # 项目 ZIP 导出浏览器测试
node tests/demo/qa-demo.browser.cjs         # 演示 QA harness（需 npm i --no-save playwright@1.64.1；15 项检查）
```

## AI 能力边界（重要，请如实向评委说明）

- **两条演示线如实分开**：
  - **可信番茄钟（离线演示）**：加载内置固定 Fixture，页面标注来源"离线固定 Fixture，非真实 DeepSeek 调用"；不根据自然语言生成内容，零费用。
  - **AI 应用（原有 v1）**：前端向同源 `/api/ai/generate` 发送 `{idea}`。该接口有**授权门**：未获服务端授权（paid-gateway 注入）时返回 `401 UNAUTHORIZED`；授权通过但未配置 `DEEPSEEK_API_KEY` 时返回 `503 AI_NOT_CONFIGURED`。**是否调用真实大模型由服务端配置与授权决定**，配置后可能产生费用；无自动重试，失败/取消保留当前应用与数据。
  - 模型输出必须通过既有 `assertAppSpec` 校验与完整性检查；AI 只产出数据，不执行代码。
- **Mochi 对话式修改：未启用**。Workshop Mochi 面板明确显示"AI 修改能力尚未启用：DeepSeek 修改计划 API 尚未接入"。旧 `/` 页面 MochiPanel 标注 **Mock**，回复为本地固定引导。**不要把"生成"能力表述成"对话式实时修改"。**
- 数据仅存当前页面内存，刷新即清空；无登录、无后端持久化。

## 成果导出

- Workshop 内"**导出 React 项目**"可把当前应用导出为可构建的 ZIP（`tools/project-zip-export` 与 `npm run test:workshop-export*` 有独立测试与证据）。

## 已知限制

- 仅支持表单/名单/统计/番茄钟计时等已实现积木；不支持多实体组合等更高阶业务。
- 后端为本机服务：仅监听 127.0.0.1、单进程限流（每 IP 每分钟 10 次）、无用户认证，**请勿暴露公网**（详见 `server/README.md`）。
- `vite preview` 不含开发代理；生产部署需自行提供同源 `/api` 反向代理。
- Windows 注意：git 检出行尾（autocrlf）可能触发 v1 生成投影自检 fail-closed（详见 `deliverables/DEMO-QA-REPORT.md` FINDING F1）；离线主线不受影响。

## 目录速览

- `src/` 前端源码（`components/ai-create`、`components/app-builder`、`app-renderer`、`integrations/` 等）
- `server/` 本机生成服务（接口协议、401 授权门与安全约束见 `server/README.md`）
- `docs/` 各阶段协议与验收文档；`tests/` 单测与浏览器测试（含 `tests/demo/` 演示 QA harness）
- `deliverables/` 演示 QA 报告、演示脚本、检查清单与文档问题清单；`audit-evidence/` 运行证据