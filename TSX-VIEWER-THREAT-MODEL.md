# TSX Viewer 安全威胁模型

2026-10-19；已实时核对 `main = b56a26a9803718d806bac3ddbd7fbe19e0c495c6`；PR #43 远端 head = `2a7688480d1859c87762b46224b6ec81fe28d370`；本轮受测代码 head = `df8a5f91341ffb936400488375e30cc6c8e14b82`，位于独立分支 `phase2/pr43-compile-isolation`。PR #40 本轮远端 head 仍为 `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`。本文不代表正式 C 模式已经放行。

本文取代远端分支早期 `5b5ed00` 的初始状态报告，并保留其信任边界与 launch gates；新增内容只反映本分支实际实现和已执行的真实 Chromium 测试。

## 1. 结论

本分支把 TSX 运行拆成三层：

1. 宿主只提交已验证的 `SourceArtifact` 和实例 props，不执行模型源码。
2. 专用编译子进程只做语法/导入准入和打包，不运行用户组件；它启动的 esbuild 服务进程也属于可终止、可验证的进程树。
3. 运行发生在独立源站的 `sandbox="allow-scripts"`（无 `allow-same-origin`）iframe 内；iframe 使用严格 CSP、credentialless、运行时能力屏蔽和一次性 MessageChannel。

正式 C 模式仍保持 `unavailable`。实验 Viewer 默认关闭，未接入 `AppSpecWorkshop` 或 `CustomBlockViewer`。只有独立验收和安全负责人放行后，才允许把该模块接到正式 C 模式。

## 2. 范围与非目标

### 范围内

- 宿主 DOM、Cookie、LocalStorage、IndexedDB、认证信息和宿主网络能力的隔离。
- TSX 源码准入、依赖白名单、编译、打包、缓存、错误边界和生命周期。
- iframe sandbox、CSP、跨源部署、postMessage/MessageChannel 协议。
- 恶意组件、恶意依赖、消息伪造、非法协议、渲染异常、资源耗尽和外部网络外传。
- 真实 Chromium 中的交互验证与可复现测试。

### 非目标

- 不证明浏览器或原生解析器没有 0-day。
- 不提供任意文件系统访问、宿主数据库写入、宿主认证代理或跨源业务桥接。
- 不把“编译成功”当作“业务正确”“模型质量合格”或“正式 C 模式已验收”。
- 不在本分支实现正式付费模型调用。

## 3. 现有系统审计

### 3.1 Viewer unavailable 策略

- `src/integrations/custom-block-bc/viewer.ts:22` 在缺少匹配 observation 时返回 `status: 'unavailable'`，文案明确“当前没有经过验证并接线的隔离 Viewer”。
- `src/integrations/custom-block-bc/CustomBlockViewer.tsx` 只有占位 UI；没有 iframe、`srcdoc`、源码 URL、动态 module 或生成组件槽位。
- 现有 `tests/generated-artifact-ui/browser.cjs` 断言 C 模式不存在 iframe、动态脚本和可执行组件。

### 3.2 Artifact Installer

- `src/integrations/generated-artifact/install.ts` 使用一次性 ticket、preview/confirm、CAS 和 project session 绑定。
- `resolveArtifact` 会重算内容摘要；预览不写入，确认才通过唯一 owner 写入。
- 生成制品要求 `requestedCapabilities` 和 `events` 为空；安装成功文案仍是 `pending-build`，不宣称可执行。
- 安装层是数据准入层，不是执行授权层。

### 3.3 TSX 源码存储

- `SourceArtifact` 是惰性数据：`manifest + sources + dependencies + build`。
- `server/custom-block/store.mjs` 使用私有目录、文件大小上限和 UTF-8 严格解码；不把源码写成可执行 JS/TS 文件。
- 源码不会在安装、预览或 metadata 投影中导入、`eval` 或挂载。

### 3.4 编译入口

