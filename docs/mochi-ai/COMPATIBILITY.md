# PR #26 最小兼容复核（2026-10-18）

状态：等待 Tech Lead 复核；Draft，不批准合并、正式接线、部署或付费启用。

## 冲突与范围

- 最新远端 main：`2678c5e9c8dca05b79a45f37f0c4104b9cfc5cdc`，包含 #27 动画合并。本分支合入该 main，自动合并无文本冲突。GitHub 在更新前返回 `mergeable=true / clean`；这不等于审核批准，也不保证未来 main 不变化。
- #27 修改 Emotion、Overlay、motion 与动画测试；#26 新增独立模块，路径不重叠。相对上述 main，动画、Workshop、Canvas、Inspector、Host、Runtime 和 CustomProjectV2 owner 均零改动。合入 main 的动画文件只是基线同步，不是本 PR 对这些文件的修改。
- 旧 `workshop.patch` 在上述 main 仍通过 apply-check，但仅代表文本匹配。它直接改旧侧栏，不能据此认定适配正在进行的 v2 接线；已删除，禁止使用历史副本覆盖生产页面。
- 本地已有 v2 接线提交 `efd0940`（`feature/custom-block-workshop`）尚不在本次远端 main。只读比较显示其 Workshop 使用混合 renderOrder、CustomBlockInspector、`canvasReady` 和同一 `runtime.customProject`，旧 Patch 的侧栏上下文与之冲突。本 PR 不合入或修改该 owner/接线提交，不声称已验收未来 v2 产品。

## 主集成接口契约（待批准，不是可执行 Patch）

`createWorkshopMochiConversation(existingHost, options)` 只消费：

```ts
getSnapshot(): { context: MochiHostContext; mode: 'blocks' | 'run' }
subscribe(listener: () => void): () => void
setSelection(blockId: string | null): void
```

沿用现有唯一 host，不能创建第二个 host 或 owner。桥接只创建独立 conversation；由现有 owner 生命周期创建/销毁一次，B/C 切换复用。可选面板自行拥有桥接时，不能又在外层创建一份桥接。

当前协议只支持宿主已经投影并验证的内置 blockId 与实体字段关系；不接受完整 v2 project、源码、manifest、props、业务记录或 Runtime。现 main 的 host 只投影内置积木。若 v2 选中 custom id，不能强塞进内置 context、假造 relation 或扩大 `setSelection` 权限；在主集成提供正式、经过审核的投影契约前，该上下文应停止 AI 请求并显示不可用。custom 建议和源码修改不在本次兼容范围。

定位建议时会重读当前宿主并验证 blockId；只调用原 `setSelection`。锚点/动画通知不触发模型，模式切换取消待分析事件。现 host 的真实 Runtime 回归覆盖聊天、定位、主动选择事件、锚点与模式通知、卸载及零 Runtime 修改。独立 fixture 的浏览器证据继续有效，但不能作为最新生产页面已接线的证明。

`modificationsEnabled=false` 与 `capabilities.modifications=false` 保持不变。建议只解释、定位、追问、忽略；未来修改仍须真实 PlanProvider → 既有 Phase A 预览/确认 → Runtime receipt，不把建议当源码修改能力。

## 可信服务端访问：当前部署阻塞

已查 `server/index.mjs`、`server/README.md`、`vite.config.ts`：Node 服务仅监听 `127.0.0.1`，没有认证中间件、服务端 session store 或项目 ACL；Vite 转发 `/api`，不会产生认证。现有浏览器项目标识不是服务端访问凭据。仓库未提供可验证的公网生产鉴权部署配置。

因此目前没有可供接入的可信 `resolveAccess` 实现；保留注入接口，不新增第二套认证体系，不提供生产 stub。缺少 resolver/origin 返回 503，未认证返回 401，可信 appId 与请求 context 不匹配返回 409，均不调用 Provider。测试 Cookie 是离线 fixture，不可复制到生产。

正式部署需要现有认证基础设施在服务端校验会话（例如经签名且可撤销的会话 Cookie），用服务器保存的用户/项目绑定与 ACL 验证当前目标项目，再返回 `{sessionId, appId}`。sessionId 在同一用户会话跨项目保持稳定，防止轮换项目绕过会话预算。项目选择即使来自客户端，也只能作为待核验目标，不能作为授权结果。代理身份头只有在认证网关剥离外部同名头、且后端无法绕过网关时才可作为经过审核的部署输入；当前未实现或验证。Origin、Host、X-Forwarded-*、body 的 sessionId/权限、客户端 blockId 均不能授予权限。还须在实际 HTTPS/代理拓扑验证同源/CSRF、注销/过期/撤销/跨项目拒绝，再由 Tech Lead 确认 `permissionsVerified`。

## 费用与启用阻塞

现有 grant 的 maxCalls/maxTotalTokens 是单进程内存准入限制，重启重置；**不是持久人民币费用上限**，也不覆盖其他生成接口。部署前需要跨实例原子持久账本、金额预留与对账、明确模型计价及提供方费用上限，并覆盖共享密钥的其他调用入口。本 PR 不实现或宣称已经实现这些能力。

离线通过不能证明真实 Provider 可用，也不能把 providerVerified/permissionsVerified 设为 true。真实请求的次数、人民币预算和有效期必须另获 Tech Lead 授权；本轮真实调用 0。默认 disabled、无 Mock fallback、不重试、取消计入准入预算的机制均保留。

## 复核结果

必要回归与既有浏览器证据范围见 [VALIDATION.md](VALIDATION.md)。除同步 main，本轮只移除旧 UI Patch、更新交接说明，并补充真实 host 兼容及权限拒绝测试；不扩展产品功能。下一步等待 Tech Lead 复核。
