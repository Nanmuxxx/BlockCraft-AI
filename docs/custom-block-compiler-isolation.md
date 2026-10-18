# CustomBlock 固定编译器与隔离运行审查交付

2026-10-18。状态：**两个可信开发者样本真实编译通过；隔离执行仍阻塞，所有组件运行被拒绝。停在代码审查点。** 初轮未提交；后续精确提交与独立 PR 已获授权，见第 8 节。没有调用 DeepSeek、启动线上服务、安装虚拟化软件、合并或部署。

## 1. 远端基线和已有阶段

通过已认证 GitHub connector 读取 main、PR #15/#16/#19，并在交付前重新读取 main 分支：

| 项目 | 当前核实结果 |
| --- | --- |
| main | `c039fe9533a868425a493ed7d581774aa042a20f`，PR #19 的合并提交 |
| Phase 1A / PR #15 | 已合并，`faf58a0ae47a21fc7c38094e09183d92b75b7ff6`；已有 SourceArtifact、规范 versionDigest、Registry、受限 Schema 和消息结构 |
| Phase 1B / PR #16 | 已合并，`ecf7000dcb0015f7d9c2b895f6fdd3957ff70449`；仅环境诊断和拒绝执行，真实隔离未验收 |
| MVP / PR #19 | 已合并；不可变 `pending-build` 存储、静态源码检查和模型生成契约；此前未编译/执行组件 |

Git HTTPS fetch 缺少本机凭据；没有拿缓存引用冒充远端确认。远端核实的 main commit 已存在于本地对象库，直接从该精确 SHA 创建全新 worktree：

- 路径：`/Users/nanmuxun/BlockAI/BlockCraft-AI-compiler-isolation-20261018`
- 分支：`feature/custom-block-compiler-isolation-20261018`
- 没有切换、重置、覆盖或修改已有工作树。初轮交付时 HEAD 为上述基线，文件未提交、未暂存；授权提交轮保留此基线，不引入其他 Agent 的变更。

## 2. 实际新增文件清单

共 **18 个新增文件**，已有受版本控制文件零修改。

| 文件 | 用途 |
| --- | --- |
| `tools/custom-block-compiler/package.json` | 私有、独立的精确版本依赖集合，无 scripts |
| `tools/custom-block-compiler/package-lock.json` | 固定完整依赖图及各平台 esbuild 包的 SRI |
| `tools/custom-block-compiler/.gitignore` | 排除安装依赖、tarball 和本地编译产物 |
| `tools/custom-block-compiler/verify-packages.py` | 固定锁摘要、tarball SHA-512、安装目录完整文件字节和二进制验证 |
| `tools/custom-block-compiler/supply.mjs` | 有超时的离线依赖验证入口 |
| `tools/custom-block-compiler/policy.mjs` | 复用 Phase 1A/MVP 校验、固定构建策略与 bundle 摘要核验 |
| `tools/custom-block-compiler/trusted-samples.mjs` | 仓库控制的两个可信样本目录及精确文件摘要 |
| `tools/custom-block-compiler/worker.mjs` | 固定内存 resolver、esbuild 子进程编译及回执；只接受两个样本名称 |
| `tools/custom-block-compiler/service.mjs` | build/status/私有审计/Viewer 拒绝接口与有界单任务控制 |
| `tools/custom-block-compiler/contracts.ts` | 供未来可信 B/C 控制器引用的 TypeScript 契约 |
| `tools/custom-block-compiler/validate-trusted.mjs` | 两个可信样本经过真实 pending store 的固定离线验证 CLI |
| `tools/custom-block-compiler/isolation.mjs` | 当前可用后端调查、固定可信探针及拒绝执行入口 |
| `tests/custom-block-compiler/fixtures/Counter.tsx` | 开发者手写计数器，局部状态及按钮 |
| `tests/custom-block-compiler/fixtures/Temperature.tsx` | 开发者手写温度转换输入组件 |
| `tests/custom-block-compiler/fixtures/convert.ts` | 第二个样本的相对模块，验证多文件链接 |
| `tests/custom-block-compiler/compiler.test.mjs` | 12 项真实编译、拒绝路径、完整性、去重和确定性测试 |
| `docs/custom-block-compiler-evidence.json` | 本轮真实构建回执和隔离诊断快照，无可执行代码 |
| `docs/custom-block-compiler-isolation.md` | 本报告及接口/复现说明 |

