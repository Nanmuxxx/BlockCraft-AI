# Workshop React 项目下载集成（王致远 / P0）

基线：`origin/main` `2c7c698`（#25、#26、#30 已合并）。独立分支：`codex/workshop-react-export-20261018`。目标：10 月 19 日可录屏；本轮没有合并、部署、模型调用或执行用户制品源码。

## 已交付

正式 `/ai-create` → `AppSpecWorkshop` 的 B/C 顶栏共用一个「导出 React 项目」按钮，保留奶油白、橘色、像素积木与 Mochi。提供处理中、成功发起下载、失败且不下载的反馈。旧学习 Demo 仍走原有入口，不承载第二套导出集成。

浏览器捕获唯一 `runtime.customProject.getSnapshot()` 返回的冻结 v2 快照，仅对该快照的 `definitionId + versionDigest` 去重、调用其 `registry.resolve` 并重新校验摘要。不会枚举历史 registry、选择 latest、读取其他项目、创建 owner、调用 CAS 或改变 revision。异步读取结束及完整下载响应到达后均检查快照对象身份；期间任何编辑或会话替换均拒绝过期下载，不自动重试拼接版本。只读写授权不代表不可读取；数据导出权限由下面的本机 capability 提供。

Node 边界只调用 #30 `exportProjectZip({ project, artifacts })`，没有复制 ZIP 算法。浏览器不 import Node 导出器、TypeScript parser 或打包算法。form/list/metric 和 `react-props-local-v1` CustomBlock 沿用 #30 范围；缺失/不匹配制品、宿主 state/events/capabilities、未知依赖等整体失败，成功响应头只在完整 ZIP 验证生成后发送。错误仅返回稳定错误码，不回传源码、记录、栈或任意异常消息。数据与源码只以文本处理，不安装/编译/执行 CustomBlock。

## 受控本机启动与手动操作

需要 Node.js >=22.16，现有项目依赖：

```powershell
npm ci --ignore-scripts
npm run dev:export
```

1. 只通过 `http://127.0.0.1:5173/ai-create` 打开正式创建页面。已有生成服务仍按原协议工作；本任务未调用它。不要改成 `localhost`、局域网地址或反向代理。
2. 进入自己的生成项目，在 B 模式拖动、选择积木并通过 Inspector 修改；切到 C 模式创建/编辑记录。
3. 点击顶栏「导出 React 项目」，保存 `blockcraft-project.zip`。B/C 均使用同一按钮与 owner。
4. ZIP 包含 `package.json`、`index.html`、`tsconfig.json`、`vite.config.ts`、`README.md`、`provenance.json`、React 源码与当前数据；纯内置工程 14 文件，Counter 混合工程 15 文件。`provenance.projectRevision` 与捕获的 owner revision 一致。导出包含用户当前记录及 props。
5. 如提示版本缺失、不匹配、协议不支持或项目已变化，检查制品/项目后重新导出。不会给出部分 ZIP。

为了在不调用模型的情况下复现完整验收（包括真实创建界面、编辑、下载），使用下节浏览器脚本。**仅生成 HTTP 响应使用固定离线样本；Node 导出与浏览器下载均为真实调用。** 任意导出源码的安装/构建/运行由用户审查后自行决定，本任务未执行它。

## 本机安全边界及公网部署阻塞

当前尚无可信服务端的用户身份、项目归属与项目读取 ACL，故**不能上线公网导出**。本轮交付不是云端项目授权实现，也不把客户端声明或只读标志当作云端读取凭据。

本机方案以单用户开发机为信任域：

- 仅 `npm run dev:export` 的 `local-export` dev 模式启用；必须显式监听 `127.0.0.1` 并固定端口，拒绝 wildcard/局域网 host、自动换端口及 HTTPS 代理设置。
- 每个 Vite 进程产生随机 256 bit capability，经本机同源虚拟模块送给 UI；POST 同时校验 socket 回环地址、精确 Host、Origin、Bearer capability。整个专用 dev surface 拒绝异源和错误 Host，关闭 CORS；能力不进入构建包、URL、日志或持久文件。
- 仅接受 `application/json`，拒绝压缩 body；流式 4,000,000 字节限额、30 秒请求超时、单个并发打包。浏览器有 45 秒超时和卸载取消。
- 不接收磁盘路径、URL、服务端 projectId 或 registry 回调；只打包当前页面显式送入的数据。无服务端项目仓库、跨项目查询、磁盘持久化、响应缓存或源代码执行。
- 普通 `npm run dev`、`npm run build`、`vite build --mode local-export`、生产 preview 均没有 capability/导出 handler。UI 显示尚未开放及授权阻塞原因。不要把专用 dev 服务暴露到公网、端口转发或共享给不可信本机进程；本地进程/同源应用代码属于本方案信任域。