- 既有的 `server/custom-block/build-protocol.mjs` 只编译可信协议模块，不接受源码路径。
- 本分支新增 `server/safe-viewer/compile.mjs`、`compile-child.mjs`。宿主通过 IPC 启动专用 Node 子进程，子进程再启动 `esbuild-wasm` 的独立服务进程。
- 编译子进程只继承运行所需的路径/临时目录环境变量，不继承 `DEEPSEEK_API_KEY` 或其他宿主秘密；宿主通过 `versionDigest`、固定源码集合、导入白名单、大小/复杂度限制和 5 秒超时约束输入。
- 成功或编译错误时，编译子进程先调用 esbuild `stop()` 并等待其服务进程退出，再发送结果。超时、取消、崩溃或 `dispose()` 时，宿主等待根进程退出，并检查已报告的所有 esbuild PID 都已消失；无法证明终止时返回 `COMPILER_TERMINATION_FAILED`，不继续复用该编译状态。
- 编译入口没有接入正式 HTTP 路由；测试服务器是独立实验宿主。

### 3.5 import 与依赖机制

- `server/custom-block/import-policy.mjs` 做语法准入、相对路径解析、动态 import/`require`/`eval`/`Function`/Worker/WebAssembly 等拒绝。
- 本分支进一步把 Viewer 允许的裸包收窄为 `react` 和 `react/jsx-runtime`；相对导入只能落在制品自身的源码集合内。
- React、React DOM 和 esbuild-wasm 使用仓库内固定版本；esbuild 版本 0.25.12，与既有 Artifact 策略一致。
- 不访问 npm registry；编译只从本地 `node_modules` 读取包内容。

### 3.6 C 模式

- 正式 C 模式没有导入 `src/integrations/safe-viewer`。
- `CustomBlockViewer` 和 `viewerState` 未修改。
- 本分支的 `SafeTsxViewer.tsx` 是独立实验组件，不进入正式页面树。

### 3.7 原有 CSP / iframe / 跨源状态

- 原有正式 C 模式没有运行 iframe，因此之前没有可依赖的运行沙箱。
- 本分支新增的 runner 响应使用：

```text
sandbox allow-scripts
default-src 'none'
script-src 'self' 'nonce-<per-response-nonce>'
style-src 'self' 'unsafe-inline'
img-src data:
connect-src 'none'
font-src 'none'
media-src 'none'
object-src 'none'
frame-src 'none'
child-src 'none'
worker-src 'none'
manifest-src 'none'
base-uri 'none'
form-action 'none'
frame-ancestors <exact-parent-origin>
```

- iframe 属性为 `sandbox="allow-scripts"`、`credentialless`、`referrerpolicy="no-referrer"`；没有 `allow-same-origin`、`allow-forms`、`allow-popups` 或顶层导航权限。
- runner 使用独立源站池（测试中为 `127.0.0.2` 到 `127.0.0.7`），宿主为 `127.0.0.1`。生产必须使用专用的 Viewer 源站或源站池，不能仅用同主机不同端口伪装隔离。

跨源隔离说明：runner 文档设置 `Cross-Origin-Opener-Policy: same-origin` 和 `Origin-Agent-Cluster: ?1`，并使用不同站点/不透明 sandbox 源。由于 runner 必须被宿主嵌入，本分支没有在宿主上强制 `Cross-Origin-Embedder-Policy`，因此不宣称完整的 COOP+COEP “cross-origin isolated”上下文；实际保证是跨源 iframe + sandbox + 独立源站/进程池，并由真实 Chromium 的宿主响应性测试验证。生产部署应优先使用独立站点，而不是同一站点下的不同端口。

### 3.8 postMessage 与运行时边界

- 宿主 `client.ts` 检查 `event.source === iframe.contentWindow`、`event.origin === 'null'`、session、nonce、协议、精确字段和消息大小。
- 通过一次性 `MessageChannel` 传递后续消息；端口是能力，消息仍校验 session/nonce/seq/type/字段。
- 运行器只接收 props；不接受认证 token、cookie、宿主 DOM 句柄、文件句柄或业务写能力。
- 运行时在加载用户组件前屏蔽网络 API、存储 API、Worker、WebSocket、WebRTC、`eval`/`Function`、`postMessage`、`parent`/`top`/`opener` 等；并对计时器做清理跟踪。

## 4. 信任边界