本地 `.artifacts/` 另有 counter/temperature 的 `.mjs`、各自 `.receipt.json` 及 `validation.json`，只供私有离线审计，未纳入 Git、未通过服务器公开、未加载执行。根 node_modules 仅在新 worktree 的忽略目录内链接既有项目依赖；固定编译器拥有独立 npm 安装目录，不复用旧 Vite 工具链。

## 3. 固定工具链和信任边界

固定 Node **24.22.0**、esbuild **0.25.12**、React/ReactDOM **19.3.1**、scheduler **0.28.0**、TypeScript **5.9.3**。源码仍采用 Phase 1A `react-isolated-v1`、`es2020`、`esm`、SDK 协议版本 `1.0.0`；没有新增消息 SDK 或 Runtime 权限。不同 Node 版本会拒绝本轮编译；Linux 平台包虽然在锁中，**尚未实测**。

独立 lockfile 的 SHA-256 为 `81e1ad412fefdc1cfc9f66c51da8ec28dbffe03f7956666bd17117d557f04fbe`，验证器内固定此值。只在可信安装阶段执行 `npm ci --ignore-scripts`，包括 esbuild 的 postinstall 在内的所有生命周期脚本均未运行。平台二进制来自锁定的可选平台包。生成源码不能指定 npm、插件、脚本、编译参数、路径、环境变量或安装动作。

通过官方 registry 的固定 HTTPS tarball 地址下载上述 6 个当前平台实际使用的包，拒绝跳转，验证 SHA-512 SRI。验证器不解包执行代码，读取归档后逐文件比较已安装目录：相对路径集合与全部文件 SHA-256 必须完全相等，额外文件、符号链接、字节更改都拒绝。用于既有 import-policy 的根 TypeScript 也与同一归档字节比较。编译前后重复验证，记录完整文件树摘要、文件数、tarball 摘要、精确版本和 esbuild 原生二进制摘要。本机共验证 227 个包文件。

当前平台 `@esbuild/darwin-arm64@0.25.12` 二进制 SHA-256：`3e030ee2aa86ad3c33e5e95ae0e53bb03de40e0da35c9b1180a67de4a497cae5`。完整 SRI、树摘要及实际参与 bundle 的 10 个依赖文件摘要见 JSON 证据。

组件源码只作为内存文本交给 esbuild；源文件 resolver 只读取制品内部唯一解析的相对 TS/TSX 模块。依赖 resolver 只读取经过校验的 React、ReactDOM 和内部 scheduler；不采用用户 tsconfig/package.json/插件，也不回落到磁盘任意解析。固定 bootstrap 提供 `default Component` 和 `mount(root,props)` 导出，ReactDOM 完整打入 bundle。只有未来获准的隔离浏览器才能调用 mount；本轮没有调用。

输出固定生产模式、单文件 ESM、无 sourcemap、无外部 import；实际字节数必须不超过 524,288。源码完整 SourceArtifact 摘要和独立 sources 映射摘要分别记录，回执再绑定 bundle、锁、二进制、驱动源码和固定 bootstrap 摘要。**回执未签名，不是来源认证或运行许可**；本地目录与操作员属于信任边界，不防御同账户进程同时篡改整个工具链。没有镜像 digest 或经过验证的 Linux 构建隔离证明。

