# 正式 Workshop 聊天接线兼容性（2026-10-18）

基线 `main@85d4d5de016a2f424cbd49efb6312377dcdc4deb`，含 #24/#25 唯一 v2 owner、#27 动画、#26 Intelligence 模块及 #30 ZIP exporter。独立工作树中安全快进同步，保留已有未提交成果，未覆盖历史 Workshop Patch。

## 唯一 Host 与 owner

AppSpecWorkshop 原有生命周期创建并释放唯一 host；本次只在同一侧栏挂载 ConversationPanel。B/C 复用同一 Host、Runtime 与 `runtime.customProject`。自定义上下文配置 useMemo 绑定该 owner；面板只创建 conversation 和只读 projection，卸载会销毁订阅、定时器和请求。没有向 owner 写入的接口。

Host 契约保持 `getSnapshot / subscribe / setSelection`。新增投影源只暴露 `readReferences(): {id,definitionId,versionDigest}[]` 与原 owner 的 registry.resolve。没有传递 Runtime、PlanProvider、执行能力或完整项目快照给 conversation。

## 混合上下文协议

原协议要求每个积木有实体 relation，导致含 custom 的整个项目被拒绝。现在内置积木仍保留真实 relation/fieldId 校验；custom 类型必须 fieldIds=[]，不允许 entity relation，另有 parameters: `{name,type,required}[]`。builtin 不允许携带 parameters。

投影先读取已登记 instance 的精确 definitionId/versionDigest，从唯一 owner 的不可变 registry 读取元数据并核验引用，只挑选 manifest.name 与 propsSchema 顶层属性名/类型/required。Schema 的 title、enum、default、嵌套结构，props/state 值、事件、依赖、源码均不进入 DTO。读取中、版本缺失、超过边界时停用当前分析；旧异步结果不得覆盖新版本。schema 名称作为不可信文本脱敏、按文本显示；不把任何模型文本视作指令或授权。

只读 registry 是可信宿主来源，浏览器项目描述仍不是服务端 ACL 凭据。服务端重新校验 wire allowlist 与 app 绑定，点击时在当前可信 Host 中再次验证 blockId/版本上下文。唯一可调用的动作是 setSelection；没有 advice 到 Runtime 命令的映射。

## 服务端默认关闭

`server/index.mjs` 将四个 /api/mochi-ai 路由委托给现有模块；共享现有 key/model/fetch，CLI/env 不提供启用捷径。缺少部署 origin 或可信 resolveAccess 时 status 返回公开、固定禁用说明，POST 拒绝且零模型 egress；有认证但未配置持久费用预留时同样禁用。status 不泄露项目/会话信息、不调用模型。

现服务器没有可用的会话认证、服务端项目存储或 ACL。浏览器 appId、Cookie 内容、Origin/Host、自报身份头均不能作为授权结果。部署方必须接入真实可撤销认证和服务器存储的项目权限，验证 HTTPS/代理/CSRF/过期/跨项目拒绝后再向 resolveAccess 注入结果；本次不提供生产替身。

`reserveBudget` 必须在真实 egress 前原子预留持久金额；输入不含项目内容。内存 call/token 限额只是附加防护，不是人民币限额。当前没有生产账本实现或付费授权；多个 worker 的共享同意/并发策略和共享密钥其他入口仍需部署审核。离线 fixture 的固定身份、grant、预算 true 仅存在 tests，不可复制生产。

## 保护边界

MochiEmotion、MochiOverlay、WorkshopMochi、Canvas、Inspector、CustomProjectV2 owner、Runtime、Phase A、CustomBlock 执行器均无变更。保留原动画/情绪/建议/确认 UI；`modificationsEnabled=false`、原 unavailablePlanProvider 不变。聊天建议仅解释、建议、定位、追问、忽略，不宣称已修改代码。用户未明确开启主动建议时，选择/布局/模式事件零分析请求；无轮询。

本轮只提交独立 PR，等待 Tech Lead；不合并、部署或调用真实付费 API。
