# ModelScope 首次无密钥部署准备包

状态：`BLOCKED — INITIAL MODELSCOPE DEPLOYMENT NOT COMPLETED`

目标空间：<https://www.modelscope.cn/studios/Nanmuxxx/BlockCraft-AI-Fullstack>

负责人于 2026-10-20 00:20（北京时间）确认：空间已创建，尚未部署任何内容，当前停留在“空间文件”步骤。因此当前没有可用的公网 revision、运行日志或旧镜像可用于验收/回滚。本文件只准备首次部署方案；未上传文件、推送 Studio、触发构建、启动或公开空间，也未设置变量或调用模型。

目标空间唯一确认为 <https://www.modelscope.cn/studios/Nanmuxxx/BlockCraft-AI-Fullstack>。其他所有者/Space 的历史状态、分支或 overlay SHA 不能视为该目标的基线；上传页面能力及隐藏文件保留能力尚未验证，以 Owner 登录后看到的真实 UI 为准。

## 固定候选

- GitHub `main`：`4a95cae50f772cd242d932cdbd93366381d1df74`
- Git tree：`b19a52f8cdc82aa137b57a1396f996b6becfda3f`
- ModelScope 配置：根目录 `ms_deploy.json`，`sdk_type=docker`、`port=7860`、当前 `resource_configuration=platform/2v-cpu-16g-mem`
- Docker 入口：根目录 `Dockerfile`，Node 24 多阶段构建，最终执行 `node server/index.mjs`

### 后续候选状态（2026-10-20，只读核对）

上述部署包仍只对应历史 `main` SHA `4a95cae50f772cd242d932cdbd93366381d1df74`；不能把它描述成已包含下列 Core/Gateway 候选，也不能把旧 ZIP 直接用于新候选部署。

| 对象 | 精确 SHA / 状态 | Docker 相关核对 | 部署含义 |
| --- | --- | --- | --- |
| 当前 main / PR #65 ZIP 来源 | `4a95cae50f772cd242d932cdbd93366381d1df74`；ZIP manifest 同源 | Dockerfile、`.dockerignore`、`ms_deploy.json` 静态检查绑定此 SHA | 历史无密钥 Docker 准备基线，不代表 ModelScope 已构建或运行 |
| PR #65 文档分支 HEAD | `16118857f112fccf2bda070f1533f9f0ea466b4a`；OPEN/Draft | 仅部署文档/证据变动；没有因此触发 Docker acceptance workflow | 不能当成产品代码 SHA 或平台部署 revision |
| PR #68 冻结候选 | `d6f2cb4f110d22f665690e3af1d818249cc03b99`；OPEN/Draft | 相对历史 main 的 Dockerfile、`.dockerignore` 和 `ms_deploy.json` 无变化；包含服务端付费网关模块 | Docker 打包规则看起来可包含该模块，未对该 SHA 做镜像构建或平台验收 |
| Core follow-up | `8aedff514dce3a2d2882a37bb29888892a0a376f`；独立 follow-up，未纳入冻结 PR #68 | 相对 PR #68 仅变更 `server/index.mjs`、`server/aiGenerationPrompt.mjs` 和两项测试；Docker 配置文件无变化 | 仍是未冻结候选；不得重打包或上传，需 Core/Gateway/QA 完成各自门禁后由负责人指定最终 SHA |
| Gateway 限额复核 | PR #56 现有 HEAD `7d00712a2e11494eac9cd2e5bf83fb147d553d56`；新的候选 SHA 尚未提供 | 当前 PR #56 不能证明其与 Core follow-up 的组合验收 | 等 Gateway 提供精确组合 SHA 和 owner/QA 证据；不能据旧限额实现打开付费路径 |

### P0 Pomodoro integration candidate (2026-10-20)

The exact owner-local-smoke candidate checked for Docker packaging is `7fb98ffd401d08fcc4188a03619fb420860cc2eb` (tree `d37cad7cc4d9e8235484f959ebb76eee1c0d5e8f`), based on the unchanged `main` SHA above. This is a local integration candidate, not `main`, a merged PR, or deployment authorization. Relative to `main`, `Dockerfile`, `.dockerignore`, `ms_deploy.json`, `package.json`, `package-lock.json`, and `server/package.json` are byte-for-byte unchanged. ModelScope remains configured for Docker port `7860`; the candidate adds no platform deployment evidence.

