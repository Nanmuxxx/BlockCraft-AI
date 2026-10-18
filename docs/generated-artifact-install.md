# 已生成源码制品 → B 模式确认安装

基线：`main@f0ddd21cb44749adf34fa473f3ae52115e273d3f`。本 PR 仅添加接线模块、测试、存档制品和说明；不修改正式 Workshop、CustomBlockImport、生成器/Provider/store、唯一 owner、构建器或 Viewer。它是可接线的离线安装链路，不是正式 UI/模型/运行闭环。

## A. 最小接口与信任边界

既有流程为人工授权 `createDeepSeekProvider({allowPaid:true,...})` → `createGenerator({enabled:true,...})` → `admitOutput` → `store.put`。生成器已验证 SourceArtifact v1、固定依赖与导入策略，并返回精确 reference；不重建这个生成器，也不新增 HTTP 路由、环境变量启用开关或模型调用。本轮从存档 JSON 开始，无新 DeepSeek 请求。

新增服务端 `exportPendingInstall(store, {reference, instanceId, props})`：

- 可信宿主传入既有私有 pending-store；不接受任意文件路径，不访问模型。
- 通过 `store.inspect(reference)` 及 `validateRecord` 再校验 pending 状态、完整 Manifest/SourceArtifact 与重算 digest，核对 definitionId/versionDigest。
- 校验宿主提供的完整 props；不从 schema 猜测默认值。生成安装 v1 拒绝 host capabilities/events。
- 返回 `{importFile:{instance,artifact}, provenance, status:'pending-build', validation:'source-admitted', build:'not-attempted', execution:'denied'}`。
- `importFile` 恰好兼容现有 B 模式 CustomBlockImport 文件协议；外层 provenance/状态不能作为文件内容直接传给旧导入器。
- provenance 仅为来源记录，不是安全证明、执行许可或用户项目授权。私有 store 的持久化与 session 项目持久化是不同生命周期。本 PR 不新增项目持久化或历史库。

新增客户端 `createGeneratedArtifactInstaller(existingSession)`：

```ts
// 必须复用 runtime.customProject，不能创建第二个 runtime/session/owner。
const installs = createGeneratedArtifactInstaller(runtime.customProject)
const preview = await installs.prepare(exported.importFile)
// 展示精确版本、props、pending-build 与“仅登记，不代表编译/可运行”。
// 用户明确确认才调用：
const receipt = await installs.confirm(preview.ticketId)
// receipt.ok 才可称“安装成功”；不等于模型/功能/编译/运行成功。
// 用户拒绝：installs.cancel(preview.ticketId)
```

`prepare(unknown)` 捕获输入、快照、revision 与授权身份，重验制品摘要、props 和完整候选项目，返回递归冻结的 preview。此阶段没有 install、registry 登记或项目写入。ticket 只属于该控制器，JSON 形状不能授予确认权。

`confirm(ticketId)` 重验 session 快照身份/revision、授权对象代际、上下文 epoch，再调用唯一 `session.install({...importFile,baseRevision,expectedReference:null}, capturedAuthorization)`。现有 install 负责最后准入及 CAS；本模块不自行调用 CAS，不自动重试冲突，不更改 baseRevision。失败为终态；成功重复确认只返回原回执并标记 duplicate，不再次安装。旧成功票据只代表原 session 的历史回执，不表示当前项目仍含该实例。

只支持新增自定义实例。现有 ID、全局 ID 冲突、无效 props、错 digest 或扩权均拒绝，不推断替换意图。已有实例换版继续使用 #33 独立源码修改协议，避免添加流程隐式破坏旧状态。目标位置与追加 renderOrder 沿用既有 install 默认规则；其他实例、坐标、顺序、业务记录和 state 不变。

`cancel` 幂等、无写入；`invalidate` 取消 pending/在途 prepare；后来的 prepare 使旧请求失效；`dispose` 退订并永久关闭。owner 的项目/授权通知同步淘汰旧票据，confirm 仍重验快照与授权，防止漏通知。

## B. 正式 UI 接线方案（本 PR 未应用）

当前 CustomBlockImport 可直接读取 `importFile` JSON，已经通过现有 owner.install 确认。新的生成结果 UI 如要复用受控票据，应由主集成人在独立验收后给导入控件增加显式输入/回调，复用同一个现有 session；不把导出包或生成完成自动视作用户确认。无需改 Workshop 核心来证明本模块协议。

建议 UI 步骤：已准入制品 → 宿主选择 instanceId/props → `prepare` → 展示预览 → 确认/取消 → 安装回执；并显示来源为存档真实模型还是固定 Mock。禁止将错误响应降级成 Mock 成功。服务端导出若未来暴露为 HTTP，必须另行审核认证、项目 ACL、私有制品访问和响应限制；当前不提供公网传输。

