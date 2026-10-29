# Phase 2：真实图像生成的离线安全准备

日期：2026-10-29 Asia/Shanghai。关联 [#91](https://github.com/Nanmuxxx/BlockCraft-AI/issues/91)、[#92](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92)。本轮状态 **PARTIAL**；`REAL_PROVIDER=NOT_RUN`。没有真实模型请求、密钥读取、预算修改、合并、部署或公开发布。

## 本轮成果与精确基线

T1 实时审计、T2 官方比较、T3 契约提案/独立 Workshop 限定 ACK，以及独立的有界图片下载和严格 PNG 校验代码已完成。这个模块不是可用的真实 Provider，不产生生成请求，也未接入任何产品路由。真实 Provider 隔离验收和真实端到端均 **BLOCKED**，不能从 Mock 或本轮安全测试推导通过。

| 对象 | 实时 HEAD / base | 状态、审批、关联 CI |
|---|---|---|
| main | `bcb6c1a7402ad4b4514feb4865c38d769d7244d1` | git ls-remote 与 GitHub PR base 一致；未修改 |
| [#94](https://github.com/Nanmuxxx/BlockCraft-AI/pull/94) | `79080e450ff667eae7c2c8acd700b7b367752f12` / main | Draft/open/unmerged，reviews=[]；[Docker成功](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40526326955) |
| [#96](https://github.com/Nanmuxxx/BlockCraft-AI/pull/96) | `906cdea3558b1ae4f7ec2e54795033be02949966` / main | Draft/open/unmerged，reviews=[]；[Docker](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40531592773)、[Offline](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40531592635)成功 |
| [#98](https://github.com/Nanmuxxx/BlockCraft-AI/pull/98) | `77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad` / main | Draft/open/unmerged，reviews=[]；[Docker](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40869118800)、[Offline](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40869118785)、[HTTP Mock](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40869118892)成功 |

保存的实时快照见 [github-snapshot.json](github-snapshot.json)。工作流工具返回 PR-triggered 第一页关联运行；这里报告的是关联运行状态，不把它当成本轮本地执行日志，也不宣称列全所有历史检查。正式 PR review 为空与 Issue 内独立 QA 报告是不同事实。

`git merge-base <94 HEAD> <98 HEAD>` 返回94 HEAD；对96亦返回96 HEAD。实际diff和历史显示98已保留94/96两个分支历史，且包括后续HTTP和竞态修复。阶段二采用 **stacked PR，base branch=`feat/image-http-integration-20261028`，精确 base SHA=`77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad`**。不再次 cherry-pick 94/96，不修改其分支。未来依赖推进后重新核对并通过普通追加提交处理冲突；不自动合并、重写历史或修改main。

[已有独立QA](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6496584157)与[Supervisor登记](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6496629650)的ACCEPT仅限98隔离HTTP Mock。原作者/原QA并未被本聊天自动唤醒。

## T1 服务端审计（前端完整审计见 contract.md）

以下全部为精确98源码证据，不是推测生产环境已具备条件。

| 项目 | 实现证据 | 阶段二缺口 |
|---|---|---|
| Provider | [provider.ts L37](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/provider.ts#L37) 只允许mode:mock；[isolated-mock.mjs](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/isolated-mock.mjs) WeakSet品牌和Worker退出确认 | 没有REAL实现，不能在此塞入付费transport或只改kind |
| Wire / 生命周期 | [contract.ts L4](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/contract.ts#L4)：4096请求字节、710000响应字节、10s请求/120s job/15min retention；create POST/status GET/cancel POST；QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/UNCERTAIN | kind仅HTTP_MOCK，charge仅NONE/UNCERTAIN；内存任务过期不等于真实账单清零 |
| 身份/项目授权 | [coordinator.mjs L26](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/coordinator.mjs#L26)必须注入identity+project授权，多次授权核对；status/cancel验证owner；同源检查只是附加限制 | fixture注入不是生产身份/项目登记。 [studio-launcher.mjs L104](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/studio-launcher.mjs#L104)有可信opaque session resolver；L135说明项目只在浏览器，没有可直接复用的服务端project ACL |
| 幂等/并发/预算 | [coordinator.mjs L94](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/coordinator.mjs#L94) scope=version/principal/project/key，canonical payload hash；内存Map，最多256任务/4 Worker，默认budget仅零成本fixture | 重启/多实例不持久；不能声称付费去重/费用预留。localStorage不升级为权威账本 |
| 现有持久费用账本 | [unified-ledger.mjs L68](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/paid-gateway/unified-ledger.mjs#L68)fsync+rename，exclusive lock、reserved/settled/uncertain、重启reserved转uncertain；L20固定deepseek-flash token价格，customer/agent-test账户 | 不是“仓库完全没有持久账本”，而是图像未绑定此账本。供应商/币种/按张计价/可信project/global预算/持久job结果与对账未实现。不可重用历史DeepSeek额度 |
| 供应商预备schema | [supplier-contract.mjs L7](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/supplier-contract.mjs#L7)Qwen请求构造；16KiB响应文本、usage/单结果/host校验，输出NEEDS_BOUNDED_DOWNLOAD与UNRECONCILED | 它不下载、不校验图像、不证明供应商费用已结算。响应传输本身有界读取和真实POST仍缺失 |
| PNG与部署 | [validation.mjs](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/validation.mjs)只接受MOCK、512KiB、16M像素，inflate可达约64MiB；[Dockerfile](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/Dockerfile)只打包精选运行目录；[ms_deploy.json](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/ms_deploy.json)ModelScope Docker/7860 | 未证明部署区域、持久磁盘、图像模块打包、密钥配置和网络资格；本轮不部署，不检测生产密钥 |

候选/采用、共享owner、IndexedDB CAS/receipt、B/C投影、JSON/ZIP、格式限制、旧项目与回滚的逐文件证据见 [contract.md](contract.md)。主要新增发现：ProjectAsset无完整provenance且拒绝未知字段；通用旧导入缺预decode像素阈值/deadline；前端非Canvas结果均标Mock。不得把REAL图像塞入现有Mock通道。

## T2 / T3 记录

- [供应商比较与费用](providers.md)：官方查询日期、模型/endpoint/鉴权/格式/费用/审核/保留/地区/不确定性。首选推荐Qwen pinned2.0 Singapore（$0.035/张），备选GPT Image2.5 Flare固定版本（按token；规划假设$0.065不等于实价/上界）。提议最多3次/$0.25，只是待审批设计。
- [T3完整提案](contract.md)已[发布#92](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6496938470)。独立Workshop角色实际读回并给出[限定ACK](workshop-ack.md)，并非原作者同意共享schema升级。
- 新候选严格子集：PNG<=524288字节、单边<=1024、<=1,048,576像素、8bit非交错灰/RGB/灰alpha/RGBA，仅IHDR/连续IDAT/IEND；inflate<=4,195,328字节。保持旧512KiB/总1MiB/32资产限制。它是新入口限制，不追溯改变旧资源。
- PNG模块检查签名、chunk类型/边界/CRC、色型/位深、尺寸一致、完整单zlib数据/scanline/filter，无尾随数据；canonical Base64先限长再decode。返回owned bytes+sha256+尺寸，不声明来源、审核、费用或已经采用。
- 下载模块空主机名单默认拒绝，配置必须服务端独占；只GET精确HTTPS域名、public IPv4、DNS全部结果验证后pin到单IP，原TLS hostname验证、agent:false、拒redirect/压缩；headers16KiB、body512KiB、全过程最长10秒、单实例并发1，真实close/DNS结束前不释放槽；无自动retry、auth/cookie、key/env读取或provider POST。错误只含固定内部code，URL/上游信息不传播。
- 不支持IPv6/双栈CDN、JPEG/WebP、palette/interlaced/metadata PNG；不能称通用归一化。512KiB未必容纳真实1024图；超限拒绝并保留未来账本费用，不能重生。4MiB scanline不是RSS硬限制；完整生产decoder隔离与进程级资源限额仍缺失。没有任何模型或CDN网络调用验证。

## 可审查的实施顺序、唯一所有权与预算设计

| 步骤 | 唯一实现负责人/文件范围 | 交付条件/状态 |
|---|---|---|
| P1 当前准备 | Supervisor/Image-Backend：新增preflight/**、tests/image-preflight/**、新image-preflight.yml、本docs目录 | 已实现离线安全模块，不导入现有运行链路；独立QA检查精确SHA |
| P2 资源/REAL协议RFC | Supervisor作为唯一Resource-Contract owner；Workshop审查接口、Cost审查安全、QA审查迁移矩阵 | BLOCKED具体版本RFC尚未ACK；先定义REAL discriminant、费用独立状态、按幂等键恢复接口、完整provenance及新旧格式读取，不直接改共享文件 |
| P3 可信身份/项目与持久账本 | Image-Backend，另行隔离分支；不并改Workshop/model文件 | BLOCKED部署和授权基础设施未确认；须可信session→user→serverProject ACL，操作时重新授权，不能信任浏览器projectId |
| P4 真供应商适配器 | Image-Backend；选择获批固定model/region/endpoint；依赖P2/P3 | BLOCKED具体供应商未批准；缺配置或审批拒派发。服务端有界POST/response、单次egress、敏感错误映射，结果经安全校验；不以推荐意见作为授权 |
| P5 REAL图库 | Image-Workshop独占http/controller/panel；Resource-Contract owner独占model/IDB/JSON/ZIP | BLOCKED新协议/元数据RFC未ACK；复用owner/CAS/receipt，预览不保存，明确REAL来源，按字节hash去重且定义来源冲突；刷新只查询，不新key重发 |
| P6 验收 | 独立QA新checkout、精确HEAD | OFFLINE/MOCK与REAL分开；首次真实一次生成核对图片/账单后才能继续；未知费用停后续派发；merge/deploy单独审批 |

持久账本计划（尚未实现，不伪装已安全）：

1. 绑定approvalId、固定供应商/模型/区域/币种/价目版本/失效时间、user/project/global限额、测试范围和次数。所有金额以整数最小单位存储；不得将美元直接记入已有人民币账本。账户/项目来自可信resolver与服务端ACL。
2. 原子事务唯一键 `(approval,user,serverProject,idempotencyKey)` 与canonical请求hash；同key同payload只读回放，同key异payload409。事务同时检查额度、未知费用栅栏、持久并发claim，写job+reservation+dispatch-intent后commit/fsync，再允许最多一次egress。
3. 崩溃窗口（已写dispatch但未获结果）只可标UNKNOWN，重启不重发；不承诺跨网络exactly-once。取消/超时/断连/供应商429或5xx不能自动退费或retry，除非可信证据证明未派发且持久状态支持；默认未知保留全部预留并冻结批准范围。
4. 输出成功、下载/校验/审核/采用失败与费用是两条独立状态机；图片TTL不清债。账单/usage不等于自动可信结算；记录供应商请求ID/价格摘要/保守预留/结算证据，明确receipt vs cost estimate。确认费用前不放行下一次付费。
5. 持久记录含opaque IDs、request hash、时间、状态、金额及最小错误code；不记录key、signed URL、敏感图片/完整提示词。provenance是用户项目资料，另设隐私和导出说明，不用服务端日志冒充可携带元数据。
6. 单实例首先采用可靠持久事务存储，必须验证锁/崩溃恢复/磁盘故障与部署持久卷；多实例前用数据库事务唯一索引和租约/不可重派发状态。不能拿一个内存Map+布尔approval宣称生产权限可靠。

## 测试矩阵与复现

当前功能源码SHA `26a97e3eac2ff5f816621c2265b29e4ae4a0a804`，若后续有功能修复，见独立QA最终报告与最终git HEAD。所有脚本使用新工作区/浏览器context，无个人storage或真实密钥。

环境：Darwin arm64，Node v24.22.0，npm11.19.1，TypeScript5.9.3；浏览器Playwright1.62.1，具体Chromium版本及运行SHA记录在browser报告。`npm ci --offline --ignore-scripts --no-audit --no-fund` exit0。

- 新模块：`node --test --test-timeout=5000 tests/image-preflight/*.test.mjs` →11/11，exit0，纯注入DNS/HTTPS，不访问外网。独立QA另有边界/故障探针和唯一结论。
- 三处typecheck、build、npm test、server test、原Provider/HTTP协议、JSON/ZIP/B-C/export回归：完整argv/exit在[checks.json](checks.json)，每命令原始日志保留。分别224/37/26/117测试通过。构建保留原有bundle>500kB warning。
- 桌面/390px HTTP Mock，固定Mock，Canvas及生产关闭：完整命令/环境/退出码见[browser-checks.json](browser-checks.json)，这不是REAL验收。生成/预览/丢弃/采用/B-C/刷新/JSON/ZIP使用既有实际loopback测试；图片hash/无外网记录在报告里。未改前端因此无需重写相同断言。
- 新CI仅运行注入transport测试，权限contents:read、无secret、无需npm依赖。现有HTTP CI仍负责Mock闭环。最终PR的CI状态以GitHub报告为准，不能把本地执行当CI。

未来必须新增的验收：持久预算并发抢占/重启/磁盘损坏/未知费用；user/project ACL越权；新REAL source拒入Mock；provider响应有界body/安全错误/真实账单；schema新旧版本/完整Unicode provenance round-trip/hash去重冲突；超限/metadata/非PNG归一化隔离；取消/刷新/卸载/跨tab重入与旧回调；真实桌面/390px整链路。

A当前OFFLINE/MOCK以实际日志判定；B真实隔离 **BLOCKED/NOT_RUN**；C真实独立E2E **BLOCKED/NOT_RUN**。本轮独立QA ACCEPT只可限定到新增准备模块。

## 回滚与审批边界

本PR仅新增文件，回滚可关闭未合并Draft或删除新增模块/测试/workflow/docs；旧项目和协议无迁移。无运行路由导入，既有采用资源不受影响。未来schema升级不得通过降版本/删除provenance回滚用户数据，应保留旧项目及可读的新reader；未知账单不因回滚删除。

本轮无需追加授权。后续需要明确：供应商/固定模型/region/测试范围及最高费用（PAID_API、BUDGET），受保护的服务端密钥配置（SECRET），生产可信身份/project/持久存储的部署决策，以及各自MERGE/DEPLOY批准。当前未配置审批额度，不要求用户把任何Key发到聊天。未就绪的安全基础设施先完成，不用提前付费试调用验证猜测。

## 排障记录

- `gh --version`：`zsh:1: command not found: gh`，exit127；`command -v gh`未找到。依据[GitHub CLI官方macOS安装说明](https://github.com/cli/cli/blob/trunk/docs/install_macos.md)确认这是可执行文件不可用，而非GitHub认证失败；改用已连接GitHub工具读取/评论/PR，无安装、无凭据读取。git2.50.1、Node24.22.0/npm11.19.1已记录。
- 首次`rg --files ... tests/image-generation`：`rg: tests/image-generation: No such file or directory (os error 2)`，exit2；后一次路径猜测的`server/index.ts`、`server/src`、`docker-compose.yml`、`compose.yaml`同样报不存在，exit2。完整错误保留在执行记录。只读`rg --files server tests`确认实际index.mjs与tests/image-backend/image-http-contract。依据[Node官方ENOENT语义](https://nodejs.org/download/release/v25.4.0/docs/api/errors.html)及文件清单将原因限定为错误路径；未改产品规避、未重复试探不存在路径。初次搜索无AGENTS匹配返回1为rg正常无匹配，父目录AGENTS已另行读取。
- GitHub fetch_pr首次参数名不符合connector schema，明确提示repo_full_name缺失；读取工具声明后修正结构化参数成功，不视为认证故障。
- 新模块首轮11项全部通过；其余研究和独立QA各自排障见对应报告，不能把自编探针或缺构建产物失败隐去。

## 本轮独立结论与浏览器实测汇总

[独立QA完整报告](qa/REPORT.md)：精确功能SHA `26a97e3eac2ff5f816621c2265b29e4ae4a0a804`，唯一结论 **ACCEPT（仅隔离准备模块）**；11/11新增、9/9独立探针、26/26旧合同、类型检查通过。独立探针可在任意检出本SHA的目录运行：`QA_SOURCE_ROOT="$PWD" node --test --test-timeout=5000 docs/acceptance/image-phase2-preparation/qa/independent.mjs`。包含精确512KiB/+1、压缩炸弹、迟到DNS/response、close前槽保留，以及故意在DNS回调报错、建连前停止的原生https pin消费测试。不是实际CDN/TLS握手验收。

Supervisor另行执行、不是QA代跑的浏览器结果：Chromium151.0.7922.34；桌面HTTP Mock27/27、390px HTTP Mock27/27、固定Mock16/16、Canvas14/14；四组externalRequests/aiRequests/pageErrors均0，报告原件已保存。已目检390px候选页，控件在视口内；1x1白色预览是原固定HTTP fixture，不能称模型成图。截图/trace/下载原件位于本工作区 `.cache/phase2-preparation/`，报告JSON在本目录；未把本地目录称公共下载链接。

构建开启 `VITE_IMAGE_HTTP_FIXTURE=1` 后再次跑production测试的命令与退出码另存production-flag-checks.json；验证编译flag也不能把真实生产图像路由打开。源码散列见source-sha256.json。后续文档/新workflow提交不改变本次接受的两份安全模块字节；最终PR HEAD和CI在#92结案评论单独记录。
