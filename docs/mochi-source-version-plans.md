# Mochi 源码修改计划与版本提交协议

状态：独立模块、受控 Mock 与真实版本提交协议完成；正式 UI、付费模型和安全 Viewer 未接线。本次没有新增 DeepSeek 请求，没有编译或执行候选源码。

## 基线与范围

2026-10-18 从已连接 GitHub API 核实的 main `2c7c698780d190aedf1cccc0ddcd7006c0f7f8be`（#30）新建独立 worktree 和分支 `codex/mochi-source-version-plans-20261018`。提交前再次核实 main，已快进到 `85d4d5de016a2f424cbd49efb6312377dcdc4deb`（#29）并在该基线上重新验证。使用共享 Git 对象库中的同一精确提交；Git CLI fetch 缺少 HTTPS 凭据，未读取或复制凭据。仓库现有类型实际名为 `CustomProject`，`formatVersion: 2`，并无新增 `CustomProjectV2` 别名。

已审阅 `src/custom-block/{types,artifacts,project}.ts`、`src/integrations/mochi/host.ts`、`src/model/appChangePlan.ts`、`docs/mochi-phase-a-host.md`、`src/model/customProjectSession.ts` 及 #24 的三参数同步 CAS/授权代际实现与已合并 PR 说明。

新增代码仅位于 `src/integrations/mochi-source/`，新增独立测试位于 `tests/mochi-source/`。不修改 Workshop、MochiConversationPanel、既有 Host、唯一 owner/session、C Viewer、服务端、package/lockfile 或 Demo。没有第二个项目 owner、revision 或持久化 store。模块只保存计划生命周期与版本追溯信息。

## 输入与最小可信上下文

```ts
type SourceEditInput = {
  blockId: string
  definitionId: string
  versionDigest: `sha256:${string}`
  intent: string // 非空，最多 4000 字符
}
```

`request(input: unknown)` 校验普通 JSON、精确键、ID、digest、当前选择与精确原版本。输入不是授权凭证；projectId、revision、requestId、快照对象身份、epoch 和 WriteAuthorization 均由可信适配层捕获，不能由聊天投影或模型指定。

Provider 收到以下冻结数据及单独的 AbortSignal：

```ts
type SourcePlanRequest = {
  contractVersion: 1
  requestId: string
  projectId: string
  baseRevision: number
  intent: string
  target: CustomBlockInstance // 仅选中实例的 id、精确引用、props
  current: RegisteredArtifact // 精确原版本完整 manifest/source/build
}
```

不发送业务记录、完整项目、其他实例/位置/renderOrder、已保存的 state 值、Runtime、写入接口或授权对象。完整当前源文件是修改现有代码所需的可信宿主选取范围，但其中内容仍为不可信任务数据，不能扩权。未来联网适配仍需独立授权；当前无自动请求、重试或付费后备路径。

## Provider 候选协议与校验

```ts
type SourcePlanCandidate = {
  contractVersion: 1
  requestId: string
  baseRevision: number
  blockId: string
  baseReference: { definitionId: string; versionDigest: VersionDigest }
  candidate: RegisteredArtifact // { versionDigest, artifact: SourceArtifact }
  props: JsonObject            // 目标实例的新完整 props
  summary: string              // 非空，最多 1200 字符
  steps: string[]              // 1–12 项，每项非空、最多 400 字符
  changedFiles: string[]       // 实际新增/删除/修改源路径，排序、无重复
}
```

Provider 返回 `unknown`，不是可执行命令或授权句柄。适配层在 await 前使用正式 `assertJson` 检查并复制候选；严格拒绝未知字段，包括 executionPermit、自动 runnable 声明等。使用正式 `resolveArtifact` 校验 Manifest、SourceArtifact、依赖/build 策略与关联，并按现有规范 JSON/域前缀重新计算 SHA-256，不能相信模型声明的摘要或 registry 的 latest。

候选必须绑定原 requestId、baseRevision、blockId、原 definitionId/versionDigest；新 definitionId 保持不变，digest 必须改变。必须有至少一个新版本中非空且确实变化的 `.tsx` 文件。普通聊天、仅改 props、只改 JSON/CSS、相同版本、虚假 changedFiles、错误摘要均拒绝。

v1 有意只接受源码与目标 props 修改：manifest、schemas、events、capabilities、dependencies 与 build 均须与原版规范 JSON 相同。增加网络/记录权限、变更状态或参数 Schema、更换定义均需另行设计迁移协议，不能借源码计划偷偷扩大授权。新 props 必须符合原 Schema；候选整份项目复用正式 `parseCustomProject` 校验。原项目和 registry 此时零写入。

