# AI Core Gap Matrix

基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。状态描述当前代码，VERIFIED 必须有本轮命令与结果（详见 docs/agent-a-night/logs/commands.jsonl）；历史文档不充当本轮验证。REAL_MODEL_CALLS=0。

| 环节 | 状态 | 具体代码/函数 | 测试与缺口 |
| --- | --- | --- | --- |
| v1 自然语言生成 | VERIFIED | `AiCreate.tsx:submit` → `generateApp.ts:generateProject` → `server/index.mjs:createAppServer/generate` → `buildGenerationMessages` | `tests/generation/compatibility.test.mjs`、`server/server.test.mjs`；本轮服务 HTTP/浏览器通过（commands.jsonl）。非任意功能，只支持现有 primitive |
| 输出完整性 | VERIFIED | `assertAppSpec`、`checkGeneratedApplication` | `tests/generation/generation.test.mjs`；结构完整不等于自然语言需求满足 |
| v2 可信交互 | PARTIAL | `generateInteractiveProject`、`server/trusted-interactive.mjs:createInteractiveGate/assertInteractiveSpec` | `tests/trusted-interactive/*.test.*`；只允许单个 pomodoro，付费入口默认关闭 |
| 离线正式入口 | IMPLEMENTED | `trustedPomodoroFixture.ts`、`AiCreate.tsx` | `tests/trusted-pomodoro-ui/`；保留明确非 DeepSeek 说明 |
| 生成取消/项目替换 | VERIFIED | `AiCreate.tsx` active 身份与双重 `beforeContextChange`；`generateApp.ts` AbortController | 既有 UI 竞态测试；已补有界读取、忽略 abort 传输/响应体、迟到响应取消；56 项相关检查通过 |
| Artifact Installer | VERIFIED | `generated-artifact/install.ts:createGeneratedArtifactInstaller`、`ui.ts:createGeneratedArtifactUI` | `tests/generated-artifact/`、`tests/generated-artifact-ui/`；准确摘要、预览、确认、授权与 revision |
| CustomBlock 生成 | PARTIAL | `server/custom-block/generator.mjs:createGenerator`、`provider.mjs`、`store.mjs` | `tests/custom-block-generation/`；仅 pending-build，无自然语言到正式安装的 UI 通路 |
| CustomBlock B/C 映射 | IMPLEMENTED | `custom-block-bc/adapter.ts`、`CustomBlockInspector.tsx`、`CustomBlockViewer.tsx` | `tests/custom-block-bc/`；同一 owner/props/layout，运行仍需隔离准入 |
| Runtime owner/CAS | VERIFIED | `customProjectSession.ts:createProjectSession`、`owner.ts:createProjectRevisionOwner`、`appRuntime.ts` | `tests/custom-block-workshop/authorization.test.cjs`、`tests/custom-block-bc/authorization.test.cjs` |
| Mochi Host 修改 | PARTIAL | `mochi/host.ts:createMochiHost` → `appChangePlan.ts:createAppChangePlanner` | Host 可确认受控命令；正式 Workshop 使用 `unavailablePlanProvider`；不支持按钮颜色/文字命令 |
| Mochi Conversation | IMPLEMENTED | `mochi-ai/client.mjs:createMochiConversation`、`workshop.mjs`、`server/mochi-ai/service.mjs` | `tests/mochi-ai/`；只读建议、上下文绑定、历史/迟到门禁；修改明确禁用 |
| Mochi 源码修改 | PARTIAL | `mochi-source/planning.ts:createSourceEditPlanner/validateSourcePlan`、`providers.ts` | `tests/mochi-source/planning.test.cjs`；完整 TSX 候选版本、摘要与确认，未接正式 UI、不可运行 |
| 隔离执行 | BLOCKED | `custom-block-bc/viewer.ts:viewerState`、`CustomBlockViewer.tsx` | `tests/custom-block-sandbox/`、`tests/custom-block-compiler/`；缺少实测隔离 provider，禁止绕过 |
| B/C 状态一致性 | VERIFIED | `AppSpecWorkshop.tsx:MochiWorkshop`、`appRuntime.ts`、唯一 `customProject` | 相同 Runtime，模式切换不复制项目；本轮 service-runtime 及模型计划浏览器通过，字段编辑后 B/C 一致 |
| 参数保存/重新安装 | PARTIAL | `customProjectSession.ts:install`、`custom-block/project.ts` | 现有 session 内保存与替换边界；无跨刷新存储，不增加隐式 localStorage |
| React ZIP | PARTIAL | 现有 `integrations/project-export` 与 `tools/project-zip-export` | Agent B 所有；本分支只提出接口契约，不编辑 |
| 任意自然语言 → TSX → Mochi → C → ZIP | BLOCKED | 上述环节尚未构成完整生产闭环 | 无真实模型调用与隔离运行证据，不给主观完成百分比 |

## 本轮新增证据与边界

- `generateApp.ts:requestGeneration/readGenerationResponse`、`server/index.mjs:generate/readUpstream`、`server/ai-abort.mjs:abortable`：字节/UTF-8/取消/超时/严格包络与未用响应体释放。`response-cleanup` 56/56。
- `mochi/modelPlanProvider.ts:createModelPlanProvider`：只输出选中块元数据、无 records/authorization，64 KiB 入站/出站 JSON；保留原 Host→Planner→确认→CAS。`model-plan-cancellation-fixed` 13/13（含本地 HTTP 垂直案例）。正式生产 Provider 尚未接通，状态 PARTIAL。
- `mochi-source/planning.ts:createSourceEditPlanner`：取消立即退休、先 detach 再 abort；同步重入 epoch 复现先失败再修复。`source-reentrant-fixed` 37/37。仅惰性源码版本与历史，不表示可执行 TSX。
- `server/custom-block/provider.mjs`：限时读、迟到/提前拒绝响应体回收、混合工具/error 包络拒绝。`custom-provider-cleanup` 26/26。
- `tests/ai-quality/evaluate.cjs:assertQualitySpec`：质量评估显式 v1；共享 schema 合法 v2 仍需单独质量契约。`quality-v1` 61/61。
- `security-prerequisites-fixed` 187/187：可信编译器先经 `npm ci --ignore-scripts` 及固定包 SRI/字节比对，再编译两个审核样本；未知源码与 Viewer 仍拒绝运行。
- 浏览器 JSON 报告在 `docs/agent-a-night/browser/`；artifact-races 旧脚本内 baseline 是历史常量，实际本轮源码/命令以 Git 提交与日志为准，不把历史常量冒充当前 SHA。
- MISSING：正式自然语言修改计划 HTTP 路由与授权/费用闭环；跨刷新项目存储；经过真实隔离验收的 Viewer。
- BLOCKED：真实模型验收（本任务无付费许可）；任意 TSX 安全运行；跨 Agent 的 ZIP/部署集成。

- `core-complete` 568/568；`custom-workshop-browser` 桌面1366/手机390通过，含参数/重新安装/B-C/不可执行 Viewer。`model-request-bound-fixed` 14/14。未来生产接入见 `docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md`。
