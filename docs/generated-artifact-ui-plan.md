# P1-B：离线 AI 制品正式 UI 接线方案（已批准）

基线：GitHub main `7e94dc9568501dd4ad218a43b5aca31026aed2b2`，含 #34。独立工作树 `/Users/nanmuxun/BlockAI/BlockCraft-AI-generated-artifact-ui`，分支 `feature/generated-artifact-ui-20261018`。本方案最初以文档提交；随后 Tech Lead 明确授权三个生产文件的独占修改窗口。以下保留设计依据，实施与验收结果见 `generated-artifact-ui.md` 和 `generated-artifact-ui-evidence.json`。

## 1. 最小用户流程

复用 CustomBlockImport 的文件输入，增加明确的“AI 代码积木 · 仅新增”入口，与原添加/替换流程区分；旧路径和行为保留，不再做第二个文件导入器。

支持 #34 exportPendingInstall 输出的封装 JSON，以及原 importFile 格式。封装的来源字段仅展示为“文件声明来源”，不能当作模型真实性、安全许可或项目授权。离线验收包从既有归档真实 DeepSeek 番茄钟，经原 store 验证和 exportPendingInstall 生成，不手工重写模型源码，不在生产应用 import fixture TSX。

用户选择文件后展示候选名称、精确 definitionId/versionDigest、参数及来源。文件初读只是未准入候选；点击“预览添加”后调用现有 installer.prepare，只有通过其完整校验才能进入确认状态。所有字段按纯文本/JSON 展示，禁止 HTML、动态 import、eval、源码转译。预览显示“尚未构建，暂不可运行”；提供“取消”和“确认添加”。

确认仅调用 installer.confirm(ticketId)。成功后由现有订阅更新 CustomBlockCanvas，复用 CustomBlockInspector 查看参数；不自动改旧实例或调用另一条 install 路径。C 模式沿用既有 pending/unavailable surface。本功能不修改 Viewer。

## 2. 唯一状态及同步生命周期门禁

Installer 绑定当前 runtime.customProject；只承载临时票据及 UI 状态，不保存第二份项目数据，不创建 Runtime/Host/owner，不修改 CAS。异步文件读取与 prepare 使用递增请求代际，丢弃迟到结果；确认 handler 在首个 await 前用 ref/控制器同步锁定，防止 React 尚未重绘时双击。

单独新增 UI lifecycle binding，包装原 installer 的 prepare/confirm/cancel/invalidate/dispose，暴露同步 `beforeContextChange()` / `beforeDispose()`。先执行原 invalidate/dispose；CONFIRM_BUSY 时原样保留宿主状态，后续 setter/导航不得执行。不得吞掉错误后继续卸载；不以 cleanup effect 为门禁。

代码检查发现必须覆盖的真实入口：

- AppSpecWorkshop 的首页 `<a href="/">`：同步导航 handler 门禁，忙时 preventDefault；B/C 模式事件也先门禁/取消旧预览，再调用原 host.setMode。
- AiCreate.generate 的生成新项目入口，以及异步完成后 setApp 前：各自同步重新门禁。仅按钮 disabled 不足以防迟到结果覆盖确认中的项目。
- AiCreate 对 Workshop 的 key/runtime 替换：先 dispose 旧绑定成功，再 setApp；失败保留旧项目，不让 React 卸载先发生。
- 页面关闭/刷新：beforeunload 在确认中请求浏览器阻止离开；无法保证操作系统强制终止或脚本外部强制卸载。文档明确这不属于 React cleanup 能保证的事务取消。
- 可复用父级主动卸载：提供同一同步门禁接口，测试 harness 必须先门禁再 root.unmount。未来任意新卸载/项目切换入口也必须使用该接口。

确认中的项目编辑/权限变化依旧由原 installer/session 的身份检查及 CAS 拒绝，绝不自动重试。其他组件操作不扩权。Mochi Host 生命周期和内部事件实现不改；新增门禁在调用方。

## 3. 计划改动边界与冲突确认