summary/steps 是不可信展示文字，UI 以纯文本显示；可机械验证的是绑定、摘要及实际文件差异，不能据此保证文字对功能行为的描述属实。SourceArtifact 准入也不证明 TSX 语义、完整类型、行为或安全；语法/构建/安全检查仍由后续受控构建与 Viewer 验收负责。此模块不会给源码发执行许可。

`createMockSourcePlanProvider(fixture)` 必须显式注入受控输出，展示 `providerKind: 'mock'`；不理解自然语言，也没有“45 分钟”模板。测试候选为人工撰写、执行即抛错的 TSX 字符串，不是模型生成证据。

`createModelSourcePlanProvider(complete)` 仅提供未来模型传输接口：将任务、现有源码和固定协议说明交给外部授权的 completion，解析受限 JSON，随后仍走完整候选验证。没有内置 HTTP URL、API key、自动网络调用、代码替换模板或失败降级。正式 TSX 内容必须来自模型响应；该模块不自行合成替代功能代码。模型传输需返回准确摘要（可由其可信协议工具计算），错误摘要严格拒绝；本轮未验证真实模型的协议服从能力。

## 预览、取消、确认与唯一提交入口

1. `setSelection(blockId)` 来自真实宿主选择，先同步调用再更新 UI。每次新请求、选择变化（包括 A→B→A）、模式/context invalidate、项目/授权通知、dispose，都会推进 epoch、取消 pending 计划并 abort 在途请求。忽略 AbortSignal 的迟到响应也不能复活。
2. `request()` 返回递归冻结 `SourcePlanPreview`，含 `planId`、request、proposal、`status: 'pending-build'` 和 `stateEffect`。内部 map 持有原始快照/授权与生命周期，外部同形 JSON 或其他 planner 的 ID 不可确认。不要将整份 preview 当成 owner 权限。
3. `cancel(planId)` 只将 pending 计划取消，重复取消幂等，不调用 install、不改项目、不登记候选制品。取消后不能再确认；在途请求可由 `invalidate()` 取消。
4. `confirm(planId)` 重验真实当前选择、epoch、快照对象身份、revision、原精确版本、当前只读状态和授权对象身份。只接受本 planner 的 pending 计划；成功重复确认返回 duplicate 回执、不再次提交。确认中重复/重入请求返回 `CONFIRM_BUSY`。
5. 确认唯一写入口为现有 `session.install({baseRevision, instance, artifact, expectedReference}, capturedAuthorization)`。它重新准入制品、校验完整项目，最后进入现有 `session.compareAndSwap` → #24 owner 同步 CAS。没有直接写 snapshot、绕过授权、自动改 baseRevision 或冲突重试。
6. install 等待期间的业务记录/布局/参数修改或并发换版由最终 owner CAS 拒绝；撤权后重授权也不能恢复旧凭据。失败不部分写入，不登记失败候选，不写成功历史。

### 选择确认租约与宿主必须遵守的接线条件

现有 install 的异步准入入口没有“最终当前选择”回调，且本任务禁止修改唯一 owner。因此 `confirm()` 在调用 install 前锁定选择，直到其 Promise 结算；`setSelection`、`invalidate`、`cancel`、`dispose` 在这个短窗口同步拒绝 `CONFIRM_BUSY`。锁定的是 UI 选择/模式变更，不是 owner 的其他业务写入。

UI 必须将适配层作为真实选择/模式变更的同步前置门：只有方法成功才更新真实 UI，确认中应禁用选择/模式切换、取消和销毁入口，或等待确认结算再切换。不能先改 UI 再由 effect 调用适配层，也不能吞掉 CONFIRM_BUSY 后继续切换。若宿主需要“确认等待中随时切选择并取消提交”，必须由 owner 增加等价的最终原子条件或准备/提交接口；当前 install 契约无法安全承诺这一点。本轮没有通过修改 owner 或临时撤销全项目授权掩盖这个限制。

## 数据保留与追溯

- 仅替换选中实例的精确版本与完整 props；目标 id、位置和 renderOrder 不变。其他实例即使共享同一定义/旧 digest，也继续使用旧版。内置积木、关系、业务记录及其他状态不变。
- 沿用现有 install 规则：版本变化会清除选中实例的当前 state 槽，绝不把旧 state 自动转移到新源码。预览明确返回 `archive-and-reset-selected-state`，正式 UI 必须展示给用户。
- 旧 RegisteredArtifact 继续保留在现有精确 registry 中。成功记录 `SourceVersionRecord` 保存 before、beforeState、after、previousArtifact、candidate、提交回执与 pending-build 状态；`getHistory()` 返回冻结记录，不提供隐式撤销/重新执行。
- 历史记录在当前 planner 生命周期中可追溯，getHistory 不是新项目 owner。现有 registry 与审计记录仍为会话内数据；跨刷新持久化/恢复、历史审计存储及安全回滚需要主集成后续接入现有持久化生命周期，本轮不新增旁路存储，也不声称已实现永久历史。