可信样本的源码文件摘要写在仓库控制目录中，完整版本引用也必须吻合该目录重算结果。`provenance.kind` 不决定信任。普通未知引用在读取 pending store、解析源码或启动编译器之前直接返回阻塞；不能通过自报 trusted/verified、伪造回执或注入 provider 解除限制。worker 本身也只接受 counter/temperature 两个固定名称，不能直接传源码绕过控制器。

## 4. 真实编译记录

执行时间：2026-10-18 17:17（Asia/Shanghai）；本机 Node v24.22.0 / Darwin arm64。样本均为本轮手写可信代码，无模型调用。两者先进入真实不可变 pending store，再读取精确引用、重算完整摘要、编译、验证、保存私有审计产物；store 最后仍为 pending-build。

| 样本 | 源文件 | bundle bytes | 单次耗时 | 结果 |
| --- | ---: | ---: | ---: | --- |
| Counter | 1 | 223702 | 378 ms | 真实编译通过，未执行 |
| Temperature | 2 | 223687 | 370 ms | 真实编译通过，未执行 |

完整 `sourceDigest` / `versionDigest`：

```text
Counter:     sha256:616498cc16cfd7af5663c5638660dd19e913a75a22a398a13ec319128be527ec
Temperature: sha256:039ce7baf9b902ea58c62c239a96c9599b534a64838e030a04a37085bc4bcb6a
```

实际 `bundleDigest`：

```text
Counter:     sha256:70b4037a0150a17d62976fe131cdebb7928c997b3cf0371010848d61f7b3eb17
Temperature: sha256:297970e1e1d48f74b9799c34ee1f59a2ec9d978fdc84d39775d2298fb6045a44
```

测试中新建控制器再次编译 Counter，得到完全相同 bundle 摘要；两个组件的源码及 bundle 摘要彼此不同。篡改依赖真实安装文件、源码摘要、依赖 SRI、bundle 字节或长度均被拒绝。组件还通过独立 `tsc --strict --noEmit` 检查；此辅助检查使用基线已有 React 类型，不是运行/交互证据。

## 5. 隔离实测结果与明确阻塞

重新调查 PATH 工具、Docker/OrbStack app 和标准 Docker socket；未发现 docker、podman、colima、limactl、QEMU、multipass、tart、orb 或 Linux 隔离工具。此结论限于列出的调查范围；不声称系统没有任何虚拟化硬件能力或远端 worker。没有已提供且可验证的远端 worker 地址/身份，没有安装软件或申请云资源。

| 验收项 | 本轮实际结果 | 是否可作为运行许可 |
| --- | --- | --- |
| 独立 Linux VM/worker | 未发现可用后端 | 否 |
| 网络拒绝 | Seatbelt 下固定 curl 的回环请求退出 7，服务未收到新增请求；无隔离正向对照退出 0 | 否，仅局部诊断 |
| 宿主文件不可访问 | 固定 cat 读取临时非秘密标记被拒绝，退出 1；正向对照退出 0 | 否，仅指定文件 |
| 全网络、DNS/IPv6/metadata/浏览器出口 | 未测 | 否 |
| CPU/内存/pids/磁盘硬限额 | 未建立 | 否 |
| 超时终止、进程树清空和恢复 | 未在真实隔离后端验收 | 否 |
| 真实 React 点击、输入和隔离渲染 | 未尝试 | 否 |

复用 Phase 1B 的固定可信探针，未读取真实秘密。Seatbelt profile 除被测操作外允许 default，绝不能拿来执行组件。固定编译子进程的 20 秒 deadline、1 MiB stdout/8 KiB stderr 上限和 Node heap 参数只是可信编译的运维限制；进程组 kill 路径尚未注入超时/残留后代测试，Node heap 上限也不是进程树硬内存配额。以上均不冒充隔离验收。

后续需要独立 Linux worker（优先 VM），离线不可变工具链、无宿主秘密/工作区/socket 挂载、默认拒绝出站、非 root/只读系统、实际 cgroup CPU/memory/pids/磁盘预算，以及任务外监督器验证 deadline/OOM/进程树回收和重建。必须再验证隔离浏览器、独立 Viewer 来源和认证网关后才接交互。这些是阻塞条件，当前没有虚构 provider 或可用 Viewer URL。

