# Phase 2 Safe TSX Viewer 交付报告

2026-10-19

## 0. 本轮编译隔离复验

- 已实时核对 `main`：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`
- PR #43 远端 Draft head：`2a7688480d1859c87762b46224b6ec81fe28d370`
- 受测候选代码 head：`8eecb9399667e9ec03cb48fa2221d09251f111b5`
- 受测代码 tree：`c9a0d881f4806afec7e9860f31c36aaaca416dc9`
- 本地等价代码提交：`5e81b9024b39c86149340cae0491c4634f1d5cf0`，tree 与远端 head 相同
- 分支：`phase2/pr43-compile-isolation`；本轮 worktree：`F:\BlockCraft-AI\pr43-process-hardening`
- 起始代码基线：`2a7688480d1859c87762b46224b6ec81fe28d370`；本地修改前工作树干净
- 复验结果：`npm ci`、Safe Viewer 16/16、进程级 9/9（连续 3 轮）、真实 Chromium 14/14、原有测试 194/194、`npm run build` 全部通过
- 远端 head `8eecb93` 的 Docker acceptance run `39195580090` 成功；实际 Linux job 通过修改后的 `npm test` 执行了 Safe Viewer 测试

历史 `ae82597`/`753dfc5` 的浏览器和容器结果仍保留为历史证据，但不代表本候选 head 的编译子进程终止能力。

## 1. 基线与工作树

- 仓库：`Nanmuxxx/BlockCraft-AI`
- 基线 `main`：`25773e6d65e4e5a2b29d125baa2510f4a10aa343`
- 最新主线（本轮通知）：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`
- PR #40：Draft、未合入，HEAD `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`，当前 base ref 为 `main`
- 功能分支：`phase2/safe-tsx-viewer`（远端 PR #43）
- 本轮隔离分支：`phase2/pr43-compile-isolation`
- 本轮工作树：`F:\BlockCraft-AI\pr43-compile-isolation`

本分支以最新 `main` 为基线，没有把 PR #40 未合入的工件事务变更混入安全 Viewer 分支。PR #40 的 AI Core 契约作为接口参考读取。

远端同名分支此前已有 `c5e1758`（初始威胁模型）和 `5b5ed00`（初始状态报告）两个审计提交。本文保留其“未验证前禁止执行”的结论，并用本分支的实现、真实 Chromium 证据和剩余风险更新其状态；先前“未实现/未运行”的条目已被下文的实际测试结果取代。

## 2. 交付内容

### 2.1 安全服务端

- `server/safe-viewer/index.mjs`：编译/会话/runner/bundle/retire 路由；严格 Origin/Host/协议/摘要校验；runner 源站池和 quarantine。
- `server/safe-viewer/compile.mjs`：编译缓存、内容摘要、并发/超时、LRU 限制、子进程生命周期、进程树终止和 PID 存活验证。
- `server/safe-viewer/compile-child.mjs`：专用编译子进程中的 esbuild-wasm 打包；导入白名单；源/包体限制；用户组件惰性求值；成功后等待 esbuild 服务进程退出。
- `server/safe-viewer/source-policy.mjs`：在既有 `checkImports` 之上的静态能力 denylist 和 import 子集检查。
- `server/safe-viewer/policy.mjs`：CSP、Permissions-Policy、大小/时间限制、错误模型。
- `server/safe-viewer/assets/runtime-core.js`：iframe 内可信 runtime；CSP/sandbox 内的握手、硬化、ErrorBoundary、计时器清理和 dispose。

### 2.2 宿主实验客户端

- `src/integrations/safe-viewer/client.ts`：默认关闭的 controller；编译请求；iframe 属性；消息校验；watchdog；源站退役；状态机。
- `src/integrations/safe-viewer/SafeTsxViewer.tsx`：独立实验 UI 组件，未接入正式页面。
- `src/integrations/safe-viewer/index.ts`：实验模块导出。

### 2.3 测试与证据

- `tests/safe-viewer/server.test.mjs`：6 个服务端安全/边界测试。
- `tests/safe-viewer/browser.cjs`：真实 Chromium 交互、攻击、死循环、伪造消息、挂载/卸载、页面切换和缓存测试。
- `tests/safe-viewer/fixtures.mjs`：Counter、Todo、Pomodoro、渲染错误、死循环、静态/动态攻击、非法导入、包体超限夹具。
- `tests/safe-viewer/serve.mjs` + `host.html` + `host.js`：独立实验宿主，含宿主 DOM/Cookie/LocalStorage 和外部请求监听。
- `docs/acceptance/safe-viewer/browser-report.json`：本次真实运行报告。
- `docs/safe-viewer/INTERFACE-CONTRACT.md`：Artifact → Viewer 和 Viewer UI 状态契约。

## 3. 安全设计实现

