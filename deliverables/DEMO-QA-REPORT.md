# 演示 QA 检查报告（带证据）

- 角色：Demo QA & Documentation Agent
- 日期：2026-10-19
- **被测对象：origin/main @ `4a95cae50f772cd242d932cdbd93366381d1df74`**（本机全新 clone 于 `c:\Users\36317\blockcraft-phase2-workshop\BlockCraft-AI-main`；远端 SHA 经 GitHub API 与 `git rev-parse HEAD` 双重核实）
- 执行方式：**真实浏览器实测**（Playwright Chromium 1.64.1，无头）——本地真实 Vite（vite 8.3.4）+ 真实本地后端进程（`server/index.mjs`）；仅 DeepSeek 上游调用被注入为离线 Fixture（零付费调用，无真实密钥）；`generationAccess: () => true` 使用 server 自身文档化的离线测试注入点（`server/index.mjs`: "Dependency injection is for offline tests"）
- 视口：桌面 1366×1000 + 手机 390×844
- Harness：`tests/demo/qa-demo.browser.cjs`（未改动任何既有源码）
- **结果：15/15 PASS（另有 1 项 FINDING F1 不计分），进程 EXIT=0**
- 历史：此前对 a1fa755 本地基线树的 15/15 结果作为对照保留在 git 历史与本报告 §5

## 0. BLOCKED / UNVERIFIED（已全部解除）

| 项 | 此前状态 | 现状 |
| --- | --- | --- |
| GitHub 可达性 | BLOCKED（两次 30s 超时） | **已恢复**（HTTP 200；GitHub API 与网页均可达；git 经 npmmirror 下载 MinGit 2.56.0.2 后可用） |
| 远端 main SHA | UNVERIFIED（Tech Lead 口述 d644835） | **已核实 = 4a95cae**（main 已前进：PR #58 已合并；Tech Lead 口述值已过时，不影响本轮——本轮以实测为准） |
| 开放 PR 清单 | BLOCKED | **已核实**：15 个开放 PR；PR #49 不在其中（已合并/关闭）；无与本轮重复的演示 QA/README/文档类 PR（PR #59/#62 为其他 QA 同行的真实循环验收证据，范围互补不重叠） |
| Issue #57 | BLOCKED | **已读取**：Supervisor 协调中心（30 条评论），含 [REPORT] 格式规范与各角色汇报；本轮按其格式汇报 |
| tests/demo 冲突 | 未知 | **无冲突**：main @ 4a95cae 的 `tests/` 下无 demo 目录、根目录无 README、无 deliverables/、无 audit-evidence/demo-qa |

## 1. 检查结果明细（15 项，全部 PASS）