Static runtime review of this exact candidate found the production entry binds `0.0.0.0` and defaults to port `7860` (overridable by `PORT`). The Docker runtime copy rules include `server/index.mjs`, trusted-interactive sources, generated AppSpec validator output, the Mochi integration tree, and all `server/paid-gateway/*.mjs` modules imported by the entry. The build stage runs both frontend and server builds before copying generated validator output. The HTTP health route is `GET /api/health`; the Docker `HEALTHCHECK` probes it from `127.0.0.1` inside the container. `startServer()` does not construct a paid runtime unless an explicit trusted identity composition is supplied; the ordinary entry does not supply one. In the default configuration, both v1 and v2 generation requests are rejected with `401 UNAUTHORIZED` before provider access. These are source/configuration findings only, not a built-image or live-container result.

Independent QA's latest report (#57 comment `6274257308`) records the integrated Gateway Mock UI flow as scoped evidence, but the full paid-gateway regression suite is `38/53 PASS` with 15 failures. This is a product/release blocker and does not change Docker packaging evidence into product or deployment GO. The local Docker command is unavailable (`docker: command not found`); no Docker build, image ESM import check, container health check, or HTTP smoke was run for `7fb98ffd…`. Preserve these as `NOT TESTED` until a Docker-capable environment runs them against the exact frozen candidate.

### PR #75 Docker acceptance update (2026-10-20)

This newer evidence is bound to PR #75, not to the older `7fb98ffd…` local candidate above:

| Object | Exact SHA / status | Docker evidence | Boundary |
| --- | --- | --- | --- |
| Current `main` | `4a95cae50f772cd242d932cdbd93366381d1df74` | Still unchanged | PR #75 is not merged and is not `main` |
| PR #75 HEAD | `d9ec5b36e633748e5be4d9657cb95ccfe2eb3d3c`, OPEN/Draft | Tree `4b31a7591bc98a2a978fb2f17c787700c1304d4e` | Local real Pomodoro result is LOCAL ONLY |
| Actions Run `39303561834`, job `118234717724` | SUCCESS; actual checkout was merge commit `18babbe` on `main` + `d9ec5b3` | Regressions passed; image built; 18 final-image ESM imports resolved; container became `healthy`; 7 resource/route HTTP smoke checks passed; anonymous v1/v2 returned `401 UNAUTHORIZED` | No browser product flow, ModelScope deployment, HTTPS, or public generation was tested |

The Run evidence is recorded in [GitHub Actions](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39303561834) and the latest applicable coordination decision, #57 comment `6274503083`. The CI checkout is an ephemeral PR merge commit; the tested PR tree matches exact HEAD `d9ec5b36…`, while `main` remains `4a95cae…`. These findings supersede the earlier Run `39302430003` failure (server 38/39, image/smoke skipped) and the earlier `39303561834` in-progress snapshot in comments `6274485524`/`6274499845`.

The Core compatibility fix `8d54aeec810981f2afac1c07e176830d86037a13` and Gateway tests-only update `95eba6511755a2621ac131467b853b07bd9226d3` remain independent, unintegrated commits. Gateway reported 51/53 on its standalone tests candidate, retaining two CustomBlock 8192-vs-2048 contract failures until the Core fix is integrated; neither commit is represented by the PR #75 Docker run above. No new local Docker check or CI rerun was performed for this document update.

Agent C independently accepted the Docker conclusion as **DOCKER GO, limited to tested scope** in `/Users/nanmuxun/BlockAI/BlockCraft-AI-pr49-r2-qa/DOCKER-HANDOFF-INDEPENDENT-REVIEW.md`; that review does not grant product or deployment approval. The ModelScope status remains `BLOCKED`: no upload/build/run, no HTTPS or target-space ACL/Secret boundary evidence, no verified single-instance persistent POSIX ledger volume, and no deployment authorization. The local Docker executable also remains unavailable, so the cloud Actions result must not be described as a ModelScope or local-container test.