1. 模型代码不在宿主 JS 上下文执行；正式 C 模式仍没有 iframe/动态模块。
2. 运行器不接收宿主认证凭据；iframe 使用独立源站、`credentialless`、不透明 sandbox 源。
3. 不提供文件系统 API、宿主 fetch 代理、业务写入桥或任意宿主能力。
4. CSP 禁止连接、字体、媒体、外部图片、子 frame、Worker 和 object；仅允许 data 图片和本源脚本。
5. 只允许 `react`、`react/jsx-runtime` 和制品内相对源码导入；动态 import、`require`、`eval`、`Function`、Worker、WebAssembly 等被拒绝。
6. boot 使用 source/origin/session/nonce；后续消息使用一次性 MessageChannel，并校验精确字段、seq 和大小。
7. 渲染错误由 ErrorBoundary/React root 错误回调捕获；父级 watchdog 处理死循环/模块加载挂起。
8. dispose 移除 iframe、关闭端口、移除宿主监听和 watchdog；运行器清理 root、计时器和动画帧。
9. `enabled` 默认 false；服务端禁用时返回 `VIEWER_DISABLED`，客户端不创建 iframe。
10. runner 源站池在 `RUNTIME_TIMEOUT` 后 quarantine；后续编译不再使用该源站。

## 4. 真实测试结果

### 4.1 服务端

命令：

```text
npm run test:safe-viewer
```

结果：16/16 通过。

覆盖：

- 有效制品编译、缓存命中、runner/bundle 内容摘要。
- 错误 Origin、Content-Type、协议、未知字段。
- digest、非法 import、静态危险能力、bundle 上限。
- 请求体上限、无效 session、错误 Host。
- 默认关闭和同 hostname 拒绝。
- 编译超时、宿主断开取消和进程树终止。

### 4.1.1 编译进程级验证

命令：

```text
node --test tests/safe-viewer/compiler-process.test.mjs
```

结果：连续 3 轮均为 9/9 通过。

覆盖：

- 成功编译后，`compile PID` 和 `esbuild PID` 均退出。
- 编译错误后，esbuild 进程退出；后续合法编译成功。
- 运行中取消会终止进程树，宿主事件循环保持响应，随后重试成功。
- 450ms 超时发生在 esbuild 启动后；返回 `COMPILE_TIMEOUT` 前已验证两个 PID 不再存活。
- 连续 3 个不同制品编译后无进程累积，`compiler.stats().processes === 0`。
- `dispose()` 会终止进行中的编译进程树。
- 编译子进程在 esbuild 启动后崩溃时，宿主按 PID、父 PID、启动时间身份直接清理孤儿服务进程。
- Windows `taskkill /T /F` 故障注入后，直接 PID 清理仍成功，随后合法编译可恢复。
- 已知进程清理失败时，编译器进入持久 `COMPILER_QUARANTINED`，后续编译不再启动新进程。
- PID 身份不匹配时拒绝终止，验证了 PID 复用下的防误杀行为。

### 4.2 浏览器

命令：

```text
npm run test:safe-viewer:browser
```

结果：14/14 通过；Chromium `153.0.8010.12`。

实际交互：

- Counter：真实点击、React state 增加/重置。
- Todo List：输入、添加、切换完成、删除。
- Pomodoro：开始、倒计时、暂停、重置。
- 渲染错误：返回 `RENDER_ERROR`，宿主继续响应。
- 死循环：iframe 被 watchdog 移除，宿主 ping 耗时约 2ms，状态 `RUNTIME_TIMEOUT`，源站被 quarantine。
- 宿主攻击：父 DOM、Cookie、LocalStorage、fetch、WebSocket、sendBeacon、window.open 均被拒绝；外部图片被 CSP 拦截。
- 伪造消息：从宿主窗口伪造 ready/boot，rejected 计数增加，accepted 不变。
- 非法输入：`INVALID_PROTOCOL`、`IMPORT_REJECTED`、`SOURCE_CAPABILITY_REJECTED`、`DIGEST_MISMATCH`、`BUNDLE_LIMIT`。
- 重复挂载/卸载 3 次后无 iframe、无宿主 message listener。
- 页面切换后只保留一个活动 runner。
- runner 响应含 strict CSP、`Origin-Agent-Cluster: ?1`，runner 请求无 Cookie。
- 缓存：6 个 bundle，16 次命中，6 次构建，无淘汰。

关键证据：

- `externalResponses: []`
- `blockedExternal: [{ "url": "https://example.test/pixel", "error": "csp" }]`
- `runnerRequestCookies: []`
- `pingDurationMs: 1`
- `quarantined: ["http://127.0.0.6:<port>"]`
- `runnerRetired: 1`

### 4.3 整体回归

```text
npm run build       # tsc -b && vite build，通过
npm test            # 194/194 通过
npm ci              # 全新安装，通过
```

依赖说明：为保持既有 Artifact 策略的 esbuild `0.25.12`，同时避开 Vite 8 对原生 esbuild `^0.27 || ^0.28` 的可选 peer 冲突，本分支使用同版本 `esbuild-wasm`。裸 `npm ci`、`npm test`、安全 Viewer 测试和 `npm run build` 均已通过。若后续升级 esbuild/Vite，必须同步更新 Artifact 工具链策略并重新跑安全验收。

### 4.4 当前候选提交复验

