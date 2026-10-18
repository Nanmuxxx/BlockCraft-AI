# P1-B 合流契约：可信番茄钟 / 1

状态：离线内核 GO；共享 UI 接入与付费配置生成未验收。仅一个番茄钟，不包含答题器。

## 最小生成接口

复用 `POST /api/ai/generate`、现有服务器 DeepSeek Provider。无 protocol 的 `{ "idea": "…" }` 继续使用 v1 提示词、质量校验和原响应形状。新请求必须且只能包含：

```json
{"idea":"做一个 25 分钟数学专注番茄钟","protocol":"trusted-interactive/1"}
```

idea 为去首尾空白后 1–4000 字。未知 protocol、额外权限和额外字段在请求入口 400 拒绝。请求不能携带批准、模型密钥、脚本、状态或预算授权。

成功响应形状：

```json
{
  "protocol":"trusted-interactive/1",
  "spec":{
    "version":2,"id":"focus-app","name":"考试专注番茄钟",
    "entities":[],"relations":[],
    "blocks":[{"id":"focus-timer","name":"数学专注","type":"pomodoro","protocolVersion":1,"durationSeconds":1500}]
  },
  "provenance":{"source":"offline-fixture","model":"offline-fixture-model"}
}
```

正式 Provider 默认 fetch 才标记 `deepseek`；注入的测试 fetch 标记 `offline-fixture`。本分支所有新验收均为后者，0 次真实付费请求。source 表示服务器调用路径，不是客户端可授予的权限。UI 应明确展示来源。

模型仅生成 `spec`。`trustedInteractive.schema.json` 限定 v2、一个番茄钟、空 entities/relations、protocolVersion=1、1–120 字标题、整数 1–7200 秒，以及每层 additionalProperties=false。服务器共享完整验证器和生成子集验证器复验，客户端再复验完整 spec 与响应 envelope。ID 唯一及引用合法性仍由共享验证器负责。没有 JS/TSX、HTML、事件处理脚本或表达式协议。

错误响应遵循原 `{error:{code,message}}` 形状；不返回 spec，不用预置配置伪装成功。400 拒绝请求协议；401 会话缺失/只读；403 Origin 不符；429 预算/频率/并发拒绝；503 禁用、缺少配置或预算不可用；502 上游不可用、截断/非 JSON/非法配置；504 超时。客户端的取消/失败不替换原 Runtime，也不清空现有项目。

## 服务端接线条件

`createAppServer({interactive:{enabled, approval, allowedOrigin, resolveAccess, reserveBudget}, ...现有 Provider 参数})` 是可信服务端依赖注入边界。默认禁用；没有客户端开关、公开无认证新路由或 env 授权捷径。

- approval 必须由部署方核验后注入：providerVerified、permissionsVerified、reference、maxCalls、expiresAt。不能来自用户 body/header。
- resolveAccess(req) 必须基于真实部署的会话/项目权限返回 sessionId、appId、readOnly:false。测试的固定身份不能用于生产。
- reserveBudget 必须连接持久预算账本，在 upstream 前原子预留 requestId、sessionId、appId、approvalReference、model 与 maxTokens 上界；拒绝/故障/超时均 fail closed。本分支未提供生产适配器。
- 继续使用原 Provider 的 endpoint/model/key、大小限制、限速、并发、超时和取消。付费调用必须另获 Tech Lead 批准；本轮不启用。

## #37 后的正式入口交接（仅方案，未应用）

最新已验收主线基线：`eb8b35c041fd158c9050899ed9d2804c9aaea174`（#37）。三处共享 UI 文件与此 main 完全相同。旧 `coordination/AiCreate.pending.patch` 仅本地保留，SHA256 `e73919544257f048cbf644d23a1437e89e96de007702aff3f811a8dbe45af3ff`；旧候选还保留在命名 stash，不能直接应用到 #37。

最小入口 Diff 仅建议后续修改 `AiCreate.tsx`，本 PR 不实现：