## 6. 供 B/C、Viewer 使用的接口

当前实现是 `createBuildService({store})` 的可信服务端模块接口，类型位于 `contracts.ts`。**未新增 HTTP 路由，未修改 Workshop 或主服务。** 主页面不得直接调用编译模块、读取私有 bundle 或加载组件。

```ts
build({ contractVersion: 1, reference: { definitionId, versionDigest } }): Promise<BuildStatus>
status(jobId): BuildStatus | null
inspectCompiled(jobId): { receipt: BuildReceipt, bundle: Uint8Array } | null // 私有审计
createViewer({ contractVersion: 1, jobId, instanceId, reference }): ViewerBlocked
```

- jobId 为 `build-` 加 versionDigest 的 64 位十六进制部分，当前服务实例最多 64 个作业、只允许一个可信编译；同版本并发请求去重。实例内状态为 checking → compiling → compiled/failed；未知引用直接 blocked。同摘要冒用其他 definitionId 在并发与缓存路径均拒绝。
- `build` 等待最终结果，其他可信请求可按可推导 jobId 调用 status；所有状态是拷贝。当前状态/产物仅内存保存，CLI 另存私有审计文件，不承诺持久队列、跨进程去重、自动重试或认证传输。
- `compiled` 仅表示编译通过，`execution:'denied'` 始终存在。pending store 不晋升状态、不回写源码、不签发 runnable/permit。
- Viewer 校验 jobId、instanceId 和精确 reference，始终返回 `{contractVersion:1,status:'blocked',code:'ISOLATION_UNVERIFIED',execution:'denied',instanceId,reference}`；没有 URL、会话 token、动态模块入口或任何写能力。
- 将来若映射为 HTTP，可分别用 `POST /custom-block/builds`、`GET /custom-block/builds/:jobId`、`POST /custom-block/viewers`，这些仅为集成建议，当前不可访问。鉴权、隔离证明、独立域名/CSP、可信会话与事件网关必须在放行 Viewer 前另审。

## 7. 复现与验证

在本 worktree、固定 Node 24.22.0 和 Python 3 环境中：

```sh
# 可信操作员准备；不可由 build 请求触发。禁止省略 --ignore-scripts。
npm --prefix tools/custom-block-compiler ci --ignore-scripts --no-audit --no-fund
python3 tools/custom-block-compiler/verify-packages.py --fetch
node server/custom-block/build-protocol.mjs

# 以下只读本地锁/缓存/已安装包，构建过程中没有在线安装或获取依赖。
python3 tools/custom-block-compiler/verify-packages.py
node tools/custom-block-compiler/validate-trusted.mjs
node --test tests/custom-block-compiler/*.test.mjs
node tools/custom-block-compiler/isolation.mjs
```

最后一条预期退出 **2**，表示阻塞；不是执行成功。Python 默认分支完全离线；--fetch 是可信安装步骤，只允许固定 URL/SRI，使用系统 curl 的正常 TLS 校验，无跳转、不关闭证书验证。当前系统 Python CA 配置曾导致下载失败，改用系统证书链后下载及字节核验通过。运行期没有 --allow-unsafe、--source、--plugin 或自报沙箱通过开关。

| 实跑检查 | 结果 |
| --- | --- |
| 新 compiler 测试 | 12/12；含两份真实构建和跨控制器重复构建 |
| compiler + MVP generation + Phase 1A + Phase 1B 合并运行 | 240/240，0 失败、0 跳过 |
| `npm test`（当前 main 原有套件，含 Mochi host） | 通过 |
| AI Quality 离线测试 | 83/83 |
| server Mock 测试 | 23/23 |
| generation 兼容离线测试 | 23/23 |
| 原 `npm run build` | TypeScript + Vite 成功，未包含 CustomBlock fixture/bundle |
| 新接口契约与两个样本的独立 TypeScript 检查 | 通过 |