本轮远端候选 head 为 `8eecb9399667e9ec03cb48fa2221d09251f111b5`，tree 为 `c9a0d881f4806afec7e9860f31c36aaaca416dc9`。结果：

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 通过，29 packages，0 vulnerabilities |
| `npm run test:safe-viewer` | 16/16 通过 |
| `node --test tests/safe-viewer/compiler-process.test.mjs` | 9/9 通过，连续 3 轮 |
| `npm run test:safe-viewer:browser` | 14/14 通过；Chromium `153.0.8010.12` |
| `npm test` | 默认 194/194 + Safe Viewer 16/16；Linux CI 中执行通过 |
| `npm run build` | 通过 |
| GitHub Actions docker acceptance | 成功；run `39195580090`，head `8eecb93`，Linux Ubuntu 24.04 |

浏览器报告已写入 `testedMain` 和 `prHead` 字段；机器可读汇总见 `docs/acceptance/safe-viewer/verification.json`。

Git 凭据缺少 `workflow` scope，因此新增独立 Linux/Windows workflow job 的本地改动不能推送；当前 CI 覆盖通过把 Safe Viewer 测试接入既有 `npm test` 实现。Windows `taskkill` 故障注入由本地 Windows 11 实测，尚未进入 GitHub CI。

Linux 首次真实运行暴露虚拟入口无法从 `/` 解析 React，run `39195085076` 失败；加入诊断后 run `39195237439` 确认根因。修复为通过 `createRequire` 解析固定白名单包后，最终 run `39195580090` 成功。失败记录保留，不把旧 run 当作通过。

## 5. 开发中发现并修复的问题

1. 不透明 sandbox 源加载 module script 会按跨源 CORS 处理；runner bundle 和静态 JS 资源增加了仅针对代码资源的 `Access-Control-Allow-Origin: *` 与 CORP cross-origin。
2. 外置 React 的 CJS 命名导出在 ESM vendor bundle 中不可靠；改为每个制品自包含 bundle，确保 React 只有一份，并让用户组件在运行时硬化后惰性求值。
3. `ready` 曾在 React 提交前发送，导致渲染错误夹具被误判为 ready；改为 `useEffect` 提交后发送。
4. 静态能力扫描把 `out.fetch` 等属性名误判为全局调用；修复 PropertyAccess/QualifiedName 名称处理。
5. 同一 runner 源站的死循环进程可能污染后续同源挂载；引入源站池和 `RUNTIME_TIMEOUT` retire/quarantine。
6. 测试宿主的 retire 路由未转发导致 404；补齐测试路由并验证 quarantine。
7. 原超时逻辑只终止 Node `Worker`，而 esbuild-wasm 实际另起 `child_process` 服务进程；改为专用编译子进程，超时/取消/异常时按进程树终止，并验证 esbuild PID 退出。
8. 编译子进程原先会继承宿主完整环境；改为最小环境白名单，避免认证秘密进入编译器。
9. 新增进程身份核验与直接清理：Linux 使用 `/proc` 启动时间+boot ID，Windows 使用创建时间+父 PID；清理失败时编译服务持久熔断。
10. Linux CI 首次失败暴露虚拟入口 `/` 无法解析 React 依赖；改为通过 `createRequire` 解析仓库内固定的三个白名单包，未扩大允许导入集合。

跨源隔离的边界：本分支使用跨源 iframe、不透明 sandbox 源、独立源站池、COOP/OAC 响应头，并用死循环测试验证宿主响应性；因为 runner 需要被宿主嵌入，没有在宿主强制 COEP，因此不宣称完整的 COOP+COEP cross-origin isolated 上下文。生产部署应使用独立站点/源站池，并完成目标浏览器验收。

## 6. C 模式状态

- 正式 C 模式没有修改。
- `viewerState` 仍返回 `unavailable/pending-build`，没有伪装可运行。
- `SafeTsxViewer` 未导入 `AppSpecWorkshop`、`CustomBlockViewer` 或生产入口。
- 当前分支只是独立实验模块；正式接入必须经过独立安全验收和负责人签署。

## 7. 残余风险

- 仅 Chromium 实测；Firefox/Safari 未验收。
- Chromium 提示 `Origin-Agent-Cluster` 在已 site-keyed 源上未能 origin-key；测试依赖独立源站池和退役策略获得宿主响应，生产需要专用源站/进程监控。
- sandbox self-navigation 仍不是所有浏览器都能完全禁止；顶层导航已阻断，iframe 不持有宿主秘密。
- 源站池可被持续死循环耗尽；`RUNNER_CAPACITY` 需要运维告警/重置。
- 编译器和浏览器 0-day 无法由应用层消除。
- 没有正式业务状态写入或持久化桥；卸载即清空。

## 8. 复现命令

```text
npm ci
npm run test:safe-viewer
npm run test:safe-viewer:browser
npm run build
npm test
```

手工实验宿主：

```text
npm run dev:safe-viewer
```

## 9. 交付边界

- 未 merge、未部署、未调用真实付费模型。
- 未关闭既有安全门禁。
- 未修改其他组员正在编辑的正式 C 模式页面。