预计已有文件改动仅：

1. `src/integrations/custom-block-bc/CustomBlockImport.tsx`：复用文件输入，增加 AI 新增预览/确认路径，保留旧路径。
2. `src/components/app-builder/AppSpecWorkshop.tsx`：传入受控 binding；首页/B-C 按钮调用方门禁。既有 Canvas/Inspector/RunSurface、导出按钮、Mochi 挂载不重构。
3. `src/components/ai-create/AiCreate.tsx`：持有 session-bound binding，并在替换 runtime/卸载前同步门禁。

其余为新增 generated-artifact UI/controller、局部 CSS、离线包生成工具、组件/浏览器测试及证据说明。若实施需要扩大以上生产文件范围，先更新方案。不会写入其他工作树，不修改 P0 Viewer/构建器、安全协议、owner/CAS、#31 ZIP 导出实现、Mochi Host 或付费授权门禁。

已只读核对本机工作树列表，存在独立 compiler-isolation 工作树；本方案不涉及其目录。Tech Lead 后续已明确授权本分支独占上述三个共享生产文件，在两小时或 Draft PR 提交前完成；未向其他线程发消息。

## 4. 验收矩阵（计划；实际结果见验收报告）

- 新 UI/component/controller：未确认零项目及 registry 写入、真实 fixture 安装及取消、双击、并发/迟到文件、坏 digest/Manifest/props、只读及授权变化、旧 ID 冲突、revision 过期。
- 同步 handler：延迟 session.install 时尝试项目替换、模式切换、首页导航和父级卸载，必须在 setter/unmount 前收到 CONFIRM_BUSY；结束后允许离开。覆盖 StrictMode 重放及 owner/session 更换。
- 安装前后对比旧实例、旧版本 registry/state、业务记录、位置及 renderOrder；追加恰好一个目标实例。
- 真实 Chromium 1366/390：真实页面导入离线包→预览→取消→再次预览→确认→选择/拖动/查看参数→C pending/unavailable。截图、trace/录屏与报告保留，监听外网请求、iframe、源码加载/执行信号。固定离线 AppSpec 响应避免现有页面初始生成调用模型。
- 安装器 12 项、CustomBlock/owner/Host/source-plan/Mochi、生成器离线、#31 ZIP 导出、npm test、TypeScript、生产构建、diff 检查；重跑既有 Workshop/B-C 浏览器确保稳定 Demo 无回归。通过后创建独立 Draft PR；未经实际执行不得标 PASS。

## 5. 自然语言生成的后续接口方案（本轮不编码服务）

当前正式后端缺少生产身份认证、项目 ACL、持久付费预算，不新增无认证生成或制品读取 HTTP 接口。第一阶段仅用户显式选择离线导出文件；不会为它开放模型调用或自动读取私有 store。

未来可审阅独立 local-demo host：仅开发命令显式启动，生产构建硬关闭；监听数字 IPv4/IPv6 loopback，校验精确 Host/端口和 Origin，拒绝跨域/null Origin/任意代理转发；无 wildcard CORS。可信宿主创建高熵短期会话及 CSRF 凭据，在内存绑定项目标识、revision、精确 reference、过期时间和一次性请求 ID。UI 只能领取该会话已准入的 pending export，不能传路径或读取任意 store 条目。来源状态由宿主响应附带，仍不能充当项目授权；UI 依旧 prepare/confirm/session.install/CAS。

调用生成器仍需独立人工付费授权；仅领取已有制品与付费生成使用不同权限。缺少跨重启预算/审计、可信认证与 ACL 时，这个适配器也不能升级生产或成为自动付费入口。本轮只提交接口提案，不开启本地服务或 DeepSeek。

## 6. 当前结论

架构确认已完成，已实施第一阶段并验收。建议 GO 进入离线制品 B 模式功能的 Tech Lead 代码审核；实时模型、生产传输与源码执行仍为 NO-GO。Draft PR 不自动合并，提交后停止修改三个共享生产文件。