| # | 检查 | 结果（实测值） | 状态 |
| --- | --- | --- | --- |
| Q1 | 页面加载：`/ai-create` 落地页 | hero 标题、输入框、生成按钮可见；导航链接=2；横向溢出=0px | PASS |
| Q2 | 中英文案·AI 能力诚实性 | 提示全文="点击将请求 DeepSeek。成功创建后会替换当前应用；失败或取消保留原应用和数据。数据仅保留在当前页面，刷新后清空。"——写明请求 DeepSeek、失败/取消保留数据、不持久，未夸大能力（事实级断言，抗文案迭代） | PASS |
| Q3 | Mochi 吉祥物显示（落地页） | 数量=1，可见且加载成功（naturalWidth>0），alt="Mochi：奶白橘斑的像素猫，拖着橘色积木尾巴" | PASS |
| Q4 | 控制台健康（落地页） | pageErrors=0，consoleErrors=0，资源 4xx=0 | PASS |
| Q5 | **离线演示主线（可信番茄钟 Fixture，main 新增）** | 选择"创建方式=可信番茄钟（离线演示）"→ 加载 → 应用「考试专注番茄钟」出现；来源标注="离线固定 Fixture，非真实 DeepSeek 调用"（aria-label=当前应用来源）——诚实标注非真实 AI | PASS |
| Q6 | Workshop B 模式 + Mochi 面板 + AI 入口诚实禁用 | 积木卡片=1（pomodoro）；面板吉祥物=2 全部加载；**禁用原因可见=true**（"AI 修改能力尚未启用：DeepSeek 修改计划 API 尚未接入。可继续手动编辑积木与运行应用。"）——没有假装 AI 可用 | PASS |
| Q7 | C 模式运行与增删（番茄钟计时 + 示例 CRUD） | 番茄钟运行区可见，计时="25:00"（已暂停/待开始）；`/app-renderer` 社团示例：表单 3 字段保存成功、列表行 2→3→2（单步删除立即生效）、统计为数字 | PASS |
| Q8 | 演示流程可重复运行 | 从落地页第 2 次全流程加载番茄钟成功；刷新重置内存态属诚实的不持久行为 | PASS |
| Q9 | 失败/取消反馈与旧应用保留 | 本检出路径=立即失败（见 F1）；alert="生成失败（HTTP 502），请稍后重试。 当前应用和数据已保留。"；旧应用（番茄钟）仍在——失败反馈诚实、数据保留 | PASS |
| Q10 | 桌面溢出审计（三路由） | `/ai-create`=0px，`/`=0px，`/app-renderer`=0px（scrollWidth−clientWidth） | PASS |
| Q11 | `/` 学习 Demo 全流程 + Mochi 面板 | 首页→澄清→Workshop 全通；吉祥物加载；面板标注 **Mock**；越界请求护栏可见（"当前 Mock 只能介绍选中的任务、课程或统计积木…"）；选中积木后快捷提示发送，消息写入记录——Mock 边界诚实、无假回复 | PASS |
| Q12 | `/app-renderer` 示例切换 | 标题"社团迎新报名"→"阅读记录"，切换正常 | PASS |
| Q13 | 手机视口（390×844） | 落地溢出=0px；吉祥物可见；离线加载后溢出=0px；C 模式番茄钟计时可见 | PASS |
| Q14 | 手机视口溢出（其余路由） | `/`=0px，`/app-renderer`=0px | PASS |
| Q15 | 全程控制台健康（桌面+手机） | pageErrors=0，consoleErrors=0，资源 4xx=0 | PASS |

## 2. 发现（FINDING F1，不计分）与问题清单

### FINDING F1（环境敏感，交 server owner）

**v1 生成在 CRLF 检出下 fail-closed（全部 502）**
- 现象：Windows 检出（git `core.autocrlf=true`，MinGit/Git for Windows 默认）下，`/ai-create` 默认的 legacy-v1 生成**每次返回 502 AI_INVALID_RESPONSE**（UI alert "生成失败（HTTP 502）"）。
- 根因（已定位，非猜测）：`server/aiGenerationPrompt.mjs` `readV1GenerationProtocol()` 对 `src/model/appSpec.ts` 做**逐字节子串自检**，期望串以 `\n` 结尾；blob 本身是 LF（`git cat-file` 已验证），但 autocrlf 检出后文件变 CRLF → `includes()` 失败 → 抛 "Review v1 protocol projection" → generate() catch-all 502。LF 检出（CI/Linux）不受影响。
- 影响：Windows 评委本机 clone 后演示 v1 生成主线必失败；离线主线（可信番茄钟）不受影响。
- 修复建议（归 server owner，本轮不改产品代码）：`readGenerationProtocol()` 读取后做 `replace(/\r\n/g, '\n')` 归一化，或在 `.gitattributes` 增加 `*.ts text eol=lf`（与现有 `tests/custom-block-compiler/fixtures/* text eol=lf` 惯例一致）。
- 复现：CRLF 检出 + `node -e "import('<repo>/server/aiGenerationPrompt.mjs').then(m => m.buildGenerationMessages('测试'))"` → Error: Review v1 protocol projection。