```diff
-import { generateProject } from './generateApp'
+import { generateProject, generateInteractiveProject } from './generateApp'
+// selector: legacy-v1 | trusted-v2-fixture | trusted-v2-approved
+// default legacy-v1; approved mode unavailable until deployment authorization exists
 ... generate(event) {
   if (active.current) return
   try { currentApp.current?.installation.beforeContextChange() }
   catch (...) { ...; return }
+  const requestedMode = mode // capture once; disable selector while pending
   ... // existing AbortController / active identity checks
-  const state = await generateProject(idea, controller.signal)
+  const result = await selectedGenerator(requestedMode, idea, controller.signal)
+  // legacy: existing generateProject; fixture: local offline response + full validators
+  // approved: generateInteractiveProject only after explicit user submit AND deployment permit
+  // no fallback from fixture to network; never invoke generator on selector change/mount
+  const { state, provenance } = result
   if (active.current === controller) {
     currentApp.current?.installation.beforeContextChange()
     const runtime = createAppRuntime(state)
     currentApp.current?.installation.dispose()
     ... // existing createGeneratedArtifactUI(runtime.customProject), currentApp and setApp
+    ... // publish provenance atomically with this successful app, never a new owner
   }
 }
```

`selectedGenerator` 是建议的本地 adapter，不是现有导出。legacy adapter 保留 `{idea}` 请求和 v1 返回校验；trusted fixture adapter 使用固定响应，通过同样的 envelope/spec 验证，不发 HTTP；approved adapter 使用现有 `generateInteractiveProject(idea, signal)` 返回 `{state, source, model}`。禁止失败后切换协议或以 fixture 冒充上游成功。未有生产授权适配器前仅开放 fixture；不能用可伪造客户端开关代替服务端批准/权限/预算门禁。

来源展示：成功结果显示“离线固定 Fixture · 非真实模型调用”或“DeepSeek · 模型名”，fixture 来源独立于历史真实制品。legacy v1 现有响应不提供 provenance，显示“旧版 v1 · 来源未证明”，不能推断为真实模型。来源只能由验证后的服务端 envelope/本地固定 adapter 得到，不能由模型 spec 自报。可信 v2 显示“配置驱动可信内置 React”；#37 的源码制品保留 pending-build、不可运行、原来源标记和 unavailable Viewer。两者不混用 Installer。

#37 门禁必须保持两个同步检查点：提交请求前，以及 await 成功后、创建 Runtime 之前。`beforeContextChange()` 在 confirming 时抛错；非 confirming 时使旧预览票据失效。不得只在请求开始检查，否则在途生成与安装确认竞态可替换原项目。保留 active/controller 身份检查与取消语义；验证/网络/门禁失败沿用 catch，仅显示错误，保留原 Runtime、业务记录、timers、owner 和 installation；不能提前 dispose 或清空 app。

`AppSpecWorkshop.tsx` 无需为番茄钟另设 owner/state：原 runtime 同传 B/C、Inspector、Mochi 和导出；保持 #37 `changeMode` 的 `installation.beforeContextChange()`。`CustomBlockImport.tsx` 无需修改：可信配置不经过源码导入/Artifact Installer，#37 安装制品仍由现有唯一 owner/CAS 提交。正式入口实施后仍需重新验证选择模式、来源、取消、在途完成门禁及失败保留旧项目；本轮只证明现有 #37 门禁兼容，不宣称新入口已完成。

共享模型/运行时的全部影响见 `CHANGED_FILES.md`。重点审核 AppSpec version 联合、ProjectState 与 CustomProjectV2.base 的可选 timers、严格验证器、timerAction 的 owner/CAS 发布、commands 删除/撤销清理、Mochi 投影与修改拒绝、ZIP 全量拒绝和 v1 有损导出拒绝。CustomProject formatVersion 仍是 2；不迁移 v1 项目，不重置旧数据。

## 集成门槛

建议先审核可信内核；正式入口采用以上 #37 方案，获授权实施后再跑 UI 回归。付费演示和生产 NO-GO，直到真实会话、持久预算、批准记录、来源 UI 与真实需求→配置→B/C 验收齐备。不能把预置组件说成 AI 自由写代码。v2 ZIP 当前明确整体拒绝，不会生成少积木的 ZIP。
