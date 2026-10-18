# CustomBlock Phase 1B：隔离执行可行性与实际验证

日期：2026-10-18。状态：**Tech Lead 已验收环境诊断；真实隔离执行原型未通过，后续执行研发暂停**。本轮交付环境检查、固定可信探针、拒绝执行边界及自动化测试；没有用 Mock 执行器替代安全执行。当前仅获准提交这 5 个文件、发布独立分支、创建 Draft PR 并准备环境决策资料；没有获准合并或恢复不可信代码执行研发。

## 1. Git 基线与变更范围

- 经已认证 GitHub connector 读取 [PR #15](https://github.com/Nanmuxxx/BlockCraft-AI/pull/15)，确认 `merged:true`，合并提交为 `faf58a0ae47a21fc7c38094e09183d92b75b7ff6`。
- 建立 Worktree 前及诊断交付、Draft PR 准备时均通过 connector 的 `fetch_commit(main)` 确认该 SHA 是远端 main。HTTPS `git ls-remote` 因本机未配置凭据失败，不把缓存 origin/main 单独作为远端确认依据。
- 独立 Worktree 目录：`BlockCraft-AI-custom-block-phase1b`，位于已有 BlockAI 工作目录下；提交文档省略本机用户主目录路径。
- 独立分支：`feature/ai-custom-block-phase1b`，开发基线为上述合并 SHA；交付提交仅包含下列 5 个新增文件，不修改基线历史。
- 只读检查了既有 Worktree 列表和状态；创建时 7 个既有 Worktree 均干净。没有切换或修改其他 Worktree，没有 reset、rebase、clean、stash 或强制更新。

本轮新增文件：

| 文件 | 实际用途 |
| --- | --- |
| `tools/custom-block-sandbox/environment.mjs` | 读取工具与依赖版本；返回阻塞原因；执行入口始终抛出 `ISOLATION_UNVERIFIED`。 |
| `tools/custom-block-sandbox/probe-macos.mjs` | 固定可信 curl/cat 的正向对照与 Seatbelt 拒绝探针，只用回环服务和临时非敏感标记。 |
| `tools/custom-block-sandbox/preflight.mjs` | 输出 JSON 检查结果、诊断资源统计；始终以状态码 2 表示不允许执行。 |
| `tests/custom-block-sandbox/environment.test.mjs` | 9 项独立测试，覆盖拒绝执行、伪造检查结果、未知参数以及真实可信探针对照。 |
| `docs/custom-block-phase1b-isolation.md` | 本报告。 |

已有受版本控制文件零修改。UI、品牌、CSS、旧 Demo、AppSpec、AppRuntime、Phase A、Mochi、Workshop/Canvas/Inspector、AppRenderer、`server/index.mjs`、Phase 1A 协议和 package/lockfile 均未改动。没有产品入口接线，没有新增 npm 依赖。新 Worktree 的忽略目录 node_modules 逐项链接到现有依赖；仅用于已有测试和产品构建，不构成隔离镜像或依赖准入证明。

## 2. 当前环境与实际阻塞

实测环境：macOS Darwin 25.6.0 arm64，Node `v24.22.0`。PATH 中有 `/usr/bin/sandbox-exec`，无 docker、podman、colima、limactl、qemu-system-aarch64 或 qemu-system-x86_64。额外检查未发现 Docker app、常用 Docker/Lima 可执行文件或 `/var/run/docker.sock`。这证明本次检查范围内没有可用执行后端，不声称穷尽系统所有虚拟化能力。

已有依赖为 React/ReactDOM `19.3.1`，没有 Phase 1A 制品约束要求的 esbuild `0.25.12`，也没有 Playwright/Puppeteer 浏览器驱动。产品使用 Vite 能正常构建，不代表已具备固定 CustomBlock 编译器或安全执行环境。

一次 Python `RLIMIT_AS=268435456` 设置尝试报 `ValueError: current limit exceeds maximum limit`。该尝试没有建立可验证的内存限制；它不证明 macOS 所有资源隔离方案均不可行。本轮未将该尝试当作不可信代码的运行许可。

更关键的实现缺口是：尚无经审查的隔离 provider、独立可信网关、进程树资源配额和完整出站网络策略。即使向检查函数传入“所有工具存在”的 Linux 模拟清单，也始终拒绝执行。检查清单不是安全证明，调用方 `sandboxVerified:true` 不能解除阻塞。

`requireExecutionProvider()` 无源码读取、构建、导入或执行路径，也没有 unsafe 开关。测试中的伪造环境只是验证拒绝边界，不是 Linux 沙箱通过记录。

## 3. 实测、设计与未实现的区分

| 目标 | 本轮实际结果 | 验收状态 |
| --- | --- | --- |
| 固定依赖、工具链、离线源码构建 | 仅检查已安装版本；固定 esbuild 缺失，未编译组件源码 | 未实现 |
| 隔离构建、禁止任意 npm/脚本 | 本轮没有安装或执行这些操作；尚无隔离 builder | 未实现，不能称策略已生效 |
| 独立执行，不接触主站 Cookie/密钥/DOM | 没有执行组件，主应用也无新增加载入口 | 未实现执行隔离 |
| 默认禁止外部网络 | Seatbelt 下固定 curl 访问临时回环服务被拒绝；外网、DNS、浏览器外连未测 | 部分可信探针通过 |
| 限制文件访问 | Seatbelt 下固定 cat 读取一个临时非敏感标记被拒绝 | 部分可信探针通过 |
| 超时、死循环、内存超限、崩溃恢复 | 诊断子进程设 3 秒超时、8 KiB 输出上限；未测试组件、进程树或硬内存限制 | 未满足 |
| Phase 1A 受限消息 | 原有结构验证回归 137 项通过；没有连接实际浏览器通道 | 协议已有，通道未实现 |
| 来源、会话、实例、版本、去重 | 没有可信网关或认证状态表 | 未实现 |
| Runtime 写权限 | 无写接线、无权限授予、无第二个可写 Runtime | 保持零授予；尚无在线网关拒绝测试 |
| 倒计时开始、暂停、继续 | 未构建、未执行样本 | 待真实后端验收 |
| 恶意源码网络/宿主/死循环/越权/崩溃 | 未在本机无保护运行这些源码 | 待真实后端验收 |

可信探针都包含正向对照：同一 curl 在无 Seatbelt 的条件下成功访问回环服务（退出 0），使用 `(deny network*)` 后退出 7，服务未收到新增请求；同一 cat 正常读到临时标记（退出 0），限定拒绝该文件后退出 1，stdout 没有标记内容。处理了 macOS 临时路径的 realpath 别名，结束后关闭服务并移除本次临时文件。

这些 profile 除所测操作外 `allow default`，**绝不能用于运行不可信源码**。没有读取真实宿主秘密，也没有验证完整文件系统策略、系统调用、子进程、浏览器 API 或资源耗尽。不能从两个命令行探针推导 React 组件已被安全隔离。

## 4. 可信边界和后续实现条件

建议先提供独立 Linux worker，而不在主 BlockCraft Node 服务或主 React 页面执行源码。macOS 可通过独立 Linux VM 承载 worker；生产多租户应评估专用 VM、microVM 或 gVisor 等更强边界。普通容器共享内核，不能仅凭 Docker 存在宣称足够安全。以下均是后续要求，本轮未实现：

1. **构建边界**：固定不可变镜像及 digest、Node/esbuild/SDK/React 精确版本、完整传递依赖和包字节校验。依赖预装离线使用，禁止用户 package.json、npm 安装、生命周期脚本、插件或自带编译器。受信 resolver 只允许锁定依赖和制品内安全相对路径；拒绝 URL、Node builtins、任意动态解析、路径/符号链接逃逸。构建器不执行用户入口；即使如此也必须放入隔离进程，防范编译器漏洞。验证实际输出大小及 bundleDigest，附可信构建证明，不能只信 manifest 的 SRI 声明。
2. **worker 权限和网络**：无宿主目录、密钥、凭据或 Docker socket 挂载；非 root、只读基础文件系统、有限临时空间、最小 capabilities、seccomp。任务网络默认拒绝，包括 DNS、回环其他服务、内网和云 metadata；如需输出，以宿主受控通道取回，不给组件通用网络代理。不要用浏览器拦截请求 API 冒充操作系统层全出站限制。
3. **资源和恢复**：每任务独立 cgroup/VM，硬限制内存、进程数、临时磁盘、日志与消息；CPU 配额之外还需外部监督器的墙钟截止时间，因为 CPU 配额不能终止死循环。监督器在沙箱外，超限杀整个进程树/cgroup/VM，回收工作目录，启动新任务。验证 OOM/超时退出归因及重建后可正常运行，不能只调用浏览器页内计时器。初始每任务、每组件独立浏览器进程树，避免一个无限循环拖垮其他积木。
4. **浏览器展示**：从单独可注册域名的可信 viewer 展示，避免共享主站父域 Cookie。可信 viewer 不加载生成源码；在其内部另设不可信渲染边界，CSP 默认拒绝连接、框架、表单、对象、媒体及非准入脚本资源，禁止导航/弹窗/下载、存储/传感器等能力；确需资源逐项授权。iframe sandbox 和 CSP 只能作多层限制，浏览器仍需上述进程/系统隔离。严格资源隔离的第一版可在 worker 上运行浏览器，将渲染输出和受控输入交给独立 viewer；流式呈现、可访问性和交互延迟仍需单独验证。
5. **认证网关**：宿主先以精确 viewer origin、窗口 source 认证可信 viewer 握手，再绑定独享 MessagePort、随机 channel/session、project/instance/version 和生命周期。viewer 内若采用 opaque-origin iframe，`origin:"null"` 不能认证，只能结合预登记窗口与一次性端口握手；组件中可见的 token 也不能证明其业务身份。网络 worker 通道另需受认证连接，不把 postMessage 文本当来源证明。按方向校验类型、序号、请求指纹及去重表，撤销过期会话，限制解析前字节、消息频率和并发。宿主拥有可信身份标签、Mochi 入口和确认框；组件不能控制这些宿主区域，也不能覆盖其他组件边界。组件区域内的视觉冒充仍是残余风险。
6. **零写权限**：先只允许本地组件状态和受限诊断事件。Phase 1A 虽能解析 `state.compareAndSet`/`command.request`，网关必须默认拒绝全部共享状态和业务写请求；模拟状态独立于真实项目。后续任何 Runtime 命令必须另行获批，经实体/字段/能力/当前 revision 校验和原子事务执行。自报 requestedCapabilities 不等于授予。

宿主收到错误时只显示有界文本，禁止执行堆栈中的 HTML。失效 bundle、构建失败、崩溃或会话断开都撤销旧端口/任务；不会覆盖当前已确认版本或业务数据。重新构建和版本升级均需新的明确准入与确认，不能自动回退到未经审核版本。

## 5. 与 Phase 1A 的接口

本轮只读复核了 `src/custom-block/artifacts.ts`、`messages.ts` 和已有架构稿；没有改变协议。

- 制品入口继续使用 `ArtifactRegistry` 和 `resolveArtifact({definitionId,versionDigest})` 精确读取、重算摘要和验证 manifest。来源是惰性文本，只有隔离 builder 可以消费；不把源码传入宿主 eval、Function、动态 import 或主 React 组件树。
- source versionDigest 覆盖源码、manifest、依赖声明及构建约束，只证明内容一致。实际依赖字节、镜像、SDK 和构建输出必须另行核验；未来构建结果至少关联 sourceDigest、bundleDigest、imageDigest、依赖锁图和构建证明。该结果接口本轮没有实现，也未伪装成 Phase 1A 已有授权字段。
- `parseSandboxMessage` / `validateMessageData` 保留作网关内部的结构与语义检查；可信传输边界必须先做字节/频率限制和 JSON 解码，再进行会话认证、去重及权限检查。不能直接接收任意本机对象/Proxy 当网络数据。
- Phase 1A 消息集合尚无宿主发送初始 props/只读快照或渲染输入的完整契约。后续必须另审有版本的初始化和输入协议，不得借 `event.emit` 偷运任意宿主命令，也不能放宽现有解析器的精确字段规则。第一版共享写请求继续全部拒绝。
- 沿用单一项目 revision；不引入第二套可写 Runtime。只读投影和模拟状态不能写回 AppRuntime 或业务记录。
- 后续最小服务面：可信控制器的任务 create/status/cancel、构建产物只读获取、短期且绑定实例/版本的查看会话、受认证事件通道。具体 HTTP/端口/部署契约等待环境审核后定义，本轮没有实现在线服务。

## 6. 解除阻塞后的最小验收

下表都是**待执行**项目，不能计入本轮通过数量。倒计时是独立源码验收样本，不是生成器关键词模板，也未加入旧 Demo。

| 顺序 | 实际测试 | 必须留下的证据 |
| --- | --- | --- |
| 1 | 固定镜像离线构建两份不同合法 React 源码；拒绝任意包/import/脚本 | 工具与包字节证明、source/bundle digest、隔离策略、真实构建日志 |
| 2 | 倒计时 durationSeconds=900，真实点击开始、暂停、继续 | 暂停期间 remaining 不变、继续后递减、UI 与事件一致；无真实 Runtime 写入 |
| 3 | fetch/WebSocket/图片/DNS/导航/metadata 及宿主 Cookie/存储/DOM 访问 | 正向对照、策略阻断与宿主未泄漏记录；覆盖 worker 系统层和浏览器层 |
| 4 | 假 origin/source/port/session/instance/digest，重复/乱序 seq、requestId，超大/深消息和消息洪泛 | 可信网关拒绝、有限队列/日志、共享项目完整且 revision 未变化 |
| 5 | render/effect 无限循环、内存分配、进程/日志洪泛、组件抛错、构建器异常 | 外部监督器终止、配额证据、其他任务存活、新会话恢复正常倒计时 |

在存在可靠隔离的后端上才执行恶意源码。新增进程异常测试需设宿主端全局截止时间，避免测试框架自身挂起。真实组件崩溃隔离与恢复不以 React ErrorBoundary 测试替代。

## 7. 本地运行与本轮验证

在本 Worktree、Node 24 下运行（已存在兼容依赖）：

```sh
# 从现有 BlockAI 父目录进入本 Worktree
cd BlockCraft-AI-custom-block-phase1b
node tools/custom-block-sandbox/preflight.mjs
node tools/custom-block-sandbox/preflight.mjs --probe-macos
node --test tests/custom-block-sandbox/*.test.mjs
```

前两条预期退出 **2**，表示环境未准入，不是成功启动沙箱。第二条会短暂监听随机回环端口，仅供固定 curl 对照，并写入/清理一个临时标记；不访问外站或秘密。其他参数退出 64；不存在 `--run`、`--source`、`--provider` 或 `--allow-unsafe`。非 macOS 时可信探针测试显式跳过；本机 9 项全部实跑通过，无跳过。

| 检查 | 本次结果 | 范围 |
| --- | --- | --- |
| `node --test tests/custom-block-sandbox/*.test.mjs` | 9/9 通过 | 拒绝执行与可信探针；不是组件沙箱验收 |
| `node --test tests/custom-block/*.test.cjs` | 137/137 通过 | Phase 1A 协议/迁移，制品注册表是测试替身 |
| `npm test` | 120/120 通过 | 原有模型、Runtime、组件及离线适配器 |
| `node --test tests/ai-quality/*.test.cjs` | 83/83 通过 | 离线 fixture/mock 与真实本地 Runtime 行为 |
| `npm --prefix server test` | 23/23 通过 | Mock upstream，不调用真实 DeepSeek |
| `npm run test:generation` | 23/23 通过 | 当前集成基线离线生成及兼容性回归 |
| `npm run build` | 通过 | 原产品 TypeScript + Vite 构建，不是 CustomBlock 构建 |

诊断阶段共 395 项测试通过，0 失败、0 跳过；其中新增 9 项。提交准备阶段再次运行原有的这 9 项诊断测试，全部通过、无跳过；没有扩充 Mock 或其他测试数量。其余 386 项和产品构建沿用本报告同日诊断阶段的结果，提交准备阶段只调整本报告。全程无真实 AI 调用、无待执行组件源码加载。

一轮带 macOS 探针的诊断测得：耗时 54 ms，控制器 CPU user 13853/system 4127 微秒，max RSS 63632 KiB。只统计可信 Node 诊断控制器，不含 curl/cat、编译器或浏览器进程树；数值随机器负载变化。没有组件 CPU、内存、构建时间或并发容量实测，不能据此估算产品沙箱容量。

交付前检查全部新增文本的空白错误、相对链接及代码语法，并核对 Git 变更范围。文档是阻塞与可行性报告，不将尚未执行的验收记为通过。

## 8. ModelScope 可行性、资源预算与成本

本轮没有获准的 ModelScope 实例或管理权限，没有登录、创建、部署或调用其服务。公开 [资源页](https://www.modelscope.cn/magicube/usage) 的匿名读取只展示登录/资源界面，[ModelScope 发布的 studio 页面](https://modelscope.cn/skills/modelscope/modelscope-studio) 的正文未能由当前读取工具取得；这些不足以确认当前账号 CPU 配额、网络/特权控制或价格。文档提及 Docker 部署也不等于任务里可访问 Docker daemon、嵌套虚拟化、网络命名空间或委派 cgroup。

因此，**当前不能确认免费 CPU 创空间能够作为不可信代码 worker**。若只具备应用容器而没有每任务硬配额、出站控制、进程树回收和可信宿主外监督器，它可以承载可信控制/展示层，执行任务需转到独立隔离 worker。用户自己的浏览器执行 iframe 仍会消耗用户 CPU/内存，远端创空间配额不能保护用户浏览器。

解除阻塞的资源方案供审核，不是已测容量或采购报价：

| 项目 | 初始规划预算 | 待核实项 |
| --- | --- | --- |
| 本机独立 Linux VM | 2 vCPU、4 GiB RAM、10 GiB 磁盘，单并发起步 | VM 工具可用性、镜像来源、宿主额外开销及运维更新 |
| 单次隔离构建 | 512 MiB、10 秒墙钟上限、有界输出/临时盘 | 固定工具链冷启动峰值与编译复杂度；不足则显式失败 |
| 单组件独立浏览器任务 | 1 GiB、30 秒验收会话、有界进程/日志 | Chromium 真实进程树峰值、OOM 后恢复；长会话预算另审 |
| 托管 worker | 独立 Linux 计算、内容寻址存储、独立域名/TLS、必要的渲染流量 | 服务商单价、地域、并发/时长、隔离支持及流量；未获取报价 |

运行成本由并发 × 活跃时长 × 每任务资源，加构建缓存/产物存储、流量和隔离运维决定。需要获取实际权限和规格后压测、询价；本轮新增云费用为 0，没有声称未来能永久免费或给出未经验证的人民币价格。VM 安装与后端部署留待 Tech Lead 审核，不擅自改变本机运行环境。

## 9. 最大三个风险与停止点

1. **资源与出站隔离未建立**：Seatbelt 的局部成功不够。若无独立 worker 和外部监督器，死循环、OOM、宿主访问或外连会使 Phase 1B 安全目标失效。
2. **制品供应链与真实性未建立**：Phase 1A 摘要不能证明真实包、工具链或运行 bundle；必须补齐锁图、字节校验和可信构建证明，防止“内容相同”被误当作“获准运行”。
3. **通道身份与可用性未建立**：Schema 不认证来源。共享浏览器进程、可伪造信封、重放和洪泛均可能跨组件影响；需网关身份绑定、速率预算、任务独立终止和恢复证据。

明确未支持：任意 npm 包/脚本、主进程 eval 或不受保护的动态组件加载、主站同源执行、通用网络/文件系统权限、Runtime 写入、真实 AI 生成、B/C UI、Mochi 接入或生产多租户安全承诺。恶意内容仍可在组件自己的显示区域欺骗用户，操作系统/浏览器漏洞及侧信道不能靠本轮协议消除。

后续顺序应为审核独立 Linux worker 的环境与资源方案，再单独授权实现固定离线 builder、受监督独立浏览器、可信网关，最后执行第 6 节真实验收。当前没有安全后端，不继续加载组件。本次交付仅允许诊断提交、分支发布及 Draft PR；不合并、不部署、不调用付费 DeepSeek，交付后停止并等待新的研发授权。

## 10. 最小可行环境决策表（仅资料，不恢复研发）

状态严格区分：**已实测**只指本机实际检查或可信探针；**仅文档支持**指通用机制在官方资料中有依据，不代表本项目或 ModelScope 已启用；**尚未验证**指具体目标环境和实现缺少现场证据。一个机制有文档支持，部署状态仍可能尚未验证。

| 决策项 | 最小条件与实际实现方式 | 证据状态 | 新研发授权后需要取得的证据 |
| --- | --- | --- | --- |
| Linux 隔离构建 | 任务拥有独立 user/mount/PID/network 命名空间或更强 VM 边界；非 root、只读离线工具链、seccomp、无宿主敏感挂载。可信控制器在边界外。完整依赖字节锁定并拒绝 npm/脚本。 | 本机缺少已检查的后端与固定 esbuild：**已实测**；目标 worker：**尚未验证** | 实际内核/runtime/镜像 digest、可用命名空间、最小权限配置、离线构建与越界拒绝记录；不得靠容器内 root 或 Docker 名称推断权限 |
| CPU、内存、进程与超时 | 委派可用的 cgroup v2 cpu/memory/pids 控制器；任务先入组再启动。使用 `cpu.max`、`memory.max`、`memory.swap.max`、`pids.max`，监测 memory.events；外部单调时钟监督器超时后用可用的 `cgroup.kill` 杀整棵任务树，或销毁 VM。 | 内核机制：**仅文档支持**；目标机器可写控制器、OOM/超时与恢复：**尚未验证** | 读回生效限额、任务归属、OOM/超时退出与树清空记录；平台整容器限额不能代替每组件限额 |
| 独立 Viewer 来源 | 专用 HTTPS 可注册域名，无主站父域 Cookie、密钥或账户会话；主站只嵌入可信 viewer。生成代码在独立 worker 浏览器运行，或在另审的内层边界运行；不进入可信 viewer 页面。CSP/iframe 仅提供补充防护。 | iframe/消息来源机制：**仅文档支持**；域名、响应头、实际 Cookie/DOM 隔离：**尚未验证** | 真实域名及响应头、可控非敏感 Cookie/存储/DOM 对照，验证失败不会影响宿主；浏览器页内限制不能替代硬资源限制 |
| 网络与密钥 | 不可信任务无外部网卡/通用代理，控制器通过受限 IPC 传递非敏感输入/产物。禁止宿主网络/Unix socket/metadata/共享 secret；任务使用一次性浏览器数据目录，回收后不复用。 | macOS 回环 curl 限制：**已实测**；Docker none 网络语义：**仅文档支持**；目标全出站策略：**尚未验证** | DNS、IPv4/IPv6、WebRTC/导航等浏览器出口及系统层对照，宿主网络不可达、无凭据注入、限量产物可回收 |
| 可信消息网关 | 精确 origin/source 与预登记端口握手；宿主创建并绑定 session/channel/project/instance/version，生命周期撤销；序号、指纹去重、方向/类型/长度/速率/并发验证；共享状态写入全部拒绝。worker 链路另需受认证 TLS/服务身份。 | Phase 1A 结构验证及本轮无写接线：**已实测**；origin/source 基础机制：**仅文档支持**；端到端认证、重放/洪泛防护：**尚未验证** | 恶意来源、旧会话、跨实例/换版和重放全部被拒绝；模拟状态不进入 Runtime。公开身份字符串不等于认证 |

资源机制依据 [Linux cgroup v2 官方文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)：CPU 配额限制带宽，不终止循环；memory.max 是内存硬限制接口，但内核文档说明存在暂时超限情形，不能承诺精确到单字节；cgroup.kill 可终止组及后代。仍需保留宿主余量、组级 OOM 处理和外部回收监督。以上没有在本机 Linux worker 实测。

[Docker 资源限制文档](https://docs.docker.com/engine/containers/resource_constraints/)说明默认容器没有 CPU/内存限额；声明容器存在并不能证明限制生效。[Docker none 网络文档](https://docs.docker.com/engine/network/drivers/none/)说明该模式仍有任务自身 loopback，故不能把“无外部网卡”描述成“所有网络 API 均不可用”；不得在同一任务网络中放置可信敏感服务。上述是后续配置依据，没有安装 Docker 或执行示例镜像。

来源检查依据 [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)和 [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)。独立域名不能保护用户机器 CPU/内存；opaque-origin 的 `null` 不能单独作身份认证；把不可信内容放在 iframe 也不提供完整执行隔离。这些浏览器机制没有在本项目新建 viewer 实测。

### ModelScope 当前支持结论

**尚未验证是否支持；不能按“真实支持”批准为执行 worker，也没有证据断言平台一定不支持。** 本次公开检索找到 [官方 Docker 创空间文档入口](https://modelscope.cn/docs/studios/docker)，但正文读取失败；部署 Schema 入口读取也失败，未取得每任务隔离能力的公开契约。未用社区问答、搜索摘要、Notebook 配额或 Dockerfile 部署能力推导安全保证，也没有读取账户 token、浏览器 Profile 或平台秘密。

需要平台或环境所有者分别确认：能否创建任务级独立沙箱；是否有受控 runtime 或嵌套隔离 API；cgroup 控制器能否按任务委派；能否设置网络命名空间/出站策略；是否有任务外监督器、任务独立回收与可观测配额；是否支持独立 viewer 域名和正确响应头；平台注入的环境凭据能否与不可信任务彻底隔离。只读查看 cgroup 文件也不能证明可设置限额；未来验证需另获授权，不在本轮通过特权探测来试探平台。

### 不支持时的替代架构与成本边界

| 方案 | 架构与安全条件 | 成本/可行性状态 |
| --- | --- | --- |
| 本地研发验证 | 独立 Linux VM 内放置离线 builder、每任务受监督浏览器；主站只接可信控制/展示层。VM 作为额外边界，不与主站共享凭据、Profile 或宿主工作区。 | 按第 8 节 2 vCPU/4 GiB/10 GiB、单并发预算规划；消耗本机资源和镜像维护工时。工具许可、容量及启动耗时**尚未验证**；本轮不安装。 |
| ModelScope 可信前端 + 独立 Linux worker | ModelScope 仅运行可信控制器/展示服务，使用认证任务接口连接隔离 worker；组件无权使用该接口。独立域名 viewer 和最小数据投影保持主站边界。 | 需要独立计算、存储、流量及域名/TLS 运维。免费前端不等于免费 worker；价格取决于供应商、地域、并发与时长，**尚未报价**。 |
| 专用 Linux/VM worker + 更强 runtime | 在具有管理权限的独立机器上评估 gVisor 或每任务 microVM，提供硬配额、出站拒绝和外部回收。无需将 Docker socket 暴露给任务。 | [gVisor 官方文档](https://gvisor.dev/docs/)提供隔离 runtime 的技术依据，属于**仅文档支持**；React/Chromium 兼容性、额外内存/冷启动、宿主要求与实付价格均**尚未验证**。 |

成本估算应包含：worker 实例时价 × 开机时数 + 存储 + 渲染传输流量 + 域名/证书服务与运维；按请求计费环境则需另计每任务资源时长及启动开销。资源预算不能当作人民币报价，当前缺少供应商/地域和会话时长，故不报未经核实的价格。是否选择远端渲染还会影响流量、交互延迟与可访问性，须在新授权中明确。

本轮只完善决策资料与诊断交付，不增加 Mock 测试，不安装编译器/依赖，不执行 AI 源码，不修改产品视觉界面。提交文件只包含源码、测试与汇总文档，不包含诊断原始输出、真实临时文件、密钥、设备唯一标识或浏览器数据。
