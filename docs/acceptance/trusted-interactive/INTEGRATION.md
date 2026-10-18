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

## P1-B 修改窗口与接口

临时独占期间没有改动或提交三个共享文件。AiCreate 早先本地候选 Diff 原样保存；补丁 `coordination/AiCreate.pending.patch` 仅在本地，不在 PR。等 P1-B Draft PR 后由主集成人统一接线：

1. `AiCreate.tsx`：调用 `generateInteractiveProject(idea, AbortSignal)`（`src/components/ai-create/generateApp.ts`）。返回 `{state, source, model}`；显式区分 legacy v1 与可信配置模式。保持取消、竞态和失败保留旧项目的现有语义；仅对完整验证成功结果使用现有 `createAppRuntime(state)` 创建新项目，并调用原 `onCreated`。来源作为生成结果元数据展示，不引入项目 owner。
2. `AppSpecWorkshop.tsx`：继续把同一个 runtime 传入 B/C、Inspector、Mochi 和导出按钮。本分支已在下层 catalog/renderer/Inspector 接好 timer，离线验收直接复用未修改的 Workshop。无需增设 state/timer owner 或第二套画布。
3. `CustomBlockImport.tsx`：可信配置不走源码导入、Artifact Installer、pending-build 或 Viewer。保留 P1-B 原来源校验与拒绝策略，预计无需为了番茄钟修改。

共享模型/运行时的全部影响见 `CHANGED_FILES.md`。重点审核 AppSpec version 联合、ProjectState 与 CustomProjectV2.base 的可选 timers、严格验证器、timerAction 的 owner/CAS 发布、commands 删除/撤销清理、Mochi 投影与修改拒绝、ZIP 全量拒绝和 v1 有损导出拒绝。CustomProject formatVersion 仍是 2；不迁移 v1 项目，不重置旧数据。

## 集成门槛

建议先审核/合入可信内核，待 P1-B 窗口统一 UI Diff 后再跑主线回归。付费演示和生产 NO-GO，直到真实会话、持久预算、批准记录、来源 UI 与真实需求→配置→B/C 验收齐备。不能把预置组件说成 AI 自由写代码。v2 ZIP 当前明确整体拒绝，不会生成少积木的 ZIP。