| 边界 | 可信侧 | 不可信侧 | 结论 |
| --- | --- | --- | --- |
| 宿主页面 | 宿主 UI、session、Cookie、LocalStorage、网络监听 | 生成 TSX、props、消息内容 | 模型代码不得进入宿主 JS 上下文 |
| 编译服务 | 协议校验、导入准入、专用编译子进程 | 源码、manifest、props、esbuild 服务进程 | 编译成功不等于执行授权；超时必须终止并验证整棵进程树 |
| runner 文档 | runner runtime、CSP、sandbox | bundle 内的用户组件 | 运行在独立源站、不透明源、无宿主凭据 |
| 消息通道 | 宿主 controller、一次性 MessageChannel | iframe 内消息 | 来源、目标、session、nonce、seq、结构均校验 |
| 部署 | 专用 Viewer 源站、证书、进程/源站池 | 浏览器进程调度和同源复用 | 需要独立部署与监控；死循环源站要退役 |

## 5. 威胁与控制

| ID | 威胁 | 影响 | 控制 | 验证 | 残余风险 |
| --- | --- | --- | --- | --- | --- |
| T1 | 模型代码访问宿主 DOM | 读取宿主页面、伪造 UI、窃取数据 | 不透明 sandbox 源 + 跨源 iframe + 无 `allow-same-origin`；运行时屏蔽 `parent/top/opener` | 攻击夹具读取父 DOM 得到 `SafeViewerCapabilityError`；iframe HTML 不含宿主 secret | 浏览器 sandbox 0-day |
| T2 | 读取宿主 Cookie/LocalStorage/认证 | 账号接管、数据泄露 | 独立源站 + `credentialless` + 不透明源 + 运行时存储 getter 屏蔽 | 宿主设置 cookie/localStorage；iframe 读取被拒绝；runner 请求无 Cookie | 同站部署配置错误会削弱隔离 |
| T3 | 外部网络外传 | 数据泄露、回连 C2 | `connect-src 'none'`、`img-src data:`、`font/media/frame/worker-src 'none'`；fetch/WebSocket/beacon/WebRTC 运行时屏蔽 | 外部图片请求被 CSP 拦截，记录为 `error: csp`；无外部响应；fetch/ws/beacon 抛 `SafeViewerCapabilityError` | 浏览器漏洞、导航型外传（见 T12） |
| T4 | 恶意依赖 | 供应链执行、隐藏后门 | 裸包白名单仅 React；锁定版本；本地打包；不访问 registry；源码 digest 重算 | `node:fs`、`react-dom` 等导入被 `IMPORT_REJECTED`；工具链版本不匹配会失败 | 锁定包本身可能有漏洞 |
| T5 | 资源耗尽/死循环 | 阻塞宿主、拖垮 Viewer 源站 | 跨源 OOPIF + 源站池；3 秒 boot watchdog；remove iframe；编译子进程 128MB/5 秒；源/包体/缓存上限；超时源站 quarantine | Chromium 中死循环 iframe 被移除，宿主 ping 耗时 1–2ms，状态为 `RUNTIME_TIMEOUT`；源站进入 quarantine | 源站池可被反复耗尽；需要容量监控和重置策略 |
| T6 | 伪造 postMessage | 伪造 ready/error、注入状态 | source/origin/session/nonce/seq/精确字段/大小；后续使用一次性 MessageChannel | 从宿主窗口伪造 ready/boot，rejected 计数增加，accepted 不变，仍为 ready | 同源 runner 进程内的恶意 bundle 可发合法形状消息，但只有自己会话能力 |
| T7 | 非法协议/导入/摘要 | 绕过准入、加载非预期代码 | 精确协议、digest 重算、事件/能力为空、导入白名单、bundle 上限、源能力 denylist | `INVALID_PROTOCOL`、`IMPORT_REJECTED`、`SOURCE_CAPABILITY_REJECTED`、`DIGEST_MISMATCH`、`BUNDLE_LIMIT` 均被测试 | 静态扫描可被动态字符串绕过；运行时/CSP 兜底 |
| T8 | 渲染异常 | 白屏、错误扩散 | React ErrorBoundary、`onUncaughtError`、`onCaughtError`、父级 watchdog、remove iframe | 渲染错误夹具返回 `RENDER_ERROR`；宿主继续响应 | 极端 React/浏览器崩溃 |
| T9 | 编译期 DoS | CPU/内存耗尽、请求堆积 | 专用子进程、128MB old generation、5 秒超时、Windows `taskkill /T /F`/POSIX 进程组终止、并发上限、请求体上限、源复杂度限制、缓存 | 450ms 超时用例在 esbuild 启动后触发；`compile PID` 与 `esbuild PID` 均退出；宿主事件循环保持响应；后续合法编译成功；连续 3 轮进程级测试通过 | Windows 依赖 `taskkill`；若系统拒绝终止，服务返回 `COMPILER_TERMINATION_FAILED` 并失败关闭；esbuild/WASM runtime 漏洞仍不可消除 |
| T10 | 供应链/缓存投毒 | 执行非预期 bundle | 内容摘要、版本化缓存 key、session 绑定 bundle、Host+session 校验、ACAO 仅限代码资源 | 第二次编译 `cache: hit`；bundle 摘要与内容一致；错误 session/Host 被拒 | 服务器被攻破时无法保护 |
| T11 | 点击劫持/嵌入 | 诱导宿主用户操作 | `frame-ancestors` 精确父源；CSP sandbox；host CSP `frame-src` 仅列出 runner 源站 | runner 响应头断言通过；host 只能嵌入配置的 runner | 部署 CSP 配置错误 |
| T12 | 导航/弹窗 | 离开宿主、钓鱼、参数外传 | 无 `allow-top-navigation`/`allow-popups`/`allow-forms`；`form-action/base-uri 'none'`；运行时 `open/location/postMessage` 屏蔽 | `target="_top"` 点击后宿主 URL 不变；控制台显示 sandbox 阻止 | 计算属性 `location` 的 self-navigation 仍可能发生；不携带宿主秘密 |
| T13 | 宿主认证凭据泄露 | 会话劫持 | `credentialless`、独立 host、不向 iframe 发送 token、不提供宿主 fetch 代理 | runner 请求 Cookie 头计数为 0；iframe 读取宿主 storage/cookie 失败 | 部署在共享父域时需额外审计 |
| T14 | 错误/日志泄露 | 源码、路径、内部信息外泄 | 父级只显示错误码和通用文案；错误 payload 有长度上限；不返回堆栈 | 页面无未处理异常；错误夹具只暴露 `RENDER_ERROR` | 浏览器控制台仍可能看到组件自身错误文本 |
| T15 | 浏览器/沙箱逃逸 | 完全突破隔离 | 最小 sandbox、严格 CSP、独立源站、credentialless、Origin-Agent-Cluster/COOP、kill switch | 仅 Chromium 验证；不声称跨浏览器证明 | 任何浏览器 0-day 都可能突破；必须独立安全评审 |
| T16 | 源站复用污染 | 前一个死循环拖死后续会话 | 每次编译从健康源站池选择；`RUNTIME_TIMEOUT` 后调用 retire/quarantine，不复用该源站 | 死循环后源站进入 quarantined；后续 attack 在另一源站 ready | 池耗尽会返回 `RUNNER_CAPACITY`，需要运维重置 |
| T17 | 会话/包猜测 | 未授权加载 runner | 192-bit 随机 session/nonce、60 秒 TTL、bundle digest、Host/session 绑定、frame-ancestors | 无效 session 返回 `SESSION_EXPIRED`；错误 Host 返回 `ORIGIN_REJECTED` | 同源宿主被攻破时无法保护 |
| T18 | 跨会话数据持久化 | 数据残留 | 不透明源、无 cookie、runner 不提供存储 API；每次会话短生命周期 | iframe 存储访问失败 | 浏览器进程内存可能短暂残留，需进程回收策略 |