宿主切项目、换 runtime/session 或销毁前，必须在**同步事件入口**先调用 `invalidate()` / `dispose()`，成功后才能切换宿主状态。确认等待中这些方法及 cancel/prepare 返回 `CONFIRM_BUSY`，必须延迟实际切换直到 Promise 结算；不能先切项目再通过 React effect 清理。确认前的异步读取期间可以 invalidate，在途结果会被丢弃。确认中的权限或业务修改仍可发生，由最终 CAS 拒绝旧安装。当前 session.install 无最终宿主项目回调；若产品要求确认期间随意离开且撤销已提交意图，需要后续原子接口，不能由 effect 补偿。普通 B 模式选择变化不改变“新增实例”目标；本接口不修改选中积木。

错误处理分两层：prepare/生命周期拒绝抛异常（例如 `CONTEXT_CHANGED`、`TICKET_NOT_PENDING`、`CONFIRM_BUSY`）；install 业务拒绝返回 `RuntimeResult.ok=false`。两类都要展示失败；Promise resolve 不代表成功。未使用票据、取消票据及控制器会话内记录应随项目生命周期释放。

## C. 真实制品离线结果

测试 fixture 是此前存档的真实 DeepSeek pending record 的原字节副本，仅含制品与来源元数据；不含 API key、HTTP envelope、私有授权或业务记录。历史来源取自既有交接包，本轮没有重新验证在线模型生成。

- definitionId：`accept-pomodoro-20261018`
- versionDigest：`sha256:d0a7d25b581048dfaf07bd8cafce09191eb02e9932ff90ac3e327782852d35fa`
- requestId：`accept-20261018-pomodoro-02`；provenance.kind：`deepseek`
- 入口：`src/Pomodoro.tsx`；props：`{initialMinutes:25,title:'真实制品离线安装'}`。
- record 文件 SHA-256：`c20f74f0ef3c92824f817cce10f1a24c9266174502129d4b705f0f2185f386c1`。

验收调用真实 private store put/inspect、真实协议重算摘要、真实 session.install/CAS 和现有 B/C metadata adapter。预览不写项目；确认仅追加目标实例，既有 sibling/state、builtin 数据、坐标和顺序逐字段比对不变；B adapter 可读到精确 Manifest，视图不含源码。Viewer observation 仍为 pending-build；未创建 iframe、未向工具链传入候选源码，没有 import/eval 或执行。该番茄钟保留原非空 stateSchema，未为兼容 ZIP/Viewer 清空或改写。

本 PR 不称“番茄钟功能已验证可用”。生成来源、格式准入、安装成功、编译通过和安全运行是不同事实。详见 `generated-artifact-install-evidence.json` 的命令/统计/日志哈希。

## D. 提供给隔离 Viewer 的接口契约

这是本模块提供的交接契约，尚未与并行 Viewer 的实际实现联合验收；未修改或向其工作树写入文件。

1. 项目中只有 `{id,definitionId,versionDigest,props}`，无源码或 runnable 字段。通过现有 `session.registry.resolve({definitionId,versionDigest})` 精确读取 RegisteredArtifact，禁止 latest/仅 definitionId 查找。
2. 本模块只产生 `{reference,status:'pending-build'}` 显示观察，不发构建任务、CompiledArtifact、bundle URL 或 ExecutionPermit；`provenance.kind` 不得提升信任。
3. Viewer/受控构建负责人独立验收任意 AI 源码的安全准入、隔离执行、资源与网络限制及可撤销许可。即便未来构建成功，也不能由本安装器修改执行状态或导入主站。
4. 只读 Manifest/props 投影与源码边界保持原协议。当前 observation 不匹配、未知或声明 runnable 时，既有 viewerState fail closed。本 PR 无意覆盖另一 Agent 的 Viewer 策略。

## E. 尚未验收

- 正式生成结果 UI 到确认控件的浏览器交互、取消/切项目/双击与生命周期接线，尚未修改或运行该正式 UI。
- 新模型请求、用户真实授权/付费流程、模型输出质量与功能正确性未重验；新增付费请求为 0。
- 隔离 Viewer、原 TSX 构建/运行、计时器与按钮功能、C 模式可运行、ZIP profile 兼容性未验收。
- HTTP 制品传输/ACL、跨刷新项目持久化/历史恢复不在本 PR 内。

本轮测试使用既有依赖，无 npm install；可信仓库协议的 TypeScript 转译与生产应用构建不包含 JSON 内的 AI TSX。无自动合并、部署或付费 API。