### P0/P1/P2（文档与协作，已更新至 4a95cae 事实）

1. **P0 仓库根无 README.md**：4a95cae 根目录有 7 个阶段报告类 `*.md`，但无 README（GitHub API contents 实测 404）。→ 本 PR 直接提供根 `README.md`（基于 `deliverables/proposed-README.md` 更新至 4a95cae 事实）。
2. **P1 生成入口语义变化未文档化**：4a95cae 起 `/api/ai/generate` 增加 `authorizeGeneration` **401 UNAUTHORIZED 授权门**（v1/v2 均先鉴权，未授权时 UI alert "生成接口需要服务端授权"语义由 401 反映；503 AI_NOT_CONFIGURED 仅在鉴权通过后无 key 时出现）。旧文档/旧 README 若描述"未配密钥=503"已过时；演示前需知道生成接口由部署注入授权（paid-gateway）。
3. **P1 ZIP 导出已实现但旧文案残留口径**：main 已有 `ExportProjectButton`（`src/integrations/project-export/`）、"导出 React 项目"按钮（浏览器实测可见）与 `docs/project-zip-export.md`；旧"导出 ZIP 尚未接入"表述作废。新 README/脚本已改为"可导出"。
4. **P2 server/README 过时点（转 server 负责人）**：除已知的"不修改前端/未修改 Vite 配置"两句外，新增：错误码表未含 401 UNAUTHORIZED（paid-gateway 授权门）与 v1 投影自检（F1）的行为说明。接口协议/安全约束主体仍准确，不代改他人文件。
5. **P2 根 package.json 仍无 engines**：Node >= 22.16 只在 `server/package.json`；根级未声明（README 已代为声明）。

## 3. 证据与复现

- Harness：`tests/demo/qa-demo.browser.cjs`（对 4a95cae；Q5-Q9/Q13 已按最新 UI 迁移并注释缘由）
- 复现（PowerShell，离线、零付费）：
  ```powershell
  npm ci && npm install --no-save playwright@1.64.1   # main 未声明 playwright 依赖
  npm --prefix server run build                        # 生成 server/.generated
  $env:AUDIT_APP_DIR='<仓库根>'; $env:AUDIT_PORT=5199
  node tests/demo/qa-demo.browser.cjs
  # 期望输出：DONE demo-qa: 16 checks (incl. 1 FINDING), PASS=15, FAIL=0 -> none
  ```
- 运行日志：`audit-evidence/demo-qa/run-log.txt`（本轮实际输出，EXIT=0）
- 截图（8 张）：`audit-evidence/demo-qa/screenshots/`（landing-desktop、generated-desktop、c-mode-pomodoro-desktop、c-mode-crud-desktop、regenerated-desktop、workshop-legacy-desktop、app-renderer-demo、generated-mobile）
- 关联历史证据：a1fa755 基线 15/15（QA 报告 git 历史版本）、presentation-consumer 13/13、host.test 24/24

## 4. 未执行项（不标记 PASS）

- 真实 DeepSeek 上游链路（付费调用）——未执行，也不会执行。
- 真实移动设备/触摸交互（仅 390×844 视口模拟）。
- trusted-interactive/番茄钟真实授权门下的付费路径（generationAccess 为离线注入 `() => true`）。
- LF（CI）环境下的 v1 生成成功路径（本机为 CRLF 检出，F1 已如实记录两种环境的行为）。

## 5. 基线沿革

| 基线 | 结果 | 备注 |
| --- | --- | --- |
| a1fa755（本地 workshop 树） | 15/15 PASS | 轮次 1-4；Q11 双断言重写、Q15 抑制误报等历史见 git 历史 |
| **4a95cae（origin/main，本报告主体）** | **15/15 PASS + F1 FINDING** | 番茄钟离线主线、401 授权门、单步删除、ZIP 导出均已按实测更新断言 |