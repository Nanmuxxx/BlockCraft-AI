# CustomBlock v2：独立 B/C 适配层交付

状态：等待代码审核与主集成 Agent 接线。这里交付编辑器、可信宿主适配边界和运行占位容器；没有交付 AI 生成器、编译器、执行后端或可运行的 AI 组件。

## 基线与目录

2026-10-18 开工通过 GitHub connector 确认 main 为 `c039fe9533a868425a493ed7d581774aa042a20f`，PR [#19](https://github.com/Nanmuxxx/BlockCraft-AI/pull/19) 已合并。已读取 `docs/custom-block-architecture.md` 与 `src/custom-block/` 的 Phase 1A v2 协议。项目 formatVersion 为 2；制品/manifest/message 各自版本仍按原协议，不能统称为 manifest v2。

授权发布轮复核：PR [#21](https://github.com/Nanmuxxx/BlockCraft-AI/pull/21) 已于 2026-10-18 09:28:38 UTC 合并；GitHub main 为 `78c3a7a9f323b5525fc362a610871d30c04c0311`。本独立分支从 `16cd342` 以 `git merge --ff-only` 无冲突快进到该实际 main；保留既有历史，没有 rebase、reset、clean 或 force push。通过 GitHub Git Data 读取并按 SHA 校验导入缺失的签名 merge commit；没有复制其他工作区未提交内容。

- Worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-custom-block-bc-adapter`
- 分支：`feature/custom-block-bc-adapter`
- 产品代码仅新增 `src/integrations/custom-block-bc/`；没有修改任何既有文件。
- 四个预留接线文件、旧 Demo、拖拽 hook、Runtime、Mochi、品牌资源、package/lockfile 均未修改。
- 本轮获得精确提交、非强制发布分支和独立 PR 授权；未调用付费 API，不合并、不部署、不接入生产 Workshop。命令行 HTTPS/SSH 均无可用认证，使用已连接 GitHub 的 Git Data 接口发布精确对象与非强制分支引用；不读取或导出凭据。

## 实际交付

| 文件 | 作用 |
| --- | --- |
| `src/integrations/custom-block-bc/adapter.ts` | 元数据准入；共享 owner 订阅；混合 renderOrder 投影；可信 props/layout 事务；整组移动合批。 |
| `CustomBlockCanvas.tsx` | 内置与自定义卡片、受控实例选择、原有 pointer/snap/collision/cancel 逻辑、拆组和整理。 |
| `CustomBlockInspector.tsx` | 根据固定版本 propsSchema 递归生成字段；本地草稿、显式保存、冲突后重新载入。 |
| `viewer.ts` | 只允许 pending-build / unavailable 的展示状态转换。 |
| `CustomBlockViewer.tsx` | 固定实例与制品引用的可信占位边框；按 renderOrder 组合内置单块插槽与自定义占位。 |
| `custom-block-bc.css`、`index.ts` | 局部奶油橘样式与公共导出。 |

Canvas 和 RunSurface 均读取同一个 `adapter.getSnapshot()` 的 renderOrder，不能将自定义积木统一追加到末尾。卡片身份使用实例 id；definitionId 相同的多个实例仍独立选中、保存参数与位置。全局实例 ID 唯一性由原 v2 解析器验证。

拖拽直接复用 `useSnapCanvas` 和 `snap-layout`，没有修改算法或原入口。临时拖动场景与拼接关系仍是原 hook 的 UI 状态；持久位置为 v2 的归一化坐标。一个手势产生的所有内置/自定义 onMove 回调在一个 microtask 内合并，一次 CAS 只增加一次项目 revision。拼接关系本身沿用原来的临时语义，刷新保存位置，不增加新的持久拼接协议。

## 唯一项目权威：必须由主集成提供

```ts
interface ProjectRevisionOwner {
  getSnapshot(): CustomProject
  subscribe(listener: () => void): () => void
  compareAndSwap(expectedSnapshot: CustomProject, nextProject: CustomProject): RuntimeResult
}
const adapter = await createCustomBlockBCAdapter(owner, registry)
```

这是依赖接口，**本包不实现生产 owner**。当前 main 的 `createAppRuntime` 仍只支持 v1。主集成必须扩展该会话或提供独占 v2 事务的协调器，并让旧 AppRuntime API 成为该 owner 的受控视图。不能同时创建一个旧可写 Runtime 和一个 v2 可写 store 后互相同步；也不能把 `base` 转成独立可写 Runtime。

owner 合约：

1. getSnapshot 返回递归冻结、对象身份稳定的权威快照，禁止原地改动；成功提交才替换对象。
2. CAS 在同一原子操作中检查 expected 对象身份、当前 revision、next.revision 恰为当前 +1；不接受异步期间失效的快照。
3. 成功时冻结完整 v2、完成宿主持久化承诺并发布一次通知；失败不能部分写入、通知成功或覆盖后来的记录。
4. 记录、结构命令、布局、props、自定义 state、Mochi 确认、history/receipts 与恢复均归这一会话管理。props/layout 事务需要和原 Runtime 的 history 失效策略协调，防止旧全量 undo 覆盖后来数据。
5. 加载/恢复/生成新实例均先用 `parseCustomProject` 与精确 registry 验证，再进入 owner；持久化整份 v2，禁止有损 v1 导出。

adapter 本身没有项目副本、可写 revision、listener 集合、存储或业务 Runtime。它只保留递归冻结的 manifest 缓存。创建时准入既有实例的精确版本；新的 definitionId/versionDigest 需要在同一 owner 上重新异步准入并替换 adapter，生命周期必须防止过期准入结果覆盖新结果。准入时项目变化会显式拒绝，不自动切换 latest。

所有 props/layout 请求在可信宿主中接受 `unknown`，校验普通 JSON、精确键、身份、baseRevision、固定 definitionId/versionDigest，再复制候选项目，调用实际 `parseCustomProject` 重验全部结构、props/state 和制品内容摘要，最后交给 owner CAS。异步校验前完成草稿复制；冲突不重试、不篡改 baseRevision。

Inspector 支持 string/number/integer/boolean/标量 enum/object，保留 enum 原始类型；可选字段可以启用或移除。启用时的值只是显式 UI 草稿，尚未保存，不是 Schema 默认值。保存不依赖 HTML min/max/required；缺失必填、非法范围、额外属性等由宿主拒绝。任何外部项目 revision 改变都会标记草稿过期；换实例或版本则重建编辑器。

## C 模式与 Agent B 依赖

当前没有正式 Viewer 挂载接口。`CustomBlockViewer` 不接受源码、URL、srcdoc、React 组件回调或 executionPermit。DOM 只包含可信文本与状态；没有 iframe、动态 import、eval 或生成源码执行路径。

容器绑定实例 id 与 `{definitionId, versionDigest}`，data 属性用于审计，不是安全凭据。`observationFor(instance)` 只提供展示观察值：

```ts
{ reference: { definitionId, versionDigest }, status: 'pending-build' }
```

只有精确匹配且字段合法的 pending-build 才显示“等待构建”。缺失、未知字段、错版本、伪造 runnable 等都显示 unavailable。观察值不是运行授权；source digest 合法也不是 bundle 已核验或沙箱有效的证明。真实 pending 观察值未来应来自可信制品/构建状态服务，不能由模型自报直接变成执行许可。

接线前需要 Agent B 提供经审核的正式协议与实际验证证据，至少明确：

- 接口版本、固定 source reference、输出 bundleDigest、工具链/依赖真实字节和构建证明；由可信控制平面核验的短期执行许可。`versionDigest` 不能替代 bundle 摘要。
- 独立执行进程/容器或 VM、无宿主源码执行、网络/CPU/内存/pids/deadline 等隔离实测及任务终止恢复；具体执行部分由 Agent B 交付。
- 独立跨站可信 Viewer origin、CSP/权限头与 iframe 限制，以及服务端受限画面流和输入的正式协议；不能把 AI bundle 直接载入本页、同源 iframe、blob/srcdoc 或普通 Worker。
- 宿主创建会话，绑定 project、instance、definitionId/versionDigest、viewer window/origin/port；凭据不交给生成进程。固定允许来源，不信任普通 JSON 的 trusted/runnable 字段。
- ready/加载/错误/超时/取消/卸载/换版/撤销语义；尺寸、焦点、键鼠/触摸/输入法、可访问性及裁剪边界。B/C 切换时挂载策略由正式协议决定。
- 复用 Phase 1A 消息结构并提供来源认证、方向/序号、重放/幂等、字节/速率限制、capability 授予和脱敏错误网关；任何 state/records 写入仍走唯一 owner 的 revision/CAS。manifest request 不自动成为权限。

等上述接口到位后再新增执行分支与浏览器隔离验收。当前代码没有预留一个可以任意传 URL/组件绕过上述门槛的 runnable 槽。

## 最终接线位置（本轮均未修改）

以下行号基于 main `78c3a7a`，已核对 #21 的 Mochi 单宿主生命周期。适配层没有生产入口，因此本轮没有改变其行为；最终接线需要同时解决下述语义依赖。

| 文件与锚点 | 主集成需要完成 |
| --- | --- |
| `src/components/ai-create/AiCreate.tsx:27`，`createAppRuntime(state)` | v2 应用加载处创建唯一 owner，完成 registry 准入；B/C 切换不能重建 owner。v1 与旧 Demo 保留原入口。此处不接本轮静态测试输入。 |
| `src/model/appRuntime.ts:37`，AppRuntime / `createAppRuntime:49` | 实现前述唯一 owner 及稳定只读 v1 视图，统一全部写路径、revision、history/receipts 和完整 v2 持久化；先完成这一依赖再接 UI。 |
| `src/components/app-builder/AppSpecWorkshop.tsx:15` / `MochiWorkshop:29`，Workshop 生命周期 | 接收同一 owner/adapter，订阅一份 v2；`:39` selectedId 合法集合扩展到 renderOrder；标题来自 base.spec，计数用 renderOrder.length。保留 `:17–23` effect 中唯一 Mochi host 的创建/清理、布局、Logo、像素猫和手机行为。 |
| 同文件 `:56`，`generated-blocks` | v2 槽挂载 `<CustomBlockCanvas adapter={adapter} selectedId={selected} onSelect={setSelectedId} />`；不要再嵌套另一个完整画布。 |
| `src/components/app-builder/AppSpecCanvas.tsx:15`，Canvas 入口 | 如需统一入口，在边界分流 v1 与上述 v2 画布；现有 hook、Demo 与 v1 行为保持。 |
| `src/components/app-builder/AppSpecInspector.tsx:25` 与 Workshop `:60`，侧栏 | custom 选中分支使用 `<CustomBlockInspector adapter={adapter} instanceId={selected} />`；builtin 分支使用同一 owner 的原 Inspector facade，不能把 custom id 送入内置结构命令。 |
| `src/components/app-renderer/AppRenderer.tsx:81`，`state.spec.blocks.map` | 先抽取可信“单个内置积木”渲染函数，再由 `<CustomBlockRunSurface adapter={adapter} renderBuiltin={...} observationFor={...} />` 按混合顺序调用。禁止把现有整个 AppRenderer 塞入 renderBuiltin，否则每个槽会重复全部内置积木。 |
| Workshop `:57`，`generated-preview` | 挂载混合 RunSurface；内置插槽从同一 owner 读取数据并通过其 facade dispatch，保持原表单/列表/统计交互。自定义继续占位，直至正式 Viewer 审核完成。 |

**#21 锚点与权限依赖：** `src/integrations/mochi/WorkshopMochi.tsx:18–19` 目前仅匹配 `module:${selectedBlockId}`；本画布使用 `builtin:id/custom:id`。主集成必须将选择/锚点映射与 custom 合法集合一起扩展，并保留 epoch、instanceId、revision 和卸载失效语义。当前 Mochi host 只认识内置积木，不能直接把 custom id 当作已有授权目标；需有正式适配后才启用 custom 修改计划。此处明确记录依赖，本轮不修改该既有文件。

Props 示例仅展示调用形状，不构成已完成产品接线。Mochi 对 custom 的 AI 修改计划、源码换版、权限确认和隔离预览均不在本包实现；不能套用仅面向内置结构的确认逻辑或把原始 props 保存误称为 Mochi 审核流程。

## 验证与复现

| 检查 | 结果 |
| --- | ---: |
| 新 adapter/Viewer/Inspector SSR 单测 | 35/35 |
| 原 Phase 1A 协议 | 137/137 |
| 最新 main 的 `npm test`（含 Runtime/拖拽/Mochi host/UI/planning） | 157/157 |
| Mochi host 独立复跑（已含于上行，不重复计数） | 24/24 |
| 合计独立用例 | 329/329，0 失败、0 跳过 |
| `tsc -b --force` + Vite 生产构建 | 通过 |
| 离线 Chromium | 1366×900 / 390×900，各 22 项断言组通过 |

```sh
node --test tests/custom-block-bc/*.test.cjs
node --test tests/custom-block/*.test.cjs
npm test
npm run test:mochi-host
./node_modules/.bin/tsc -b --force
npm run build
node tests/custom-block-bc/browser.check.cjs
```

本机 Node 在 `/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`，放入 PATH 即可。浏览器脚本使用本机 bundled Playwright；需要时设置 `NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`。未新增 npm 依赖或修改 lockfile。测试复用本机既有依赖；依赖目录不属于交付。

浏览器脚本自动启动/关闭本地 Vite `127.0.0.1:5194`，拦截并拒绝外网/API。验收覆盖选择、草稿不写入、带类型 enum、嵌套可选参数、宿主拒绝、过期草稿、真实 pointer 拖动/取消、实例独立、混合顺序、精确版本、两种占位、伪 runnable 拒绝、完整刷新恢复与无水平溢出；另以同宽 1800 高视窗检验两卡片碰撞、内置/自定义吸附、整组单 revision、拆组/整理单 revision、手势期间外部 revision 拒绝覆盖。

`tests/custom-block-bc/browser/main.tsx` 和 helpers 的 owner **仅供测试**。静态 manifest 明示“非 AI 生成”，源码为执行即抛错的惰性字符串；只校验其摘要，从不编译/执行。内置槽也明确标记为测试文本。不能拿这些画面宣称已跑通 DeepSeek 自创新功能或真实隔离交互。

证据在 `docs/custom-block-bc-audit/`：`browser-report.json` 与 desktop/mobile 的 B/C 四张截图，已逐张视觉检查；浏览器无外网请求、页面错误或资源错误。构建只包含原应用的可信代码；新增模块已被 TypeScript 检查、测试 harness 实际挂载，但尚未进入产品入口。原入口没有产品行为变化。

发布前复核：staged 精确 19 个新增文件，`git diff --cached --check` 通过；相对最新 main 四个预留接线文件均零差异。staged 文本未发现密钥，四张 PNG 仅为离线静态夹具截图；没有 dist、node_modules、缓存、浏览器 profile、日志或临时数据进入提交。测试日志保留在 `/tmp/blockcraft-bc-review-*.log`，不属于交付。

审核通过后由主集成 Agent 完成唯一 owner 与四处 UI 接线，再等待正式 Viewer；本轮停于 GitHub 独立代码审核。
