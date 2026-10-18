# AI 代码积木：离线制品正式 B 模式接线

基线为 `main@7e94dc9568501dd4ad218a43b5aca31026aed2b2`。本轮只完成“已取得的源码制品 → B 模式预览 → 用户确认 → 添加积木”，不代表新模型生成、源码编译或 C 模式运行成功。真实 DeepSeek 仅为历史存档来源，本轮付费调用为 0。

## 用户入口

在现有 `/ai-create` Workshop 的 B 模式展开“导入自定义积木”，将“导入方式”选为“AI 代码积木 · 仅新增”，选择既有 `exportPendingInstall` 输出 JSON 或原 `{instance, artifact}` 文件。页面先显示文件声明的名称、精确版本、参数和来源，用户点击“预览添加”才运行完整制品校验；通过后明确显示 `pending-build · 尚未构建，暂不可运行`。取消不添加；点击“确认添加”才调用 #34 安装器。文件声明来源始终不构成安全证明或授权。

成功后原 Canvas 订阅立即显示新卡片，复用选择/拖动和 Inspector 参数编辑；C 模式原有占位器显示 unavailable，不加载 AI 组件。原手动导入的添加与明确换版路径、清除旧版本状态的警告保留，同一文件输入不复制。新 AI 路径拒绝已有 ID，不隐式换版。

原始归档制品：`accept-pomodoro-20261018`，精确摘要 `sha256:d0a7d25b581048dfaf07bd8cafce09191eb02e9932ff90ac3e327782852d35fa`。验收 helper 从原 JSON 经 `createPendingStore.put/inspect` 和 `exportPendingInstall` 生成安装包，临时私有目录最终删除；fixture 字节不变。安装包、录屏、截图与 trace 已归档到本机 `/Users/nanmuxun/BlockAI/reports/p1b-generated-artifact-ui/`，文件哈希见机器证据。

## 接口与生命周期

`createGeneratedArtifactUI(existingSession)` 仅持有文件草稿、显示状态、请求代际和原 GeneratedArtifactInstaller。构造时不订阅/写项目；首次读文件时才创建原安装器。没有第二个 owner、项目存储、CAS 或源码执行通道。

- `readFile(File)`：限长、JSON 安全检查、读取原文件或 export 封装；异步读取前捕获当前项目/授权，迟到结果丢弃。
- `prepare()`：调用原 `installer.prepare`，不登记 registry、不写项目；完整 Manifest/SourceArtifact/摘要/参数验证仍由原协议负责。
- `confirm()`：首个 await 前同步置为 confirming；重复确认忽略。只调用原 `installer.confirm → session.install → CAS`，不重试冲突。
- `cancel()`、`beforeContextChange()`、`dispose()`：首先同步检查确认锁；CONFIRM_BUSY 时抛错，调用方必须保留宿主状态。成功切换取消未提交预览；dispose 退订，StrictMode 的空 effect 重放可 activate。

AiCreate 持有当前应用的同一个 binding：在重新生成请求前检查，在异步结果返回后再次检查；通过后才创建新 Runtime、释放旧 binding 和 setApp。没有 React state updater 内的副作用，CONFIRM_BUSY 时不分配替换 Runtime、不 setApp。

Workshop 的 B/C 按钮在原 host.setMode 前同步检查。`useInstallLifecycle` 注册 document capture 的同页导航拦截和 beforeunload：确认中在事件处理栈内 preventDefault；这是提前注册的同步 handler，不是 React effect 事后取消。effect cleanup 仅释放资源，不承担门禁。Mochi Host 的创建/销毁及内部逻辑未修改。

未来其他父级更换 runtime 或主动 root.unmount，也必须先在同一个事件栈内调用 `binding.dispose()` / `beforeContextChange()`，成功后才执行 setter/unmount。测试延迟原 session.install，验证这些受控入口在卸载前收到 CONFIRM_BUSY。React 无法否决外部直接强制 root.unmount；操作系统终止、用户强制离开页面也不属于可保证的取消。当前生产入口只有 AiCreate，已在其替换点门禁；未来新增宿主必须遵守此契约，不得照抄 cleanup 作为拦截。

## 实际改动范围

生产已有文件只修改授权的三处：

- `src/integrations/custom-block-bc/CustomBlockImport.tsx`：原输入增加导入意图、AI 预览/取消/确认展示。
- `src/components/app-builder/AppSpecWorkshop.tsx`：传递 binding、调用方 B/C 门禁、复用原导入控件。
- `src/components/ai-create/AiCreate.tsx`：持有 binding，门禁异步项目替换。