只读源码差异显示 Core follow-up 在 `startServer()` 中仍默认不构造 paid runtime；只有显式提供可信 principal resolver，或启用 `AI_GENERATION_IDENTITY_MODE=opaque-session` 并提供 allowlist，才进入该组合。可执行入口在 `NODE_ENV=production` 时绑定 `0.0.0.0`，端口取 `PORT`，默认 `7860`。这些是精确候选源码检查，不是构建或目标平台运行证据。该 follow-up 加入 `AI_GENERATION_BINDING_KEY` 的严格配置读取；opaque-session 模式还要求 `AI_GENERATION_SESSION_ALLOWLIST_PATH` 指向绝对路径、权限受限的文件。它们是付费组合的敏感运行配置，当前不应设置或注入。

PR #68 的定价快照在代码中标为 `2026-10-19`，并设置 `expiresAt=2026-10-20T00:00:00+08:00`；截至本手册日期该快照已到期。未重新核验官方价格并获得独立批准前，任何 Gateway paid runtime 都必须保持关闭。当前没有 Gateway 新候选精确 SHA；容器单实例、持久 POSIX 卷、权限、账本/claim 恢复和平台关闭信号语义也均未验证。

PR #65 所记录的历史 CI/Docker 证据不能替代 PR #68 或 `8aedff…` 的镜像构建。本文本轮没有运行 Docker/Compose、没有重打包 ZIP、没有改 CI，也没有上传或部署 ModelScope。

上述 SHA 由本次 `git ls-remote origin refs/heads/main` 及 `git fetch origin main` 核验。它是部署候选源代码版本，不是 ModelScope revision；平台首次接收后会产生自己的提交/revision。资源档位的费用/配额必须由负责人在平台确认，不因配置文件存在而推断免费。

## 精确文件边界

将以下项目根路径同步到 Studio 仓库根目录。`src/`、`public/`、`server/` 必须递归包含；不得漏掉隐藏文件 `.dockerignore`。

```text
.dockerignore
Dockerfile
ms_deploy.json
package.json
package-lock.json
index.html
vite.config.ts
tsconfig.json
src/**
public/**
server/**
```

这是 Dockerfile 构建所需输入的允许列表，不要求上传测试、文档或开发工具。Dockerfile 使用 `npm ci`，运行 `npm run build` 与 `npm --prefix server run build`，然后复制前端 `dist/` 和挑选的服务端模块进入 Node 24 runtime。`.dockerignore` 是构建隔离边界，必须原样保留；其中排除 `.env`、凭据/密钥扩展名、日志、`.git`、`node_modules` 和生成目录，并只允许列出的构建源进入 context。不要为了上传而移除/放宽它。

负责人在授权后的本地同步路径：

```sh
git clone https://github.com/Nanmuxxx/BlockCraft-AI.git blockcraft-source
cd blockcraft-source
git checkout --detach 4a95cae50f772cd242d932cdbd93366381d1df74
git status --short
```

网页完整目录上传和 ZIP 自动解包能力均为 `NOT TESTED`；不得假定网页会递归上传目录或保留隐藏的 `.dockerignore`。由 Owner 登录目标 Space 后以实际 UI 确认可用操作及隐藏文件处理。若网页不能可靠保留仓库根目录布局和 `.dockerignore`，停止网页上传路径并由 Owner 评估平台 UI 所提供的 Git 流程；不得在未授权时上传。若使用页面显示的 Git clone URL，复制该目标 Space 的 URL 并使用页面显示的默认分支，不猜测仓库地址、分支或认证方式。将上方允许列表从固定 SHA checkout 同步到该 Studio checkout 根目录，保留已有 `.git` 和平台文件，检查 `git status --short` 与 `git diff -- .dockerignore Dockerfile ms_deploy.json package.json package-lock.json index.html vite.config.ts tsconfig.json`。由负责人确认 SHA、文件列表、无密钥后再决定下一步。不要使用 token-in-URL，不要 force push，不要添加 `.env`、本地构建产物或凭据。

**push 可能触发平台 Docker build/deploy。** 因而上述 clone/copy/status 可用于离线准备；真正的 `git push`、网页“部署/启动/发布/公开”按钮和资源档位变更，必须等待项目负责人对目标与动作的单独明确授权。本方案不替代该授权。

## 平台页面步骤（授权后由负责人操作）