## 正式 UI 的最小接线接口

```ts
import { createSourceEditPlanner, createMockSourcePlanProvider } from '../mochi-source'

// 使用现有 runtime.customProject；绝不能创建第二个 Runtime/owner。
const edits = createSourceEditPlanner(runtime.customProject, injectedProvider)

// 在真实选择事件同步执行。CONFIRM_BUSY 时保留当前 UI 选择。
edits.setSelection(selectedCustomBlockId)

const preview = await edits.request({ blockId, definitionId, versionDigest, intent })
// 纯文本展示 Mock 标签、summary/steps、实际 changedFiles/源码前后、props、
// stateEffect 和 pending-build。保留 planId，等待明确确认。
const result = await edits.confirm(preview.planId)
// 仅 result.ok 才显示成功；false 显示 result.error，不覆盖当前项目。
// 用户拒绝：edits.cancel(preview.planId)
// 模式/应用上下文变化前：edits.invalidate()；应用销毁前：edits.dispose()
// 成功后需要追溯：edits.getHistory()；正式 Viewer 仍须独立安全验收。
```

正式 UI 生命周期需保证一个现有 session 对应受控 planner，捕获异步错误，避免 StrictMode 复用已 dispose 的实例。旧内置积木 Phase A Host 继续原样工作；本模块没有绕过 Host 对 custom 的既有拒绝，生产入口仍需负责人显式路由到新适配层。

稳定拒绝类型包括 `PLAN_BINDING_MISMATCH`、`VERSION_CONFLICT`、`DIFF_MISMATCH`、`SOURCE_CHANGE_REQUIRED`、`UNSUPPORTED_MIGRATION`、`SELECTION_REQUIRED`、`CONTEXT_CHANGED`、`PLAN_NOT_OWNED`、`PLAN_NOT_PENDING`、`CONFIRM_BUSY`、`PLANNER_DISPOSED`，以及原协议 `VALIDATION`、`LIMIT`、`DIGEST_MISMATCH`、`READ_ONLY`、`AUTHORIZATION_CHANGED`、`REVISION_CONFLICT`。request/生命周期拒绝抛异常；install 的正式提交拒绝保留原 RuntimeResult。调用者两类都必须处理，不能将 Promise resolve 等同成功。

## 本轮测试证据

macOS，Node `v24.22.0`，复用现有依赖，无 npm install。测试执行官方 TypeScript 转译器加载固定仓库模块；候选 TSX 仅作为字符串，没有转译/编译、import/eval 或运行。`npm run build` 构建的是固定生产应用，新增模块未接入生产应用。

| 命令 | 结果 |
| --- | --- |
| `node --test tests/mochi-source/*.test.cjs` | 35 通过，0 失败/跳过 |
| `node --test tests/custom-block/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block-workshop/*.test.cjs src/integrations/mochi/host.test.cjs tests/mochi-source/*.test.cjs` | 283 通过，0 失败/跳过，包含上述 35 项 |
| `npm test` | 158 通过，0 失败/跳过 |
| `npm run build` | TypeScript + Vite 通过 |
| `git diff --check` | 通过 |

可复核的命令、退出码、统计与日志摘要见 [mochi-source-test-evidence.json](./mochi-source-test-evidence.json)。计数基于最新 main `85d4d5d` 上的最终运行，模块用例同时包含在组合回归中，不累加为独立覆盖数。

新测试覆盖：预览无写入/无候选登记、成功只改目标、完整项目数据保留、旧状态/版本追溯、重复确认、取消、外来 ID、最小上下文、请求/摘要/manifest/props/差异错误、扩权/Schema 迁移拒绝、仅 props 伪修改拒绝、过期选择/模式/revision/授权、迟到响应、getter 拒绝、提交租约、确认期间业务写入与撤权、两个 planner 的真实 CAS 竞争、并发换版冲突、模型 seam 非 JSON 拒绝、provider 异常与 dispose。

## 剩余接线与发布边界

独立模块和 Mock 闭环可立即复用。生产自然语言闭环尚需：负责人接线真实 Mochi/选择 UI（含确认租约）、单独授权模型传输与准确摘要生成、模型输出质量验收、受控构建/安全 Viewer 的独立验收、统一持久化中的历史恢复。源码内容变化不代表“45 分钟功能已验证可用”。本任务没有新增付费请求、合并、部署或执行 AI 源码；稳定 Demo 的生产文件零改动。
