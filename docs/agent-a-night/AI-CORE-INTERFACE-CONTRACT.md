# AI Core 接入契约与跨模块补丁建议

2026-10-19；基线 `4044fb185a2720eead0dc6710b0d38a215439b98`。这是后续接入设计，不代表下列缺失接口已经上线。REAL_MODEL_CALLS=0。

## 当前可用路径

1. v1 正式 `/ai-create` 显式提交 → `generateProject` → 既有 `/api/generate-app` → AppSpec v1 严格结构和完整性验证 → 唯一 Runtime → B/C。本轮以本地 HTTP 上游 fixture 验证；没有实际付费模型验收。
2. v2 正式入口只加载明确标注离线的可信番茄钟；服务器交互生成门禁继续默认关闭。
3. `createModelPlanProvider(complete)` 是无网络的依赖注入 seam。生产 Workshop 仍使用 `unavailablePlanProvider`。测试返回 JSON，经既有 Host、AppChangePlanner、显式确认、owner/CAS 才能写入。
4. Artifact 安装得到不可执行或 pending-build 的 CustomBlock，不能把“安装成功”解释成“运行成功”。

## 后续 Mochi 修改传输约束

- 复用现有服务进程、错误规范和超时设施；不要让只读 Conversation 的建议隐式成为修改指令。新增修改 endpoint 的最终路径、认证和费用策略需要服务负责人审阅，此分支不宣称某路径存在。
- 调用必须来自用户显式请求；服务器凭自身配置确认模型费用授权、预算、并发、Origin 和身份，不接受浏览器声明“已授权”或客户端模型凭据。不得自动重试付费请求或自动 fallback 到预置成功答案。
- request 内容来自 `toMinimalPlanInput`：requestId、baseRevision、prompt、选中 block 元数据与绑定 entity 字段类型。不得传 records、完整 ProjectState、授权对象、其他积木、源码或隐私。名称和 prompt 同样属于用户数据，不能视作可信指令。
- 当前适配器 instruction+request 的 UTF-8 JSON 上限 64 KiB；超限在 transport 前失败，不能截断改变编辑含义。响应上限 64 KiB。HTTP 层还须按流计数字节、fatal UTF-8、设置截止、释放迟到或未用响应体；Content-Length 不能替代实际计数。
- completion 只返回 JSON 数据 `{request:{requestId,baseRevision,commands},capabilityIds:[]}`。只支持现有 addField/configureBlockFields/addBlock/removeBlock；返回 requestId/revision 必须与 Host 原请求相同。字段只能按现有规则新增可选项；无任意 TSX、按钮颜色、事件处理、权限、替换项目或记录写入命令。
- JSON parse 不是授权。Host 继续生成 scope，并以原始 planner handle 预览和确认。不得从显示用 planId/preview 重建授权；不得在服务返回时直接 commit。
- 预览成功后用户显式确认才可提交。确认继续检查 Runtime identity/revision、唯一 owner 的 authorization identity/generation、选中块和 epoch。权限撤销后再授予也不能恢复旧计划。
- 切换选中块、替换项目、改变 revision/权限、取消、dispose 均退休原请求；提供方忽略 AbortSignal 时 Host await 仍应尽快结束。旧 resolve/reject 不得覆盖新预览、busy、receipt 或历史。
- 网络错误、验证失败、取消和冲突不得创建部分编辑。提交结果未知时不得自动重试原计划；显示需核对当前状态。

## CustomBlock / Viewer / 源码修改

- `createGenerator.generate(input, {signal})` 与 `createDeepSeekProvider.generate(request, {signal})` 现支持调用方取消。存储前取消及时结束并禁止写入；`store.put`开始后等待实际结果，不把已提交的存储伪装成回滚。未来HTTP适配器必须区分取消阶段，不能自动重试。
- 源码模型seam请求的实际UTF-8序列化上限512KiB，包括instruction、转义源码、manifest和props；响应同为512KiB。超限拒绝、不截断；模型seam仍无生产endpoint或费用授权。

- 继续使用 manifest、versionDigest、现有 Artifact Installer 和唯一 project session；不能只凭 definitionId 匹配版本，也不能在导入时把旧 state 套给不兼容 Schema。
- B 参数更新、布局、重新安装及 C 投影都通过同一个 owner/CAS。session 内保留不等于跨刷新存储；未来持久化必须验证完整项目、artifact 精确版本、Schema 和所有权，不接受旧写句柄。
- `createSourceEditPlanner` 的 candidate 是待审版本；源码摘要/props/版本校验和确认不是执行许可。不能 import、eval 或挂载生成 TSX 来“测试成功”。
- Viewer 必须先有真实隔离 provider 的独立验收：能力最小化、消息身份/序号、资源限制、销毁、网络和 DOM 边界。缺少该验收时继续 unavailable。不得更改状态文案伪装可运行。

## Agent B / 其他模块配合

- React ZIP exporter/template 归 Agent B，本分支零修改。接口应接收已验证的一次性项目快照，不传运行中的 owner、授权句柄或变更能力。
- v1/v2/CustomBlock 的导出支持要分别声明；不能因共享 schema 接受 v2 就默认 ZIP 或业务质量评估支持 v2。未知版本继续明确拒绝。
- 请求 Agent B 后续验证：参数/布局快照一致、生成项目离线启动边界、unsupported CustomBlock 的明确拒绝、输出不携带密钥。本任务只记录契约，未向其他 chat 发送消息。
- 服务负责人：确认修改接口的鉴权/费用和日志脱敏；前端负责人：在服务验收后显式接入 seam 并保留确认 UI；安全运行负责人：Viewer provider 验收。上述模块配合前不能宣称任意自然语言→TSX→C→ZIP 完成。

## 可审阅验收顺序

先以已审核 fixture 跑 HTTP→模型计划适配器→Host→预览→确认→B/C；再测超限、非法包络、取消/迟到、权限 ABA、revision 冲突和失败不改项目；最后在另行获得付费授权后，单独记录真实模型语义验收及实际调用次数。任何阶段都不绕过 Viewer。