## 6. 消息协议

### 6.1 启动握手

1. runner bundle 读取自身 HTML 的 `parentOrigin/session/nonce`。
2. runner 向 `window.parent` 发送 `boot`，目标 origin 为精确父源。
3. 宿主校验 `event.source` 是当前 iframe、`event.origin === 'null'`（不透明 sandbox 源）、session/nonce/协议/字段。
4. 宿主创建一次性 `MessageChannel`，把 `port2` 随 `init` 发送给 iframe；`init` 只含 session/nonce/props，不含凭据。
5. runtime 在硬化环境后惰性加载用户组件；提交后通过 `port1` 发送 `ready`。
6. 错误或 `dispose` 通过同一端口传递；父级移除 iframe 并清理监听器。

### 6.2 校验规则

- 只接受精确字段集合；未知字段、缺失字段、超长字符串、超深对象、非法 seq 全部拒绝。
- `ready` 只接受一次；`error` 只接受运行时产生的形状；重复/过期消息被拒绝。
- 父级对 boot 使用 source + origin + session + nonce；对端口消息使用端口能力 + session + nonce + seq。
- 由于 sandbox 无同源权限，iframe 的 origin 序列化为 `null`；init 的目标 origin 使用 `*`，但 init 不含任何宿主秘密，且必须先通过 boot 的 nonce 校验。

