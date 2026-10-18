# G2：DeepSeek 通用生成接线与 UI 保护

验收日期：2026-10-18。接线与离线回归完成。Tech Lead 已授权精确提交、发布分支并创建目标为 main 的独立 PR；等待最终代码审核，不自动合并或部署。

## 基线及部署重叠审计

- 通过已认证 GitHub connector 只读核实远端 main 为 `699ee2fd2c5ec0dca695d18b9468bdd7a69dbc43`，即已合并 G1 的 PR #13；交付前再次核实，未变化。
- `server/aiGenerationPrompt.mjs`、`server/aiGenerationQuality.mjs` 均已在该 main 中。
- 开工时检查全部 5 个现有 worktree，均无未提交改动。远端 13 个 PR 均已合并，没有打开的 PR；未发现独立部署 PR、部署分支或部署 worktree。远端 `server/index.mjs` 历史只有已在 main 的原后端提交 `d9a98a7`。只读差异审计未发现待合并的部署改动或重叠改写。
- 上述结论限于可见仓库状态，不能据此声称某个未提供编号的部署 PR 已合并。若另有尚未公开的部署工作，需要负责人另行比对本次小范围 diff。
- Git HTTPS fetch 缺少本机凭据；使用 connector 获取并核验 GitHub main 提交对象的精确 SHA，更新本地 `origin/main`。本地 main 及其他分支没有移动。
- 从已核实的 `origin/main` 创建独立分支 `feature/deepseek-general-integration`，worktree 为 `/Users/nanmuxun/BlockAI/BlockCraft-AI-deepseek-general-integration`。

| Worktree 目录 | 分支 | HEAD | 提交前状态 |
| --- | --- | --- | --- |
| BlockCraft-AI | main | 3e4a498 | 干净，保留原位置 |
| BlockCraft-AI-ai-quality | test/ai-quality | 3f6e1f3 | 干净 |
| BlockCraft-AI-change-planning | feature/ai-change-planning | bc324f7 | 干净 |
| BlockCraft-AI-general-generation | feature/general-ai-generation | 9ce50e9 | 干净 |
| BlockCraft-AI-text-compat | fix/ai-plan-text-compat | 60b8033 | 干净 |
| BlockCraft-AI-deepseek-general-integration | feature/deepseek-general-integration | 699ee2f | 本次 5 个未提交文件 |

## 实际修改文件

1. `server/index.mjs`：删除旧的内联 Prompt 构建，DeepSeek 请求改用 `buildGenerationMessages(idea)`；结构校验后调用 G1 独立完整性检查。
2. `tests/generation/compatibility.test.mjs`：断言真实路由发出的 messages；验证原始 AppSpec 响应兼容、不完整结果拒绝及失败后恢复。
3. `tests/generation/browser.cjs`：通过 Vite 同源代理访问真实本地后端，仅注入 DeepSeek fetch；验证多种结构、B/C 编辑和失败保留原应用。
4. `scripts/ai-create.browser.test.cjs`：修复旧验收脚本对默认模式及折叠入口的过时假设；补充原学习助手 Demo 的 B/C 与任务保留回归。
5. `docs/deepseek-general-integration.md`：本报告。

这是在既有 AppSpec v1 和既有 Renderer 能力内生成实体、字段与功能积木，不是 AI 自定义 React 组件生成能力。

产品代码只修改 `server/index.mjs`。没有引入行业模板、需求关键词分派或强制 form/list/metric 组合；测试样本不参与生产生成逻辑。

## 接线、响应与边界

真实执行路径为：`POST /api/ai/generate` → 原输入与安全检查 → `buildGenerationMessages(idea)` → 原 DeepSeek chat/completions 请求 → 原 JSON / AppSpec 校验 → `checkGeneratedApplication(spec, { idea })` 完整性门禁 → 原始 AppSpec v1。

成功仍返回未经包装的原始 AppSpec，错误仍为 `{ error: { code, message } }`。新增不完整结果错误为 HTTP 502、`AI_INCOMPLETE_APP`，消息为“AI 生成的应用不完整，缺少可操作的实体、字段或录入入口，请重试。”原 `AI_INVALID_SPEC` 等错误保持原状。前端沿用已有 HTTP 失败提示和应用保留行为，没有修改 UI 或客户端错误文案映射。

独立完整性门禁拒绝空实体/空积木/空字段、未绑定实体、没有录入入口及无法录入的字段。基础 AppSpec 验证器保持原样；门禁只用于新生成结果，不重新限制既有应用。

官方 endpoint、模型配置/默认值、JSON mode、stream、max_tokens、输入/响应字节限制、30 秒上游超时、取消、限流、并发限制、同源检查、密钥边界均保持原有实现。每次生成只发起一次上游请求，不增加自动修复或模型评审调用。

