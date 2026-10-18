# AI Core Gap Matrix

基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。状态描述当前代码，VERIFIED 必须有本轮命令与结果；历史文档不充当本轮验证。REAL_MODEL_CALLS=0。

| 环节 | 状态 | 具体代码/函数 | 测试与缺口 |
| --- | --- | --- | --- |
| v1 自然语言生成 | IMPLEMENTED | `AiCreate.tsx:submit` → `generateApp.ts:generateProject` → `server/index.mjs:createAppServer/generate` → `buildGenerationMessages` | `tests/generation/compatibility.test.mjs`、`server/server.test.mjs`；本轮待运行。非任意功能，只支持现有 primitive |
| 输出完整性 | IMPLEMENTED | `assertAppSpec`、`checkGeneratedApplication` | `tests/generation/generation.test.mjs`；结构完整不等于自然语言需求满足 |
| v2 可信交互 | PARTIAL | `generateInteractiveProject`、`server/trusted-interactive.mjs:createInteractiveGate/assertInteractiveSpec` | `tests/trusted-interactive/*.test.*`；只允许单个 pomodoro，付费入口默认关闭 |
| 离线正式入口 | IMPLEMENTED | `trustedPomodoroFixture.ts`、`AiCreate.tsx` | `tests/trusted-pomodoro-ui/`；保留明确非 DeepSeek 说明 |
| 生成取消/项目替换 | PARTIAL | `AiCreate.tsx` active 身份与双重 `beforeContextChange`；`generateApp.ts` AbortController | 既有 UI 竞态测试；客户端依赖 fetch 遵守 abort，响应体尚未有界读取，待补 |
| Artifact Installer | IMPLEMENTED | `generated-artifact/install.ts:createGeneratedArtifactInstaller`、`ui.ts:createGeneratedArtifactUI` | `tests/generated-artifact/`、`tests/generated-artifact-ui/`；准确摘要、预览、确认、授权与 revision |
| CustomBlock 生成 | PARTIAL | `server/custom-block/generator.mjs:createGenerator`、`provider.mjs`、`store.mjs` | `tests/custom-block-generation/`；仅 pending-build，无自然语言到正式安装的 UI 通路 |
| CustomBlock B/C 映射 | IMPLEMENTED | `custom-block-bc/adapter.ts`、`CustomBlockInspector.tsx`、`CustomBlockViewer.tsx` | `tests/custom-block-bc/`；同一 owner/props/layout，运行仍需隔离准入 |
| Runtime owner/CAS | IMPLEMENTED | `customProjectSession.ts:createProjectSession`、`owner.ts:createProjectRevisionOwner`、`appRuntime.ts` | `tests/custom-block-workshop/authorization.test.cjs`、`tests/custom-block-bc/authorization.test.cjs` |
| Mochi Host 修改 | PARTIAL | `mochi/host.ts:createMochiHost` → `appChangePlan.ts:createAppChangePlanner` | Host 可确认受控命令；正式 Workshop 使用 `unavailablePlanProvider`；不支持按钮颜色/文字命令 |
| Mochi Conversation | IMPLEMENTED | `mochi-ai/client.mjs:createMochiConversation`、`workshop.mjs`、`server/mochi-ai/service.mjs` | `tests/mochi-ai/`；只读建议、上下文绑定、历史/迟到门禁；修改明确禁用 |
| Mochi 源码修改 | PARTIAL | `mochi-source/planning.ts:createSourceEditPlanner/validateSourcePlan`、`providers.ts` | `tests/mochi-source/planning.test.cjs`；完整 TSX 候选版本、摘要与确认，未接正式 UI、不可运行 |
| 隔离执行 | BLOCKED | `custom-block-bc/viewer.ts:viewerState`、`CustomBlockViewer.tsx` | `tests/custom-block-sandbox/`、`tests/custom-block-compiler/`；缺少实测隔离 provider，禁止绕过 |
| B/C 状态一致性 | IMPLEMENTED | `AppSpecWorkshop.tsx:MochiWorkshop`、`appRuntime.ts`、唯一 `customProject` | 相同 Runtime，模式切换不复制项目；本轮将补服务生成后编辑案例 |
| 参数保存/重新安装 | PARTIAL | `customProjectSession.ts:install`、`custom-block/project.ts` | 现有 session 内保存与替换边界；无跨刷新存储，不增加隐式 localStorage |
| React ZIP | PARTIAL | 现有 `integrations/project-export` 与 `tools/project-zip-export` | Agent B 所有；本分支只提出接口契约，不编辑 |
| 任意自然语言 → TSX → Mochi → C → ZIP | BLOCKED | 上述环节尚未构成完整生产闭环 | 无真实模型调用与隔离运行证据，不给主观完成百分比 |