1. 打开上述目标空间的“空间文件”，确认所有者/空间标识仍匹配目标；以 Owner 登录后的真实 UI 确认上传能力、目录布局和 `.dockerignore` 保留方式。上传/部署动作仍须单独授权。若使用 Git，使用页面显示的 clone URL 和默认分支。
2. 检查 SDK 为 Docker、监听端口为 `7860`，配置文件与目录结构如上。ModelScope 的 Docker 说明要求根目录 `Dockerfile`、外部服务监听 `0.0.0.0:7860`；本仓库 `ms_deploy.json` 端口值为 `7860`，Dockerfile 声明 `EXPOSE 7860`。
3. 负责人确认当前资源档位及其费用/配额后再保留或调整。不得因为页面预选了某档位就假定无费用；不得切到付费硬件。
4. 仅在收到单独部署授权后才 push 文件并触发首次构建。首次验证保持私有/受限；不得操作可见性为 public 的开关。
5. 在空间状态页等构建完成。先看 build 状态/日志；容器运行后再看 run 状态/日志。首次构建预计数分钟，超时或失败按下一节处理，不重复盲目触发。

ModelScope 官方部署参考：<https://modelscope.cn/docs/studios/docker>（本次浏览工具无法打开该具体文档页）；ModelScope 官方站点部署说明的可检索镜像明确写明 Docker 以根 `Dockerfile` 为入口、端口 `7860`、绑定 `0.0.0.0`，并区分上传/部署、build/run 日志和 push 后更新流程：<https://modelscope.cn/skills/modelscope/modelscope-studio>。部署页面实际字段和克隆命令优先于本手册中的推测；如页面与此处不一致，停止并让负责人核对，不猜平台行为。

## 无密钥配置与默认拒绝

首次离线验收**不配置任何环境变量**：

| 变量 | 首次无密钥部署 | 理由 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 不设置 | 无授权密钥；不得占位、粘贴或写入构建参数/仓库 |
| `PUBLIC_ORIGIN` | 不设置 | 空值是安全默认值；它只约束来源，不是身份凭据 |
| `DEEPSEEK_MODEL` | 不设置 | 不需要模型选择；缺密钥且缺服务端授权时，不能产生模型调用 |
| Studio secrets / variables | 不配置 | 此轮没有任何秘密或运行配置需要注入；平台权限边界未验收 |

## Secret、代码执行与日志权限边界

ModelScope 官方 `modelscope-studio` 技能文档描述了 Studio Secret 接口：列表只返回 Secret 键、不返回值；普通变量列表会返回值。该接口行为说明 Secret 值不可经列表 API 读回，但不能证明所有有权修改代码、部署空间、执行容器或查看运行日志的主体都与 Secret 管理权限隔离。官方文档同时列有部署/停止和 build/run 日志读取接口。当前没有目标空间的角色权限矩阵、成员清单或运行时访问控制证据。

| 能力/边界 | 当前证据 | 判定 |
| --- | --- | --- |
| Secret 列表不返回已保存的 Secret 值 | 官方 Studio 文档说明 Secret list 只返回 key；此处没有实际调用目标空间 API | 文档能力已核对；目标空间 `NOT VERIFIED` |
| 普通变量是否可能暴露值 | 官方文档说明普通 variable list 会返回 key/value | 不得将普通变量用于凭据 |
| 谁可新增/替换 Secret、同步代码或部署 | API 文档提供相应操作，但目标空间成员/角色 ACL 未核实 | `NOT VERIFIED` |
| 谁能 exec/进入容器或读取进程环境 | 未找到目标空间权限配置或实测证据 | `NOT VERIFIED`；不能以 Secret 列表隐藏值推断运行时隔离 |
| 谁能读取 build/run 日志，以及日志是否脱敏 | 官方文档提供日志接口；目标空间授权和脱敏行为未核实 | `NOT VERIFIED` |
| 代码是否能读取运行时环境变量 | 部署代码在运行时执行；平台 Secret 是否以环境变量注入及其进程可见性未针对目标空间验证 | `NOT VERIFIED`；允许不受信任 Agent 修改/执行代码时，视为 Secret 可被该代码读取 |

因此，**仅配置平台 Secret 或环境变量不足以形成 Agent 与密钥的安全边界**。在负责人实际确认平台 ACL 前，不得在 ModelScope 配置 DeepSeek key，也不得让可读取环境、执行命令、修改运行代码或查看未脱敏敏感日志的 Agent 账号接触该空间。Secret 只由负责人在其独占控制面输入；不得通过聊天、Issue、PR、命令参数、日志或仓库传递。