本阶段没有独立需求语义评审，`requirements.status` 仍为 `needs-review`。HTTP 200 仅表示结构合法且有可运行的录入路径，不能解释为自然语言需求已经完全满足；质量报告不包装进 AppSpec，也没有把 needs-review 改成 satisfied。

## 离线验证

| 命令 | 结果 |
| --- | --- |
| `npm run test:generation` | 23/23 通过 |
| `npm --prefix server test` | 23/23 通过，包含超时、限流、同源、并发、响应限制等既有检查 |
| `npm test` | 120/120 通过 |
| `node --test tests/ai-quality/*.test.cjs` | 83/83 通过 |
| `npm run build` | TypeScript + Vite 构建通过 |
| `git diff --check` | 通过 |

合计 249 项自动测试通过。7 种手写离线模型输出覆盖报名、训练流水、动作/器械资料、收支、失物招领、书籍、电影；包括单/多实体、不同字段及不同积木数量，且包含无独立 form 或无 metric 的应用。路由测试逐例断言 messages 等于 `buildGenerationMessages(idea)`、成功响应逐字段等于输入 Mock Spec；不完整结构返回失败，不产生第二次上游调用。

这些样本验证通用接线、可变输出契约和真实运行能力，不是 DeepSeek 实际生成结果，也不能证明线上模型对任意需求的语义质量。

## 浏览器回归

使用 Chromium / Playwright，两套脚本均通过，页面运行时异常与非 API 资源 HTTP 错误均为 0。

- `tests/generation/browser.cjs`：13 次真实本地 HTTP 生成请求通过 Vite 同源代理进入实际后端，DeepSeek fetch 全部 Mock。7 个应用均可通过真实字段控件录入记录、检查统计；电影应用在 B 模式 Inspector 新增“导演”并勾选展示，C 模式编辑记录，切回 B/C 后字段和记录仍在。上游失败、非法结构、空应用、无录入入口、连接失败共 5 类错误，均保留原应用和“保留的电影 / 宫崎骏”记录。删除与成功重试也通过。成功组与失败组使用独立后端实例，未改动生产限流。
- `scripts/ai-create.browser.test.cjs`：5 次浏览器拦截的 Mock 请求验证加载状态、必填校验、CRUD/聚合、错误恢复、替换重置和 390px 宽度无横向溢出；旧 `/app-renderer` 示例切换正常；首页 → 功能澄清 → 原“我的学习助手”Demo 正常，新增任务在 B/C 切换后保留。
- 截图已目视检查：保留奶油底色、橙色品牌、Pixelify 字体、原 Mochi、积木画布及 Inspector；没有改为后台管理布局。最初依赖软链接导致字体被 Vite 拦截，已在本 worktree 的忽略依赖目录内修正并重跑，两套最终结果均无该错误。没有修改包清单或 lockfile。

本机复现浏览器命令（需已有 Playwright/Chromium）：

```sh
NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules npm run test:generation:browser
NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/ai-create.browser.test.cjs
```

本机日志在 `/tmp/blockcraft-g2-audit/`：`generation.log`、`server.log`、`unit.log`、`quality.log`、`build.log`、`browser-generation.log`、`browser-legacy.log`。截图为该目录下 `generated-b.png`、`generated-c.png`、`legacy-b.png`、`legacy-c.png`；移动截图为 `/tmp/blockcraft-ai-create-mock.png`。这些为本机临时证据，未加入 Git。

## UI 冻结及真实 API 额度

10 个指定冻结文件（AiCreate、AppSpecWorkshop、AppSpecCanvas、AppSpecInspector 各自 TSX/CSS，`src/components/Logo.tsx`、`src/assets/mochi.png`）均逐字节等于最新 main。所有其他 `src/` 文件也零修改，AppSpec v1、AppRuntime、appCommands、AppRenderer 保持原样。

**真实 DeepSeek 请求代码已接线；真实 DeepSeek 调用 0 次，付费额度消耗 0。** 没有读取真实密钥或启动使用真实配置的后端；没有执行真实模型质量测试，需另获 Tech Lead 授权后单独验收。

上表记录提交前的基线与工作区状态。Tech Lead 已授权精确提交上述 5 个文件，提交消息为 `feat: integrate general DeepSeek app generation`，并通过可用 GitHub 连接发布 `feature/deepseek-general-integration`、创建目标为 main 的独立 PR。最终 Commit SHA、PR 链接及工作区状态以交付回复为准。其他 worktree 不作修改；本次不合并、不部署、不调用付费 API。PR 创建并核验后停止，等待最终代码审核。