新增 UI 支持仅 `ui.ts`、`ui.css`、`useInstallLifecycle.ts`。新增四个验收/离线 helper 文件在 `tests/generated-artifact-ui/`。既有浏览器测试仅调整 Workshop 可选独立端口，以及 Mochi 独立 Vite 夹具加载 #31 已有默认关闭导出插件；断言不削弱，ZIP 实现未改。

SourceArtifact 协议、原 installer、生成器/Provider/store、唯一 session/owner/CAS、Mochi Host、#31 ZIP 导出、编译器和 Viewer 均无差异。未新增 HTTP、模型入口、授权开关、依赖、项目持久化或运行权限；未修改其他工作树或停止其进程。

## 测试证据

| 检查 | 结果 |
| --- | --- |
| 新 UI/component/controller | 9/9 |
| #34 安装器 | 12/12 |
| CustomBlock/owner/Workshop/Host/source-plan/UI 组合 | 335/335，含上述 21 项 |
| npm test | 192/192 |
| 原生成器/Provider/store 离线回归 | 82/82 |
| Mochi AI | 40/40 |
| npm --prefix server test（含服务端构建） | 23/23 |
| #31 Workshop/ZIP 回归 | 70/70 |
| npx tsc --noEmit、npm run build、git diff --check | PASS |

Chromium 151.0.7922.34，1366/390 视口实际执行：

- 普通 `/ai-create` 页面：无 transform、调试桥或替代 UI。原 AppSpec/status 请求固定为离线响应，完成导入→预览→取消→再次预览→确认→卡片选择/参数检查→C unavailable，每视口 10 项。
- 同一正式页面加测试专用原 session 方法装饰器：延迟原 install、只读调试观察；每视口 19 项。覆盖坏摘要、项目/授权失效、预览和取消零写入、双击一次安装、B/C/首页/重新生成/受控卸载同步门禁、beforeunload、已在途生成完成门禁、正常项目替换取消预览、拖动、旧实例/版本/state/非空业务记录/位置/顺序严格保留。
- 原 #31 导出、CustomBlock Workshop、独立 B/C 及 Mochi 浏览器回归均通过；涵盖原 CRUD、明确换版、Mochi 单一挂载、ZIP 下载校验、默认 dev/production 导出关闭及旧 Demo。

所有浏览器只使用已有 bundled Playwright/Chromium，无安装或下载。390 为移动视口/触摸模拟，不是实体手机。正常 UI 与延迟竞态各有两个视口的完整 webm 录屏，另有截图与竞态 trace。测试不编译/运行下载 ZIP 或 AI TSX。

复现新 UI 浏览器：先 `npm --prefix server run build`、`node server/custom-block/build-protocol.mjs`，设置已有 Playwright 的 NODE_PATH 后执行 `node tests/generated-artifact-ui/production-browser.cjs` 和 `node tests/generated-artifact-ui/browser.cjs`。默认端口分别 5299/5199，均 strict loopback；不要调用生成 Provider。原 Workshop 回归可设置 `CUSTOM_WORKSHOP_QA_PORT=5298`，不抢占其他 Agent 的固定端口。

最初聊天测试因新工作树缺少 server/.generated 文件失败，完成既有服务端构建后 40/40 通过；原 Workshop 端口占用后使用独立端口；原 Mochi 夹具缺少 #31 虚拟模块插件，补齐默认关闭插件后全通过。竞态验收促使替换 Runtime 的创建移至门禁之后，最终版本两套新 UI 浏览器均通过。不隐藏这些前置条件或将失败日志当作通过。

## 后续生成、安全边界与结论

自然语言 → pending-store → UI 的生产传输仍为 NO-GO：缺少可信生产认证、项目 ACL 与跨重启付费预算/审计。保留原人工付费门禁；本轮不编码任何新模型/制品 HTTP。可讨论的后续 local-demo adapter 必须生产硬关闭、显式命令启用、严格 loopback/Host/Origin、短期高熵会话/CSRF、项目/revision/reference 绑定和一次性领取；未获得单独批准前不实现。接口提案保留在 `generated-artifact-ui-plan.md` 第 5 节。

离线来源的在线真实性、实体移动设备、生产部署浏览器、刷新后的项目/历史恢复、完整模型质量、任意 TSX 运行/隔离 Viewer 联验均未验收。归档番茄钟有非空 stateSchema，安装不等于进入 #31 支持的 ZIP 执行/导出 profile；原 ZIP 规则继续拒绝不支持的协议，不降级放行。

建议 **GO：进入离线制品 B 模式功能的主线代码审核**，仅在 Tech Lead 批准后考虑合并。**NO-GO：实时生产模型传输、付费自动调用及 C 源码执行**。交付独立 Draft PR；未自动合并、部署或启用 Viewer。最终发布 HEAD 写在 PR 与本机 report.md，机器证据记录受测代码提交/源码哈希，避免自引用提交 SHA。