若平台无法证明所需隔离，使用负责人独占控制的独立后端控制面：负责人独占云账号、代码部署、shell/exec、环境和日志管理权限；Secret 只注入该后端，Agent 不得拥有该后端的 shell、环境变量、Secret 或敏感日志权限。Agent 仅调用经过认证、固定路由的 API；后端验证调用身份并在服务端访问模型，不向 Agent 返回密钥或上游 Authorization。该替代方案需要单独设计、独立验收和负责人授权，不表示目前已建成或可用。

官方能力参考：[ModelScope Studio 文档](https://modelscope.cn/skills/modelscope/modelscope-studio)。本次核对的是公开 API/技能说明，不是目标空间 UI/ACL 检查；因此目标空间的 Secret 保护、exec、日志读取和成员权限仍全部标记 `NOT VERIFIED`。

## 真实调用预算策略准备（未启用）

负责人最新决定约束任何未来候选策略：共享预算总上限人民币 `¥20`；首轮最多 3 次上游请求、并发 1、每次输出最多 2048 tokens，禁止自动重试。真实账本不可由 Agent 修改、清空或重置。此处只记录候选政策边界，不是已实现的 Gateway 限额、真实账本配置、Key 注入、付费授权或部署批准。

负责人提供的首轮子限额建议为 `¥0.50`。按其价格快照与保守输入上界 73728 tokens 估算：若 cache-miss 输入为 `¥2/百万 tokens`、输出 `¥8/百万 tokens`，且输出上限 2048，则单次理论上界 `¥0.16384`，3 次合计 `¥0.49152`。这只是待核验的算术建议；输入上界、计费口径、usage 可信性和运行时硬限制均未独立验证，不能视为可靠的费用上限。

价格页：[DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。负责人报告的抓取快照为 deepseek-flash / V4.1-Flash-1017，HTML SHA-256 `556097caba8adfeeed6455714bffd731c7f60db520fcee06a922eba5840663a3`，保守价格为输入 `¥2/M`、输出 `¥8/M`。须由 Gateway 与 Tech Lead 独立复核并给出短有效期候选政策；旧政策的 `PRICING_EXPIRED` 不自动延长。核验完成前，实际 Key 和付费调用继续 `NO-GO`。

精确 main 的 `server/index.mjs` 在解析请求体和访问 Provider 前，对 v1 与 `trusted-interactive/1` 都调用 `authorizeGeneration`；可执行入口 `createAppServer()` 未注入 `generationAccess`，因此默认匿名拒绝。服务端还要求 `apiKey` 非空才会调用生成。此结论限定于冻结 SHA 的源码和默认启动方式；不能推论未来配置了授权 adapter 后仍然匿名拒绝。`PUBLIC_ORIGIN`、CORS、Host、Origin 或 XFF 都不能替代身份验证。

## 付费账本卷：当前不具备部署证明

当前冻结 main 的无密钥首次 Smoke 不启用付费网关，也不需要账本卷。若后续部署集成 Gateway 的候选版本，必须先满足 Gateway 的存储契约；ModelScope Studio 的 Docker 配置或“可挂载目录”选项本身不能证明这些语义。目标平台目前未实际部署或探测，下表全部是能力缺口，不是已通过项。

| 要求 | 当前目标平台证据 | 判定 |
| --- | --- | --- |
| 严格单实例、单进程，不横向扩缩容 | 无部署 revision 或运行时配置证据 | `NOT TESTED / BLOCKED` |
| 同一持久本地 POSIX 卷跨容器重启保留 | 未部署；挂载类型与重启保持行为未知 | `NOT TESTED / BLOCKED` |
| exclusive-create、atomic-rename、fsync、独占锁语义 | 未在目标挂载上执行探测 | `NOT TESTED / BLOCKED` |
| 账本目录预建且权限 `0700`；ledger/lock 文件 `0600` | 无平台运行时 owner/mode 证据 | `NOT TESTED / BLOCKED` |
| Core drain 后再关闭/释放 sidecar 与 ledger 锁 | 当前 main 不包含 Gateway 组合；目标运行时未验证关闭信号顺序 | `NOT TESTED / BLOCKED` |

因此：当前可讨论的技术 GO 仅限**不配置 secrets 的容器可达性 Smoke**。若后续候选启用持久预算账本，在这些条目得到目标环境证据前，付费/公开生成保持 `NO-GO`。Gateway 要求单进程及 POSIX 本地持久卷，不得用共享网络存储或多副本替代。stale lock 或未决 reservation 必须交由人工对账；严禁删除锁、清空账本或重置账本来“修复”启动。

## 验收步骤与通过标准

仅在获批首次部署后执行。不得点击会发起生成的产品流程；不做 DeepSeek、付费或外部推理调用。

1. **构建**：平台 build 状态成功，记录 Studio commit/revision、build 时间、退出状态与日志链接；确认没有凭据被写入 build output。无构建日志或 revision 时标 `NOT TESTED`。
2. **健康**：先由目标 Space 页面取得实际应用 URL/origin；使用该实际应用 origin 请求 `GET <APP_ORIGIN>/api/health`，预期 HTTP 200 JSON `{"status":"ok"}`。`/studios/...` 管理页 URL 不是可假定的应用 origin，不能把管理页 URL 与 `/api/health` 拼接并当成验收地址。若 Owner 尚未提供/确认实际应用 origin，记为 `NOT TESTED`。
3. **静态页**：用页面给出的实际应用 origin 检查 `/`、`/ai-create`、`/app-renderer` 均返回页面，不是 404；浏览器确认 CSS/JS/字体资源加载，页面无白屏或 uncaught page error。不得点击会提交生成请求的按钮。没有实际应用 origin 时记为 `NOT TESTED`。
4. **匿名 v1 拒绝**：同源 `POST /api/ai/generate`，`Content-Type: application/json`，body `{"idea":"offline smoke"}`，期望 HTTP 401 且 `error.code=UNAUTHORIZED`。
5. **匿名 v2 拒绝**：同源 POST 同路径，body `{"idea":"offline smoke","protocol":"trusted-interactive/1"}`，期望 HTTP 401 且 `error.code=UNAUTHORIZED`。
6. **模型隔离**：确认 Studio 环境变量和 Secrets 中无 `DEEPSEEK_API_KEY`，浏览器网络记录/服务日志无 DeepSeek 请求。401 必须在 Provider 前返回；不能用返回 503 的缺配置代替 401 断言。

构建通过只表示镜像构建成功。空间页面健康、静态资源、两个 401 断言和零模型调用需分别记录；尚未运行的项目都记为 `NOT TESTED`，不得以 Docker 历史 CI 替代 ModelScope 验收。Dockerfile 自带健康检查每 30 秒用 Node fetch 请求容器内 `/api/health`，非 2xx/网络失败则退出 1；平台是否读取 Docker HEALTHCHECK 仍需目标空间观察。

## 失败处理和首次失败回退

- **没有旧 revision**：这是首次部署，不能回滚到不存在的线上版本。保留首次失败的 Studio commit SHA、build/run 日志、时间和状态；不要删除空间、重建空间、force push 或清理证据。
- **Docker build 失败**：先保存完整 build log 和精确 Studio commit。`COPY failed` 对照本手册白名单和仓库根路径；安装失败对照 `package-lock.json` 与 `npm ci`；镜像拉取失败记录 base image 错误。由 Docker owner 准备最小文档/Docker 修复候选，Tech Lead 检查后再等负责人授权推送下一 commit。
- **build 成功但运行失败**：保存 run log；核对监听 `0.0.0.0:7860`、`PORT` 与健康检查。不要注入 API key 来“修复”启动。
- **健康/页面/API 断言失败**：停止后续验收，记录状态码、响应体（脱敏）、浏览器错误及对应 revision；不要尝试更改 auth、CORS 或公开设置绕过问题。
- **需要停止**：如空间已经在授权后启动但验证失败，由负责人使用 Studio 页面停止/暂停选项，并在 #57 报告。只有首次部署时不存在 rollback 镜像；恢复只能基于 reviewed 修复 commit，另行批准后提交和重建。
- **后续有已验收版本时**：每次保存源 SHA、Studio commit、构建时间及平台 revision。回滚基于平台支持的已知好 commit/revision 和 Owner 确认步骤；不使用浮动 `latest`、不 force push、不重建旧 tag 冒充原制品。

## 当前验证状态

| 检查 | 状态 | 证据/限制 |
| --- | --- | --- |
| PR #75 cloud Docker acceptance | PASS（限定 CI 范围） | Run `39303561834` / job `118234717724`；checkout merge commit `18babbe`，合入 PR #75 HEAD `d9ec5b36…`；不代表 main 或平台部署 |
| PR #75 最终镜像 ESM / health / HTTP smoke / 匿名 v1/v2 | PASS（限定断言） | 18 imports、healthy、7 smoke checks、匿名 API 401；浏览器、完整对抗矩阵及公网流程 NOT TESTED |
| PR #75 当前 GitHub main 覆盖 | NOT TESTED | PR #75 为 OPEN/Draft，未合并；main 仍 `4a95cae50f772cd242d932cdbd93366381d1df74` |
| PR #75 Core/Gateway 离线回归补丁集成 | BLOCKED / NOT TESTED | Core `8d54aee…` 与 Gateway `95eba65…` 是分开的未集成提交；PR75 CI 不含这两个提交 |
| main SHA/tree、Dockerfile、`.dockerignore`、`ms_deploy.json`、启动监听及默认匿名拒绝 | PASS（静态源码核查） | SHA `4a95cae…`，tree `b19a52f…`；不表示平台实际运行 |
| owner-local-smoke `7fb98ffd…` Docker 文件/依赖清单比较 | PASS（静态 diff） | tree `d37cad7…`；Dockerfile、`.dockerignore`、`ms_deploy.json` 与 Node 依赖清单相对 main 未改；候选尚未冻结 |
| `7fb98ffd…` Docker runtime import/copy 覆盖、端口绑定、health route、匿名 v1/v2 拒绝 | PASS（静态源码核查） | 运行时需要的 server 模块包含在现有复制规则中；生产入口 `0.0.0.0:$PORT`，默认 7860；不代表 ESM 在最终镜像内已执行 |
| `7fb98ffd…` Docker image build、最终镜像 ESM import、容器 health、HTTP smoke | NOT TESTED | 本机无 Docker executable；未找到 Docker 兼容 runtime；需在 Docker-capable 环境对冻结 exact SHA 验证 |
| Docker image build/本地容器 | NOT RUN | 当前环境没有 Docker/Podman/nerdctl；历史 CI 不等于 ModelScope 构建 |
| ModelScope 网页目录/ZIP 上传与 `.dockerignore` 保留 | NOT TESTED | 必须由 Owner 登录目标 Space 后按实际 UI 验证；不得假定 ZIP 自动解包或隐藏文件保留 |
| ModelScope 平台构建、运行状态、健康、页面与 API smoke | BLOCKED / NOT TESTED | 空间尚无部署内容，实际应用 origin 未提供；必须等单独部署授权 |
| DeepSeek / 付费模型请求 | NOT RUN | 无 Key；此包不需要/不要求密钥 |
| HTTPS、公网 URL、ACL、公开切换、平台 Secrets、exec/日志权限隔离、回滚 | NOT TESTED | 部署前和授权后分别验证；平台 Secret API 说明不证明目标空间 ACL；当前无旧 revision |

## 责任边界与交接

- Docker owner：只维护 `Dockerfile`、`.dockerignore`、`ms_deploy.json`、Docker CI 和 `docs/docker-*`。提交首次包的源 SHA、文件清单、命令、具体验收断言和失败处理。
- Tech Lead：独立只读检查目标 SHA/tree、Docker build 入口、监听/端口、无密钥默认拒绝，以及首次部署建议；不能把静态检查升级为目标平台 PASS。
- Supervisor：汇总 Docker/Tech Lead 证据后，向负责人提交一次包含目标空间、精确源 SHA、资源档位/费用确认、私有首次构建与验收步骤的具体部署授权请求。
- Owner：在收到单独授权后亲自在 ModelScope 操作；核对目标和费用、用页面所示 Git 操作或文件上传、保存平台生成 revision 与 build/run 证据。没有授权前只停留在“空间文件”状态。

DOCKER GO、首次平台构建通过、PRODUCT GO 和 DEPLOYMENT GO 是不同结论。当前整体状态仍是 **BLOCKED — INITIAL MODELSCOPE DEPLOYMENT NOT COMPLETED**。