## 7. 资源限制

| 资源 | 限制 |
| --- | --- |
| 请求体 | 512 KiB |
| 源文件 | 8 个，单文件 64 KiB，总计 256 KiB |
| 源 token/嵌套 | 24,000 / 96 |
| bundle | 512 KiB |
| 编译 | 5 秒，2 并发，专用子进程 128 MB old generation；超时终止整棵进程树 |
| 缓存 | 32 条 / 8 MiB LRU |
| session | 64 个，60 秒 TTL |
| boot watchdog | 默认 5 秒；测试 3 秒 |
| 消息 | 16 KiB，字符串 1 KiB |

## 8. 已执行的验证

- 服务端：`npm run test:safe-viewer`，12/12 通过，覆盖摘要、导入、静态能力、包体、请求体、session、Host、禁用开关和编译超时。
- 进程级：`node --test tests/safe-viewer/compiler-process.test.mjs`，6/6 通过，连续 3 轮均通过。每轮验证成功、编译错误、取消、超时、重复编译和 `dispose()` 后 `compile PID`/`esbuild PID` 均退出，`compiler.stats().processes === 0`。
- 浏览器：`npm run test:safe-viewer:browser`，真实 Chromium 153.0.8010.12，14/14 场景通过。
- 构建：`npm run build` 通过；原有默认测试 `npm test` 194/194 通过。
- 证据：[`docs/acceptance/safe-viewer/browser-report.json`](docs/acceptance/safe-viewer/browser-report.json)。
- 关键证据：死循环时宿主 ping 约 1–2ms；外部图片请求被 CSP 拦截且无外部响应；runner Cookie 头为 0；伪造消息 rejected 计数增加；死循环源站进入 quarantine。

## 9. 残余风险与放行条件

必须保留的残余风险：

- 只在 Chromium 验证；Firefox/Safari 未验收。
- Chromium 日志提示 `Origin-Agent-Cluster` 在已 site-keyed 的源上未能 origin-key；测试通过独立 IP 源站池和源站退役获得宿主响应，但生产必须部署专用源站并监控进程隔离。
- sandbox 的 self-navigation 不能由 CSP `navigate-to` 在所有浏览器中可靠禁止；顶层导航已由 sandbox 阻断，且 iframe 不持有宿主秘密。
- CSS/data URI/大量 DOM 仍可能消耗 Viewer 进程资源；需要进程级限额和容量监控。
- 编译器和浏览器漏洞不能由应用层完全消除。
- 源站池可被反复死循环耗尽；`RUNNER_CAPACITY` 必须有运维告警和显式重置流程。

正式 C 模式放行前必须完成：

1. 独立安全评审确认本分支精确提交、部署 headers、源站池和证书配置。
2. 至少 Chromium 外的目标浏览器完成真实交互与死循环测试。
3. AI Core 和 Workshop 负责人签署 Artifact → Viewer 与 UI 状态契约。
4. 生产监控覆盖 `RUNTIME_TIMEOUT`、`RUNNER_CAPACITY`、CSP 违规、外传尝试和源站 quarantine。
5. 保留 `enabled=false` kill switch；任何异常默认回到 `unavailable`，不得静默降级到宿主执行。
