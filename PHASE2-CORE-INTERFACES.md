# Phase 2 AI Core 接口契约

基线：main `25773e6d65e4e5a2b29d125baa2510f4a10aa343`；源分支 #40 `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`。本文件描述现有代码边界，不授予执行、模型调用或写入权限。

## 1. DeepSeek 响应与验证

- `server/index.mjs` 的 `generate` / `createAppServer`：`POST /api/ai/generate`，输入 `idea`（1–4000 字），v1 默认，v2 必须显式 `protocol: 'trusted-interactive/1'` 并通过 gate。不得把 fixture 来源标成模型来源。
- `src/components/ai-create/generateApp.ts`：`initializeGeneratedProject` 严格验证 AppSpec 后建立 revision 0 项目；请求与流读取均受取消、45 秒期限和 128 KiB 限制。v2 客户端验证 envelope、provenance、单个 pomodoro 及版本 2。
- 服务端 provider 对严格 UTF-8、单个 choice、`finish_reason: stop`、assistant 文本、输出大小进行检查；拒绝 error/refusal/tool/function 调用。结构校验之外仍须经过现有语义质量检查。
- CustomBlock 独立入口 `server/custom-block/provider.mjs:createDeepSeekProvider` 默认 `allowPaid=false`；`generator.mjs:createGenerator` 默认 disabled。不得把这些默认值推断为 legacy generation 已完成认证。
- **安全依赖**：协调方已发现 legacy v1 可在无认证/Origin 情况进入 provider。`phase2/real-deepseek-secure` 拥有 `server/index.mjs` 准入回调与受控 fetch 补丁；本候选只保留 #40 既有差异，不再修改该文件。接入前须审查组合补丁并重跑 generation/protocol/cancellation 测试。不得启用真实凭据。

## 2. Mochi 修改计划

- `src/integrations/mochi/modelPlanProvider.ts:createModelPlanProvider(complete, {timeoutMs})` 为注入式 transport seam；上限 45 秒，序列化输入/输出各 64 KiB。`complete({instruction, request, signal}) -> Promise<string>`，返回 JSON，不获得 Runtime 权限。
- AppSpec 计划形状：`{request:{requestId,baseRevision,commands}, capabilityIds:[]}`。仅既有 addField/configureBlockFields/addBlock/removeBlock；选中 block 和绑定 entity 范围由 Host/planner 校验。拒绝脚本、TSX、记录或授权修改；必须 preview + confirm。
- `src/integrations/mochi/host.ts:createMochiHost(runtime, provider)` 绑定 selection/context/request、owner 授权 generation 与 revision；迟到结果不得覆盖新会话、历史或确认结果。`COMMIT_OUTCOME_UNKNOWN` 不能被描述为成功或自动回滚。
- `src/integrations/mochi-source/providers.ts:createModelSourcePlanProvider`：序列化上下文/响应各 512 KiB，最长 45 秒；仅返回数据候选。
- `mochi-source/planning.ts` 的 `SourcePlanRequest` 为 `{contractVersion:1,requestId,projectId,baseRevision,intent,target,current}`；`SourcePlanCandidate` 为 `{contractVersion:1,requestId,baseRevision,blockId,baseReference,candidate,props,summary,steps,changedFiles}`。
- `validateSourcePlan` 重算 artifact digest、核对绑定和真实 changedFiles；保持 manifest/dependencies/build 不变，不支持 schema/capability 迁移。`createSourceEditPlanner` 才负责预览、确认与版本历史。源码被接纳不代表已构建或执行。

## 3. Generated Artifact / CustomBlock

- `src/integrations/generated-artifact/install.ts:GeneratedImportFile` = `{instance: CustomBlockInstance, artifact: RegisteredArtifact}`；instance 携带 id、definitionId、versionDigest、props。artifact 类型以 `src/custom-block` 为唯一来源，不能另建 wire 格式。
- `createGeneratedArtifactInstaller(session)`：`prepare(unknown)` 先 detach JSON、验证 digest、project、props、零 requestedCapabilities/events，再返回 session 所有的 ticket；状态 `pending-build` / `build:not-attempted` / `execution:denied`。
- `confirm(ticketId)` 使用捕获的 snapshot 与 authorization，调用 `session.install`；重复成功确认返回 duplicate receipt。已有 instance 不能通过新增通路覆盖，替换须走 source-version-plan。
- `server/custom-block/generator.mjs` 在 store.put 前取消可阻止写入；一旦进入实际 store.put，等待真实结果，不能声称撤销了已提交存储。

## 4. Runtime / project / revision / owner / CAS

唯一写入边界仍是现有 AppRuntime / CustomProjectSession / owner。provider 不可持有可写 session、registry、records 或授权对象。确认时核对 project identity、同一 snapshot、revision、authorization identity/generation、epoch 与 selection；同 revision 不代表同 snapshot。

宿主切换项目必须同步 invalidate/dispose；确认进行中 `CONFIRM_BUSY` 要求宿主延迟切换，不能另启平行 Runtime。撤销授权后重新授予也不能复活旧请求。取消/失败不会产生新的成功历史；提交已发生的 receipt 必须如实保留。

## 5. Viewer / B-C / ZIP

B/C 继续使用现有 session projection，参数持久化与 reinstall/version 边界由现有测试约束。本候选没有新增 B/C renderer 或 Runtime 架构。

Viewer 的 TSX 构建/隔离执行验收仍是独立前提；安装或 source-plan 验证不能授权直接 eval/import。现有 AppSpec 可信渲染与受控番茄钟不能外推为任意 TSX 可执行。

#41 导出保持不变；v1 既有支持范围由 exporter 验证。v2 / trusted-interactive ZIP 必须拒绝，不能静默降级。契约证据：`tests/trusted-interactive/export.test.mjs`、`tests/project-zip-export/export.test.mjs`。

## 6. 所有权与交接

- 本候选：#40 已有 AI Core 差异、对应测试、Phase 2 文档。
- paid-gateway 团队：generationAccess、统一受控 fetch、认证/额度/审计；共享入口改动以小补丁组合审查。
- 部署负责人：#35 Docker 两阶段 COPY 均需包含 `server/ai-abort.mjs`，并核实 #41 project-export 在 runtime 中完整可用；本轮未修改 Docker。
- Viewer 团队：提供独立 build/isolation 验收；ZIP 团队：维持拒绝策略与导出模板所有权。

本聊天 `REAL_MODEL_CALLS=0`。Fixture 测试仅证明协议/状态边界，不证明真实模型质量、浏览器或部署通过。
