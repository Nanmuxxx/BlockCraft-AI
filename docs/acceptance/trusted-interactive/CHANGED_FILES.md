# 相对 main 的完整文件清单与影响范围

基线：`7e94dc9568501dd4ad218a43b5aca31026aed2b2`。清单包含核心与可靠性增补提交；证据文件也逐一列出。

## 主集成人重点审核

- `src/model/appSpec.ts` / `appSpecValidation.ts` / `trustedInteractive.schema.json`：AppSpec v1 保持原形状；version 联合新增 2；PomodoroBlockSpec；v2 可选 timers；完整严格校验与单番茄钟生成子集。
- `src/custom-block/project.ts`：CustomProjectV2 仍为唯一 owner 的 formatVersion=2；base 允许可选 timers 并由共享验证器检查，v2 降级旧格式明确 LOSSY_EXPORT。没有第二个 owner 或新 persistence 系统。
- `src/model/appRuntime.ts` / `appCommands.ts` / `appChangePlan.ts`：timerAction 复用 mutate→commitBuiltin→session→CAS；删除/撤销清理和恢复 timer；旧 fieldIds 路径收窄到 form/list。未改变授权和 CAS 冲突规则。
- `src/components/app-renderer/{AppRenderer,Pomodoro}.tsx`：可信 React 路由和计时器；interval 仅重绘，恢复事件重绘，完成派生；不执行模型字符串。
- `src/components/blocks/app-canvas.ts` / `src/model/appCapabilities.ts` / `src/components/app-builder/{AppSpecInspector,AppSpecMochiPanel}.tsx`：既有 B/C 目录、属性、选择投影，明确暂不支持导出。
- `src/integrations/mochi/{host,mockPlanner}.ts` / `src/integrations/mochi-ai/protocol.mjs`：timer 元数据可读，修改计划 TIMER_SCOPE_UNAVAILABLE；不借 timer 提升模型权限。
- `src/integrations/project-export/{ExportProjectButton.tsx,capture.ts}` / `tools/project-zip-export/export.mjs`：v2 整个 ZIP 拒绝 UNSUPPORTED_APP_SPEC，纯导出边界同样保护；v1 维持支持。
- `server/{index,aiGenerationPrompt,trusted-interactive}.mjs` / `src/components/ai-create/generateApp.ts`：既有 Provider opt-in 版本化协议、双端验证、默认禁用访问/预算门禁、显式 provenance；legacy v1 保留。
- 既有测试只更新未知版本和能力断言、旧 harness 对当前画布及 #31 插件的接线，保持安全门禁。新增 tests/trusted-interactive 均是离线 fixture，不提供生产授权。

## 完整清单

- `docs/acceptance/trusted-interactive/CHANGED_FILES.md`
- `docs/acceptance/trusted-interactive/INTEGRATION.md`
- `docs/acceptance/trusted-interactive/REPORT.md`
- `docs/acceptance/trusted-interactive/browser-results.json`
- `docs/acceptance/trusted-interactive/desktop-b.png`
- `docs/acceptance/trusted-interactive/desktop-c-running.png`
- `docs/acceptance/trusted-interactive/final-browser.log.txt`
- `docs/acceptance/trusted-interactive/final-build.log.txt`
- `docs/acceptance/trusted-interactive/final-compat.log.txt`
- `docs/acceptance/trusted-interactive/final-generation.log.txt`
- `docs/acceptance/trusted-interactive/final-mochi-ai.log.txt`
- `docs/acceptance/trusted-interactive/final-mochi.log.txt`
- `docs/acceptance/trusted-interactive/final-server.log.txt`
- `docs/acceptance/trusted-interactive/final-specific.log.txt`
- `docs/acceptance/trusted-interactive/final-unit.log.txt`
- `docs/acceptance/trusted-interactive/final-validation-results.json`
- `docs/acceptance/trusted-interactive/legacy-export-browser.log.txt`
- `docs/acceptance/trusted-interactive/legacy-generation-browser.log.txt`
- `docs/acceptance/trusted-interactive/legacy-mochi-browser.json`
- `docs/acceptance/trusted-interactive/mobile-b.png`
- `docs/acceptance/trusted-interactive/mobile-c-running.png`
- `docs/acceptance/trusted-interactive/reliability-browser-results.json`
- `docs/acceptance/trusted-interactive/reliability-completed-1440.png`
- `docs/acceptance/trusted-interactive/reliability-completed-390.png`
- `docs/acceptance/trusted-interactive/validation-results.json`
- `package.json`
- `server/aiGenerationPrompt.mjs`
- `server/index.mjs`
- `server/trusted-interactive.mjs`
- `src/components/ai-create/generateApp.ts`
- `src/components/app-builder/AppSpecInspector.tsx`
- `src/components/app-builder/AppSpecMochiPanel.tsx`
- `src/components/app-renderer/AppRenderer.tsx`
- `src/components/app-renderer/Pomodoro.tsx`
- `src/components/blocks/app-canvas.ts`
- `src/custom-block/project.ts`
- `src/integrations/mochi-ai/protocol.mjs`
- `src/integrations/mochi/host.ts`
- `src/integrations/mochi/mockPlanner.ts`
- `src/integrations/project-export/ExportProjectButton.tsx`
- `src/integrations/project-export/capture.ts`
- `src/model/appCapabilities.ts`
- `src/model/appChangePlan.test.cjs`
- `src/model/appChangePlan.ts`
- `src/model/appCommands.ts`
- `src/model/appRuntime.ts`
- `src/model/appSpec.test.cjs`
- `src/model/appSpec.ts`
- `src/model/appSpecValidation.ts`
- `src/model/trustedInteractive.schema.json`
- `tests/custom-block/project.test.cjs`
- `tests/generation/browser.cjs`
- `tests/generation/generation.test.mjs`
- `tests/mochi/browser.cjs`
- `tests/trusted-interactive/browser.cjs`
- `tests/trusted-interactive/client.test.cjs`
- `tests/trusted-interactive/export.test.mjs`
- `tests/trusted-interactive/index.html`
- `tests/trusted-interactive/main.tsx`
- `tests/trusted-interactive/pomodoro.json`
- `tests/trusted-interactive/reliability.browser.cjs`
- `tests/trusted-interactive/reliability.html`
- `tests/trusted-interactive/reliability.tsx`
- `tests/trusted-interactive/runtime.test.cjs`
- `tests/trusted-interactive/serve.mjs`
- `tests/trusted-interactive/server.test.mjs`
- `tools/project-zip-export/export.mjs`

## 明确排除

`CustomBlockImport.tsx`、`AppSpecWorkshop.tsx` 与 `AiCreate.tsx` 不在 PR。AiCreate 早先本地 Diff 为 +8/-4，保持不变；本地 `coordination/AiCreate.pending.patch` 保留且不应用、不提交。node_modules 依赖符号链接及生成编译产物不提交。