之后在自检中修正并发去重时不同 definitionId 的拒绝顺序，仅重跑受影响的 12 项新测试；其余结果来自同轮完整回归。语法、JSON、全部新增文本空白与路径范围检查通过。没有使用 git diff --check 对未跟踪文件的空结果冒充新增文件检查。

**审查停止点：** 编译基础和可信样本证据已交付；真实隔离、AI 源码执行、组件交互与 Viewer 放行仍阻塞。原 UI/品牌、Runtime、server/index.mjs、app-builder、mochi-ai、integrations/mochi、根 package/lockfile、Docker/部署均零修改。后续只授权精确提交和独立 PR，禁止合并与部署。

## 8. 授权提交轮的复核

Tech Lead 批准精确提交、非强制发布新分支并创建目标 main 的独立 PR；没有批准合并、组件执行或部署。

在暂存前保存全部 18 个源文件、文档和私有编译产物的恢复归档与 SHA-256 清单，位置为工作树外的 `artifacts/compiler-review-snapshot-20261018-172653/`。缓存和依赖仍留在原忽略目录。恢复归档、日志、缓存、node_modules 和临时 bundle 均不提交。

### 文件数量与 UI 计数差异

`git status --short --untracked-files=all` 与本报告第 2 节逐项比较：恰好 18 个新增文件，已有受版本控制文件修改数为 0，原暂存文件数为 0。初轮文件合计 1,769 行，授权轮只补充本报告的复核说明。因此以该工作树 HEAD 为基准的完整差异应为 18 个新增文件、纯新增行、删除 0 行。

用户报告的 UI「16 文件、+937/-11」不是这个基准下的完整 Git 差异；其中 -11 也不表示原项目有 11 行被删除。它可能采用某轮编辑前后的快照或其他比较范围。当前计算机工具禁止读取 Codex 自身 UI，无法确认该显示当时的比较基准，也不能把推测当作已确认根因。最终以精确暂存清单、`git diff --cached --numstat` 和 PR 文件清单三方一致为准；本轮没有为了匹配 UI 数字而排除两份文档或加入无关变更。

### 再验证

- 固定 Node v24.22.0、esbuild 0.25.12、React/ReactDOM 19.3.1、scheduler 0.28.0、TypeScript 5.9.3；离线重验 6 包、227 文件及锁和平台二进制摘要，结果与首轮证据一致。
- 两个可信样本在测试中再次真实编译；验证完整 SourceArtifact/versionDigest、sources 映射、bundle 字节/长度及依赖完整性绑定，Counter 跨控制器重编译摘要一致。已保存的私有 bundle/回执也与证据再次核对。
- compiler + MVP generation + Phase 1A：231/231；本轮不重复 Phase 1B 环境调查或 Seatbelt 探针。新 compiler 的 12 项测试包含其中。
- `npm test`：144/144；AI Quality：83/83；server Mock：23/23；`tests/generation/*.test.mjs`：23/23（其中 compatibility 4/4）。
- 原项目生产构建（TypeScript + Vite）通过；新接口及样本的独立 `tsc --strict --noEmit` 通过。
- pending store 仍为 pending-build，伪造 runnable 记录被拒绝；所有构建回执 execution 为 denied，Viewer 返回 ISOLATION_UNVERIFIED；没有执行组件模块。

远端 main 已推进到 `16cd342550b7989ad2d555687b8b867a06f3a2bf`（PR #17 合并）；本分支仍从 PR #19 的 c039fe9 基线提交，PR 目标为 main。上述本地验证范围是本分支基线；不冒充最新 main 合并后的集成验证。本机 Git HTTPS 无凭据、SSH 无身份，采用已有认证 GitHub 连接器上传精确 Git 树/提交并创建新分支；不改变 main、不使用 force、不覆盖已有远端分支。发布后核对本地/远端 tree、commit 和 18 个文件清单。