开放公网前必须由可信服务验证登录身份与目标项目读取权限，从该授权项目的唯一持久 owner/精确 registry 读取数据，并将授权撤销、快照版本、限流/资源隔离、错误隐私与审计纳入服务端边界。不能直接复用本机随机 capability 为多用户 ACL，也不能用客户端上传的项目归属证明权限。本报告将这些列为上线阻塞，本轮没有提供匿名公网 endpoint。

## Mochi Agent 面板挂载约定

唯一主界面组合入口：`AppSpecWorkshop`。提供可选 `renderMochi(props: WorkshopMochiProps): ReactNode`，在既有 sidebar 的唯一 `[data-workshop-panel="mochi"]` 插槽中替换默认面板。props 为已有 `host`、`view`、Workshop `root` ref、`canvasReady`、`planningDisabledReason`。

Workshop 负责唯一 host 的创建/销毁以及 mode/selection/owner；面板消费现有上下文与 callbacks，通过自身 effect 清理订阅/取消请求，不创建 Runtime/CustomProject owner、不另挂一套 Canvas/Inspector、不借导出触发分析，不获得导出 capability。本轮仅增加类型与挂载接口，默认 `WorkshopMochi` 聊天逻辑未改写。此为可供 Mochi Agent 接入的代码契约，未擅自向其他聊天发送消息。

## 验证及证据

```powershell
npm test
npm run test:workshop-export
node --test tests/project-zip-export/export.test.mjs tests/custom-block/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block-workshop/*.test.cjs tests/mochi-ai/*.test.mjs src/integrations/mochi/host.test.cjs
node node_modules/typescript/bin/tsc -b --force
npm run build
# 使用已有 Playwright + Chromium；如位于外部目录，设置 NODE_PATH。
# 若浏览器版本目录不同，设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE 为已有 chrome.exe。
npm run test:workshop-export:browser
node tests/custom-block-workshop/browser.cjs
```

结果：主测试 158/158；CustomBlock/导出器/Mochi 集成 336/336；本轮导出 capture/HTTP/边界专项 9/9；强制 TypeScript 和生产构建通过。Windows 修复仅将 Mochi 内存编译测试路径双方用 `path.resolve` 规范化，消除 TS6053；没有改变聊天实现。`.gitattributes` 固定可信样本 LF，避免 Windows checkout CRLF 破坏既定 SHA-256，未放宽白名单或修改样本源码。

真实 Chromium 153，1366×900 桌面及 390×900 手机触控视口：正式路由创建、内置 Inspector 配置、CustomBlock 参数保存、B/C 轮转、form/list CRUD 与实时 metric；B/C 实际 ZIP 下载、CRC/central directory/文件集合、当前记录及精确制品绑定；重复导出 revision 不变；响应在途编辑后拒绝下载；不支持协议整体拒绝；普通 dev 和生产 preview 均显示部署阻塞且不能得到 ZIP。没有页面异常或非本机请求，paidCalls=0。

另复跑原 `tests/custom-block-workshop/browser.cjs`，桌面鼠标/手机 CDP 触控拖拽、布局保留、选中/Inspector、摘要拒绝、并发导入、版本 Schema 切换、CRUD、Mochi/Logo/字体、无水平溢出和旧 Demo 任务往返均通过。测试启动器只将 Playwright 的 executablePath 指向机器已有 Chromium，没有下载软件或执行制品。

证据：`docs/workshop-export-evidence/browser-report.json`、`regression-report.json`、`verification.json` 及六张桌面/手机 B/C/拒绝截图。下载 ZIP 留在 ignored `.cache/workshop-export-downloads/`，报告记录其 SHA-256 和完整文件清单；没有将项目 ZIP 打入网站 bundle。
