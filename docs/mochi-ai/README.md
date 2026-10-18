# Mochi DeepSeek Intelligence — 集成交接

当前交付是真实 DeepSeek HTTP Provider、独立浏览器客户端、可信宿主桥接和可选聊天面板。正式服务器与 Workshop **尚未接线**，生产默认禁用。没有运行真实 API，没有合并或部署。离线 fixture 仅存在于 tests；生产没有 Mock fallback。

## 完整接线方案

用户输入 / 主动事件 → `MochiConversationPanel` → `createWorkshopMochiConversation(host)` → `createMochiConversation` → 同源 `/api/mochi-ai/analyze` → HTTP 权限与请求验证 → service 预算/并发/同意检查 → `createDeepSeekProvider` → 现有官方 DeepSeek endpoint → Schema 与 blockId 验证 → 带上下文 binding 的建议 → 客户端拒绝过期回复 → 点击时再次读取可信 host → `host.setSelection(blockId)`。

当前只保留服务端路由的参考 Patch（未应用，也未获正式接线批准）：

```sh
git apply --check docs/mochi-ai/patches/server.patch
# 仅检查；正式接线仍须 Tech Lead 复核批准。
```

- `server.patch`：只给 `createAppServer` 增加受信任的 `mochi` 配置和路由委托。沿用现有 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、fetch；不新增密钥存储。不传配置即禁用，Patch 本身不启用付费请求。
- 旧 `workshop.patch` 已移除，禁止沿用覆盖生产页面。动画与 v2 接线的兼容检查、唯一 host 接口及待办见 [COMPATIBILITY.md](COMPATIBILITY.md)。可选面板仍未挂载，由主集成负责人在获批后确定产品呈现位置。
- 未修改 `WorkshopMochi.tsx`、`MochiEmotion.tsx`、`MochiOverlay.tsx`、Canvas、Inspector、CustomBlock 或 Runtime。
- `createWorkshopMochiConversation` 只需要 `getSnapshot / subscribe / setSelection`，不接受 Runtime、PlanProvider、confirm handle 或完整快照。

将来经批准完成接线后，需在正式 Workshop 补充浏览器验收。本 PR 的浏览器证据来自独立离线验收页，不能证明正式产品已经接通。

## 启用权限与费用边界

`createMochiIntegration({ enabled, approval, resolveAccess, allowedOrigin, apiKey, model })` 全部由可信服务端传入。不得把请求体、浏览器 Header 或环境变量字符串直接当作授权对象。

- 默认 `enabled=false`。密钥存在也不启用。
- `approval` 必须包含 Tech Lead 单独批准的 `reference`、正整数 `maxCalls / maxTotalTokens`、未来毫秒时间戳 `expiresAt`，且 `providerVerified=true / permissionsVerified=true`。服务创建时拷贝冻结；每次请求复核过期。撤销时应停用实例并中止相关请求，不仅修改原始配置对象。
- 本 PR 没有真实授权对象。测试 grant 只配合注入的离线 fetch 使用。
- `resolveAccess(req)` 必须先认证会话、验证该用户有权访问目标应用，再返回 `{sessionId, appId}`；会话 ID 必须由服务端决定，跨项目保持稳定。不能使用 body 或调用方自报 sessionId。实例/版本 binding 用于过期检查，不是授权凭据。
- 当前 `server/index.mjs` 没有会话认证或项目 ACL，项目在浏览器持有；Vite `/api` 代理只解决路由，不提供权限。现部署无法直接实现可信 resolver，保持未接线/禁用。不得添加固定返回授权、信任任意 Cookie 或客户端权限头的生产替代实现。部署依赖见兼容报告。
- `allowedOrigin` 是部署配置的准确 origin（支持 HTTPS）；不从 Host / X-Forwarded-* 推导。无 CORS，POST 仅 JSON。反向代理应保留严格认证与同源策略。
- 每会话每小时最多 8 次、保守预留 100,000 token；全局同时最多 2 次、单会话 1 次。聊天间隔 2 秒，主动间隔 30 秒。全局授权的调用数和 token 预算同时生效；失败、取消与无效回复也计费，不重试、不退预算。
- 预留值为 UTF-8 请求消息字节数 + 1,024 输出 token + 256 消息开销；这是准入上限估计，不是实际账单。Tech Lead 仍需按批准的模型价格确定调用数和金额预算，不在代码里臆造价格。
- **内存 token 准入预算不等于持久人民币费用上限。** 当前计数器仅驻留单进程内存，重启会重置；不保存人民币额度、模型价格、缓存计价或实际账单。受控真实验收也须另获明确调用次数及金额授权。常规生产、多实例或自动重启部署必须先接持久化原子预算账本、共享同意状态与共享并发限制，并由部署方落实金额硬上限及账单核对。不可在多个 worker 重复使用一份 grant。本轮不启用任何真实请求。
- 现有应用生成接口与本模块共享 Provider 配置，但不共享本模块预算。部署方必须把二者纳入同一总费用批准范围，不能把 Mochi grant 视作全站费用上限。

真实 Provider 的模型可用性、网络和质量尚未验证，`providerVerified` 不能因离线测试通过而设为 true。真实调用的次数及预算必须另获 Tech Lead 批准后，才能在受控验收中验证。

## 协议 v1

四个同源路由：

| 路由 | 方法 | 内容 |
| --- | --- | --- |
| `/api/mochi-ai/status` | GET | enabled、proactiveEnabled、modificationsEnabled=false、可选 reason；不会调用模型 |
| `/api/mochi-ai/consent` | POST | `{ "enabled": true/false }`，明确开启/关闭主动建议；关闭会中止在途主动请求 |
| `/api/mochi-ai/analyze` | POST | 下述聊天或事件请求 |
| `/api/mochi-ai/ignore` | POST | `{ "id": "ai-<32 hex>" }`，10 分钟冷却 |

聊天请求示例（其余结构见 `tests/mochi-ai/fixtures.mjs`）：

```json
{
  "version": 1,
  "kind": "chat",
  "prompt": "这个报名应用下一步可以怎么完善？",
  "history": [],
  "context": {
    "appId": "signup", "instanceId": "workshop-1", "revision": 0,
    "selectedBlockId": "form", "mode": "blocks",
    "blocks": [{"id":"form","name":"报名表","type":"form","fieldIds":["name"]}],
    "entities": [{"id":"signup_entity","name":"报名信息","fields":[{"id":"name","name":"姓名","type":"text"}]}],
    "relations": [{"blockId":"form","entityId":"signup_entity"}]
  }
}
```

主动请求使用同一结构，但 `kind="proactive"`、`history=[]`、无 prompt，且 `event={"type":"structure-changed"}`。只接受 `project-opened / structure-changed / selection-settled`。用户开启开关本身不发起模型请求；之后的有意义变化才触发。

成功响应：

```json
{
  "version": 1, "source": "deepseek", "capabilities": {"modifications":false},
  "binding": {"appId":"signup","instanceId":"workshop-1","revision":0,"selectedBlockId":"form","mode":"blocks"},
  "message": "报名信息已经有了，可以再明确一下截止时间。",
  "suggestions": [{
    "id": "ai-0123456789abcdef0123456789abcdef",
    "text": "要不要补充报名截止时间？", "reason": "参与者更容易安排提交时间。",
    "blockId": "form", "priority": "medium", "requiresUserAction": true, "kind": "design-change"
  }]
}
```

- 模型输出的闭合 JSON Schema：`server/mochi-ai/model-response.schema.json`；`protocol.mjs` 执行相同验证并动态检查 blockId，拒绝额外属性、重复 ID、外部积木与不合规的修改建议。模型不能自定 `id / binding / source / capabilities`；这些由服务端生成。
- 错误形状 `{error:{code,message}}`；客户端仅显示本地安全文案，不渲染上游错误详情。
- 建议 ID 根据 blockId、kind、NFKC 规范化文本生成；忽略理由和标点差异。相同建议和相同结构事件均有 10 分钟冷却，内存集合各最多 200 项。这是规范化文本去重，不保证识别不同表述的同义建议。
- 所有 AI 文本作为文本显示，不解释为 HTML、代码、URL、计划或授权。

## 隐私、事件与失败行为

浏览器和服务端都重新投影白名单：应用/实例 ID、revision、选择、模式、积木名称和类型、字段 ID/名称/类型、积木与实体关联。最多 20 积木、10 实体、每实体 24 字段、上下文 10 KB、请求 16 KB。过大直接拒绝，不偷偷截断。仅发送最近 4 条用户明确输入，各最多 1,200 字；不发送助手历史、记录值、选项值、字段默认值、完整 spec、坐标、Runtime 或 Phase A 快照。

常见 sk-/Bearer/credential assignment/私钥格式在投影和 egress 脱敏；这不是任意敏感文本分类器。用户明确输入和结构名称本身可能含敏感语义，面板提示不要输入业务记录或密钥。服务不记录请求、上游正文或密钥；usage 只有计数且不作为公开路由。

宿主结构变更或选择稳定 750 ms 后才分析；锚点测量、拖动、滚动、仅记录 revision 变化和模式切换不触发请求。没有轮询。上下文变化、切换项目、取消或卸载会取消在途请求并丢弃晚到回复；切换应用清空用户历史。浏览器请求 25 秒、Provider 20 秒超时，模型响应最多 32 KB。客户端断开会中止上游；取消无法撤回已发生的上游费用。

## 修改与 Phase A

`modificationsEnabled=false` 始终成立，`requestModification` 固定拒绝。建议可定位、解释、继续提问或忽略，不能直接创建字段或执行修改。不存在建议到 Runtime 命令的映射，也不把 `requiresUserAction` 视为权限。

以后真实 PlanProvider 接通时，必须由可信集成层读取最新上下文，以用户明确的修改请求走既有 `host.callbacks.onRequestPlan` → Phase A 校验/预览 → 用户确认 → `onConfirm` → Runtime。不能把 advice JSON 当成计划，不能自动确认，只有 Runtime receipt 才能表示修改完成。本 PR 不启用这条链路。

## 离线验证与浏览器证据

```sh
node --test tests/mochi-ai/*.test.mjs
npm test
npm run test:mochi-host
npm --prefix server test
npm run build
node tests/mochi-ai/browser-server.mjs
```

最后一条输出 localhost URL；手动打开独立验收页。它注入离线 fetch，不读取 .env，展示 `OFFLINE ACCEPTANCE / 真实调用 0`。流程：检查连接 → 输入问题 → 发送 → 定位积木 → 继续交流 → 开启主动建议 → 点击结构事件按钮 → 查看新建议 → 忽略 → 关闭主动建议 → 模拟错误 → 禁用。

`evidence/chat.png / proactive.png / disabled.png` 展示浏览器状态；`evidence/browser.json` 保存 fixture 调用、脱敏后的 egress 与预算计数。测试业务记录/密钥哨兵没有进入 egress。该测试证明真实 Provider 代码的请求/校验链路可运行，不证明真实 DeepSeek 质量、真实授权或正式 Workshop 接线。
