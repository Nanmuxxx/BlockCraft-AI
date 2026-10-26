# BlockCraft AI — Docker / Deployment Handoff

核验日期：2026-10-19（Asia/Shanghai）。执行范围：历史 CI 证据、冻结 main 的直接容器 CI、无付费本地验证和部署准备。未修改生产代码、Workshop、Engine、Dockerfile 或 CI；未合并、Push、发布 registry 镜像、部署或调用真实模型。

## 当前交接检查点（2026-10-20 04:10 Beijing，覆盖下文历史候选）

- 写Owner已从Docker既有聊天明确交给Supervisor；PR65仍为部署文档PR，按正常FF保存，不覆盖产品分支。
- 当前组合PR75 `7a2adbbfaa1d8bfd3c8853a4d204d1d6532bbe8a` / tree `f3d6757dd3880eba3426c96fb33e1b18a53e49f0`；main仍4a95cae。保留三条Docker launcher打包改动，只导入TL已审Core3abd hardening。源代码本地326e961/tree4df727已跑Python/OpenSSL、generation109/109、build、HTTPS番茄钟Mock、精确7860启动/401/通用失败/0upstream；证据在候选docs/acceptance/studio-hardening-composite-20261020/。云CI39316292354现已completed SUCCESS，实际checkout `8f4f82729c2dc104018a3e970560fd467c36d456` 与PR75候选tree `f3d6757dd3880eba3426c96fb33e1b18a53e49f0` 一致。旧39312992630不证明新SHA。
- 历史Run39312992630实际checkout为合成merge e7673eaf1f9a994ab1e88c0bd38c370fe567e1e3，同tree7b33d0b；不是直接checkout PR HEAD。下文7bc5/20aa仅历史范围。
- 当前源码清单见docs/modelscope-candidate-7a2adbb-manifest.json：746普通blob/20,732,372bytes，最大495,835bytes，无LFS pointer/symlink/submodule。保留平台README并合并.gitattributes时预期747项（745new+2preserved/merged）。这不是完整内容/镜像secret扫描，也不是上传成功。
- 最新可执行步骤以[首次部署说明](docs/docker-modelscope-initial-deployment-20261020.md)为准。默认CMD仍关闭；经QA验证的可选7860命令不是平台已支持或部署授权。
- 本地历史真实闭环e4d65ac/一次616token已通过；当前候选仅Mock。PUBLIC PASS BLOCKED。账本/profile跨环境连续性待Owner核对，禁止新空账本、重置或恢复旧state补额度。

## 1. 结论与放行边界

**DOCKER GO（限定已验证的镜像构建、启动、健康、静态资源及匿名拒绝范围）。PRODUCT GO：BLOCKED。DEPLOYMENT GO：BLOCKED。**

冻结 main `4a95cae50f772cd242d932cdbd93366381d1df74` 的直接 `workflow_dispatch` Run 39273438702 已成功：实际 checkout 精确 SHA，Docker build、ESM 检查和 HTTP Smoke 通过。PR #45 测试树与此前 main 完全一致；PR #49 仍是独立候选。匿名 v1/v2 API 基本拒绝检查已通过（401 UNAUTHORIZED）；完整对抗测试矩阵尚未执行。DOCKER GO 不表示所有安全门禁均 PASS：完整镜像内容/密钥扫描、HTTPS 和平台运行仍 NOT TESTED。公开在线生成仍默认拒绝，正式 Mochi/B/C 产品闭环不属于本次 Docker 放行。

本机无 Docker CLI、Docker.app、Podman 或 Colima，未在本机重跑容器。未触发 CI 重跑。绿色结论来自已读取的具体 Job 日志、Artifact 和源码树对应关系，而非仅来自 success 标签。

## 2. 精确版本与 checkout 对应关系

| 对象 | 精确 SHA | tree |
| --- | --- | --- |
| 重新 fetch 的 origin/main / 冻结 main | 4a95cae50f772cd242d932cdbd93366381d1df74 | b19a52f8cdc82aa137b57a1396f996b6becfda3f |
| 冻结 main 直接 CI checkout (Run 39273438702) | 4a95cae50f772cd242d932cdbd93366381d1df74 | b19a52f8cdc82aa137b57a1396f996b6becfda3f |
| PR #45 最终 HEAD | d6dd7fe3ff25e8c8f1141b136704cfbaf67d1b97 | 0cfa23054e6490e201ab28b16df796477f7805a2 |
| Run 39192409815 实际 checkout | a603c735676af09d876b3bb73f937d0c314c2d1f | 0cfa23054e6490e201ab28b16df796477f7805a2 |
| PR #49 第二轮 HEAD | 737f965ae923ccfb4d2a9a6315e3988afe1eb2cc | cce708959f192bb76e937a31ca1e57248055cce8 |
| Run 39205412867 实际 checkout | 6c6e74e069e12a24757ba84aac7bc8b2eac599d1 | cce708959f192bb76e937a31ca1e57248055cce8 |
| PR #75 当前合成候选 HEAD | 7bc5aeb932e01276ddfea9216e65b30cf31b553e | 7b33d0bc49c7186fd95eedd93dd2f48759d44c97 |
| Run 39312992630 Docker checkout (synthetic merge) | e7673eaf1f9a994ab1e88c0bd38c370fe567e1e3 | 7b33d0bc49c7186fd95eedd93dd2f48759d44c97 |

#45 已合并，main 后续经过 Supervisor 协作提交推进至冻结候选 `4a95cae`。main 在本次最终复核仍为该 SHA/tree。Run 39273438702 由 GitHub 对 main 直接 workflow_dispatch，job checkout 精确为该 commit（不是 PR merge ref）。历史 #45 main/d6dd7fe tree 为 0cfa2305，与冻结 main 不同；冻结 main 有 Supervisor 文件变更。Run 39192409815 的 #45 merge tree 绑定只适用于对应早期 tree。

d6dd7fe 的两个父提交为原 #45 的 1e5ac96ac60404549bc8405f07185d51b6eb706e 与 #46 Docker 修复 278b13008fcbd90eb874e067ca3ffc1b33fef664。既有修复已包含，不应重新开发。

#49 的历史第二轮 HEAD `737f965` 不属于 main，且不是当前 Docker 集成候选。当前集成在 PR #75：HEAD `7bc5aeb`，tree `7b33d0b`；它显式摘入 PR #76 issuer 文件并保留 PR #75 原有三条 Docker launcher 打包改动。PR #75/#76 仍 OPEN/Draft、均未合并。独立复核见 Issue #57 comment `6275776252`。**不得将任何 PR HEAD 视为 main。**

## 3. GitHub Actions 具体证据

| 项目 | #45 Run | #49 Run | 冻结 main 直接 Run |
| --- | --- | --- | --- |
| Run | [39192409815](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39192409815) | [39205412867](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39205412867) | [39273438702](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39273438702) |
| Job | [117867874021](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39192409815/job/117867874021) | [117907052511](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39205412867/job/117907052511) | [118131457643](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39273438702/job/118131457643) |
| 环境 | Ubuntu 24.04.5；node:24-bookworm-slim | 同左 | Ubuntu 24.04.5；node:24-bookworm-slim |
| checkout / event | a603c735；pull_request #45 merge tree | 6c6e74e；pull_request #49 merge tree | 4a95cae；workflow_dispatch refs/heads/main |
| 构建完成时间（UTC） | 02:58:52 | 05:37:03 | 14:56:54 |
| 镜像标签 | blockcraft-ci:39192409815-1 | blockcraft-ci:39205412867-1 | blockcraft-ci:39273438702-1 |
| 本地 image ID | sha256:4995f0cec7c51666a3296443acb28c02bddf584d893cc3176e8f25031f0d4d64 | sha256:6c505b8fa083d1f86f61ffcf47132d203013f286f3e11747859994aeb4763130 | sha256:7272e404da73a724b2501c7625b85497e8fe2af753ea3cb4bc49237a44028b39 |
| Artifact ID | 12159549496 | 12165890366 | 12196241754 |
| Artifact ZIP bytes | 21726 | 21788 | 22226 |
| Artifact SHA-256 | a069d4dc071fead475c7f6a3de730af588d83fbfcefb817aa78b82056b4d27d2 | a7d17adc1d9b38b66905c1306f263ad6c103115d2862914778d3940a2d2b6498 | 509b365c2cc55eba6f6178f6152185f9a91c0bec91f92fab022cb6fb4fcf9b74 |

以上 image ID 是 runner 本地镜像 ID，不是已发布 registry digest。本次没有发布镜像。

三个 Artifact 均已真实下载、计算 SHA-256 与 GitHub metadata digest 一致并解包。原 ZIP、逐项日志保存于 docs/docker-handoff-evidence/artifact-1.zip 至 artifact-3.zip 及对应解包目录。历史完整 Job 日志保存在 run-39192409815.log 与 run-39205412867.log；Run 39273438702 另有 GitHub Job 原始日志可在线查看。Artifact 原保留期至 2026-10-26，故本地副本一并交付。

当前 PR #75 合成候选的 Docker acceptance Run [39312992630](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39312992630) / job `118267147896` 已 completed/success，checkout 为上表精确 SHA/tree。Job 步骤中 Regressions、Build image、Verify final-image ESM import resolution、Start container and run bounded smoke tests、Upload acceptance evidence 均 completed/success；Artifact `12215708175`，ZIP 25,312 bytes，GitHub digest `sha256:bd1b3cc6500aac54bcc837b9d85084191819a17b79998d9739642cfa6eedb687`。独立复核报告记录镜像 runner-local ID `sha256:76b1334f31389055af45ead670fe1147ff6e9b9b315bfb125752a3cf90409fe7`、容器 healthy、默认入口保持关闭、7 个资源/路由/health/traversal 检查通过，匿名 v1/v2 均 401。该镜像 ID 不是 registry digest；CI 证明此合成候选的有限打包与默认关闭范围，不证明平台部署或公网验收。此前 PR #76 的 Run 39311567411 不含三条 Docker launcher 改动，不能替代此候选证据。

三 Job 的 Checkout、Regressions、Build image、ESM、Start container/Smoke、Summary、Upload 均 completed/success，没有跳过这些关键步骤。Run 39273438702 回归：root 205/205、server 37/37、generation 34/34、Mochi Host 57/57、trusted interactive 31/31、trusted pomodoro UI 2/2、Workshop export 9/9；generation/Mochi/Workshop browser 项明确 NOT RUN。各结果见 artifact-3/test-results.log。构建日志真实记录 exporting layers、writing image、naming to，不是仅执行 docker version。

退出码判读：步骤成功，脚本使用 set -euo pipefail，Node assert 失败会非零退出，cleanup 保存原 status 后 exit，因此可确认 Build/ESM/Smoke 命令链成功退出。日志未另写独立的 “smoke_exit_code=0” 字段；这是基于步骤结论与脚本传播逻辑确认，不捏造额外数值输出。inspect 的 “status=running exit=0” 是运行中的容器状态，不代表应用已经正常终止。

## 4. 构建、ESM、静态运行时与健康检查

- Dockerfile：双阶段，npm ci → npm run build → npm --prefix server run build → curated runtime-server。最终镜像以 USER node 运行，直接 node server/index.mjs，不需要最终阶段 npm/node_modules。
- 历史缺失 ai-abort.mjs、paid-gateway 的问题已由 #46 修复：context allowlist 放行，构建阶段按树拷贝，最终 staging 复制 *.mjs。三次运行均 has_paid_gateway_runtime=true，无 OPTIONAL_MODULE_ABSENT 日志。
- 三次 ESM 检查均输出 “PASS final-image ESM resolution/import: 15 files; entry=/app/server/index.mjs”。检查从入口和 ai-abort/access/egress/provider roots 遍历字面量相对 import，校验文件存在，并实际 import 非入口文件；入口随后由容器启动验证。
- 该算法不证明变量动态 import、所有文件读操作、所有惰性路径。ledger.mjs 不在这 15 文件入口闭包中；源码 staging 会复制它，但最终镜像内显式 stat/import ledger 未执行，标 NOT TESTED，不能称全镜像清单。
- dist、generated appSpec/validation、appSpec.ts、trustedInteractive.schema.json 和 Mochi protocol 由 Dockerfile 明确复制。三 CI 成功启动并提供静态资源，排除本次入口必需文件缺失。
- production 默认 0.0.0.0:7860，CI container.log 明确记录该地址；宿主仅映射 127.0.0.1:7860:7860。开发模式默认 loopback:3001，不能把开发启动配置用于平台。
- HEALTHCHECK 每 30s、超时 5s、start-period 10s、retries 3，以 Node fetch 本容器 /api/health，HTTP 非 2xx 或异常退出 1。三 CI 均第 4 次约 6s 观察到 healthy，最终 running/healthy。
- Docker HEALTHCHECK 只判断 response.ok；HTTP Smoke 另外严格校验 200、application/json、精确 {status:'ok'}。健康端点不检测外部模型、数据库、预算或业务可用性。

## 5. HTTP Smoke 的实质断言

三次 artifact/http-smoke.log 均显示以下实际结果，源码断言位于 .github/workflows/docker-acceptance.yml：

| 目标 | 已执行断言 |
| --- | --- |
| / | 200、text/html、HTML 包含 root |
| /ai-create、/app-renderer | 各两次刷新，200、text/html、正文等于首页 |
| 7 个资源 | favicon、入口 JS、CSS、4 个字体；同源、200、精确 MIME、非空；递归解析 CSS url/import |
| /api/health | 200、JSON、精确 status=ok |
| /unknown、/api/unknown、/assets/missing.js、/api/local-project-export | 404 JSON NOT_FOUND |
| POST /api/local-project-export 及 ?probe=1 | 404 NOT_FOUND，不是 ZIP，无 Content-Disposition |
| 6 条原始异常路径 | 400 JSON INVALID_PATH，含明文/编码 traversal、encoded API separator、重复斜线 |
| POST /api/ai/generate，无 protocol | 401 JSON UNAUTHORIZED |
| 同一路径，protocol=trusted-interactive/1 | 401 JSON UNAUTHORIZED |

v1/v2 术语说明：本仓库可信交互 v2 通过同一 /api/ai/generate 路由和 protocol:'trusted-interactive/1' 选择，并非另有 /api/v2 URL。三 CI 最后这个请求就是可信交互协议拒绝测试；不能因为 URL 未含 /v2 而误判未覆盖。它没有添加伪造 auth/approval，不能等同于完整匿名对抗矩阵。

因此，匿名 v1/v2 API 基本拒绝检查已通过（401 UNAUTHORIZED）；完整对抗测试矩阵尚未执行。

Smoke 不是纯 HTTP 200 探针，但首页 includes('root') 很弱，JS 只检查非空/MIME，不执行 React。没有递归解析 JS 动态资源，构建内 Mochi PNG、所有延迟资源和浏览器交互不在 7 资源范围内。未做浏览器渲染、移动端、B/C、Preview/Confirm/CAS 产品验收。

## 6. v1/v2 认证、无付费模型隔离

**容器基本匿名 v1/v2 拒绝 PASS；完整伪造身份矩阵在本地源码测试 PASS，在最终镜像内 NOT TESTED。**

server/index.mjs 在读取 body、区分 protocol、Provider 之前调用 authorizeGeneration。缺 generationAccess 函数默认 false；CLI createAppServer() 不注入此函数；环境变量、Origin/CORS、Host、XFF 或 body approval 都不能制造身份授权。PUBLIC_ORIGIN 不是身份认证。interactive admission 与 Mochi enabled 另有默认关闭门禁。

CI docker run 显式 DEEPSEEK_API_KEY=''、PUBLIC_ORIGIN=''，没有 --env-file 或真实 Key secret 引用；Dockerfile 无 secret ARG/ENV，构建只安装依赖与编译。CI HTTP 只请求 127.0.0.1，不执行 tools/real-deepseek/evaluate.mjs --live。已审阅工作流和涉及测试：Provider 使用离线 fixture/注入 transport，不新增真实付费调用。

安全结论限于：没有提供真实模型凭据或授权；普通入口默认拒绝；实际匿名请求拒绝。没有网络抓包/供应商账单，因此不将日志中的 “no upstream request” 字符串本身视为独立网络监测证据。npm 安装需要网络，但不属于模型付费调用。

本地额外验证：
1. Node v24.22.0；npm ci、npm run build、npm --prefix server run build 均 exit 0。
2. 首次直接运行 paid-gateway 测试因缺 server/custom-block/.generated/custom-block/index.js，exit 1；这是源码测试前置构建遗漏，非容器启动失败。经既有 npm run test:workshop-export 的 prepare 构建可信协议后，再跑 security.test.mjs + model-contract.test.mjs：16/16、exit 0、skipped 0。未修改生产源文件。首次错误记录在本段；成功重跑日志保留于 local-*.log。
3. security suite 确认匿名 legacy/v2、伪造 Host/XFF/Origin/body approval 在 Provider 前拒绝，调用计数 0；默认无身份适配器、有假 Key/注入 Provider 仍拒绝；受控 native egress、固定模型、预算/超时/取消/未知用量保护通过。使用离线假 key 与临时账本，不读取真实 .env。
4. docs/docker-handoff-evidence/local-smoke.mjs 从 /tmp 启动正式 CLI，仅传入 PATH/NODE_ENV/PORT/空 Key/空 PUBLIC_ORIGIN；health 精确 JSON、首页 root、两 SPA 路径相同；匿名及伪造 Bearer 的 v1 和可信交互 v2 均 401 JSON UNAUTHORIZED，exit 0。这是源码进程测试，不冒充 Docker 或 HTTPS。

当前不会仅凭设置 DEEPSEEK_API_KEY 就启用服务；不能建议用户通过环境变量关闭认证以“部署成功”。公网多用户认证、正式受控 transport/预算/审批注入尚未交付为生产部署方案。

## 7. CI 变更与 main 覆盖

git diff d6dd7fe 737f965 -- Dockerfile .dockerignore .github/workflows/docker-acceptance.yml ms_deploy.json server 为空。#49 改动在 Mochi/模型/渲染器及测试文档，前端 JS 435769 → 437473 bytes，镜像不同属于正常构建内容变化。Docker 打包/服务端没有再次改变。

main 存在 Dockerfile、.dockerignore、ms_deploy.json、Docker acceptance workflow。冻结 main 4a95cae 已有直接 Docker run 39273438702 成功，消除了早期“main 无直接运行”的证据缺口。工作流仍仅 pull_request 路径过滤 + workflow_dispatch，没有 push main；不代表每次 main 更新都会自动验收。

最小建议（等待 Tech Lead 决策，不修改 CI）：正式发布前对选定 main SHA 手动 workflow_dispatch；将来是否增加 push main、paid-gateway 显式套件、镜像清单/密钥检查，由 owner 审批。不是本次必须重写 Docker 的理由。

## 8. ModelScope / Docker HTTPS 部署准备（未执行部署）

### 构建与启动

平台已有 ms_deploy.json：sdk_type=docker、port=7860、resource_configuration=platform/2v-cpu-16g-mem。这仅是仓库配置，不证明账号资源、平台权限、配额或域名已就绪。

以下命令仅为后续获准操作者的准备文档，未在本机执行 Docker。必须先 checkout 干净、经批准的精确提交：

~~~sh
git checkout --detach 4a95cae50f772cd242d932cdbd93366381d1df74
docker build --pull --tag blockcraft-ai:4a95cae .
docker run -d --name blockcraft-ai-candidate \
  --publish 127.0.0.1:7860:7860 \
  --env NODE_ENV=production --env PORT=7860 \
  --env DEEPSEEK_API_KEY= \
  --env PUBLIC_ORIGIN=https://YOUR-APP-DOMAIN \
  blockcraft-ai:4a95cae
~~~

### 2026-10-20 ModelScope 现有基线核对（只读，未部署）

最新适用正式决定为 Issue #57 comment `6275772981`；独立复核见 `6275776252`。PR #75 当前合成候选 HEAD `7bc5aeb932e01276ddfea9216e65b30cf31b553e`，tree `7b33d0bc49c7186fd95eedd93dd2f48759d44c97`，包含 PR #76 issuer 文件且保留三条 Docker launcher 打包改动；PR #76 source HEAD 为 `20aa0266225011a373991578d2a759de806b14ec`。两者仍 OPEN/Draft、未合并。PR #76 的 Run `39311567411` 不证明 launcher 打包；合成候选 Docker Run `39312992630`/job `118267147896` 才提供这一有限证据。CI 和独立审查均为 Mock/default-closed 范围，不是平台部署或公网验收。

通过匿名只读 Git 读取的 ModelScope `master` 为 `7637f1bde9fcb8989c805dca4eef9eacc3ae120e`，跟踪文件只有 `.gitattributes` 和 `README.md`；README 含空间卡片元数据。Issue #57 最新决定仍说明空间未部署。当前 PR #75 合成候选为 HEAD `7bc5aeb932e01276ddfea9216e65b30cf31b553e`、tree `7b33d0bc49c7186fd95eedd93dd2f48759d44c97`，包含 731 个 tracked blobs；候选 tree 总 blob bytes 为 20,309,014，最大单项 495,835 bytes（`docs/acceptance/trusted-pomodoro-ui/browser/entry-1440.png`）。与平台现有路径交集为 `.gitattributes`；overlay 计算为新增候选 730 项、保留目标 `README.md`、合并 `.gitattributes`，预计结果 732 项。候选 `.gitattributes` 规则为 `tests/custom-block-compiler/fixtures/* text eol=lf`；必须保留目标现有 LFS 规则并合并此规则。上述数字是精确候选 Git tree 的路径/blob 核算，不等同于平台上传验收；Supervisor已逐blob核验该旧tree无LFS指针、symlink或submodule；平台端限制与实际导入仍 **NOT TESTED**。未下载/上传目标文件，未检查权限、Secrets、卷或平台运行配置。

Owner-assisted 首次部署准备步骤（PR #75/#76 完成整合与独立审查、精确候选 CI 通过，并取得负责人明确批准后才可执行）：

1. 重新读取平台当前 `master` SHA/tree 和 README/`.gitattributes`，验证仍与上述基线一致；若变化，重新计算清单，不覆盖目标祖先或元数据。
2. 在隔离临时 checkout 中以平台 `master` 为父提交，导入经批准的完整集成候选文件；保留空间 README，逐条合并并复核 `.gitattributes`。禁止 force push 或直接替换目标分支历史。
3. 检查文件清单、大小及 LFS 指针/对象；构建必须绑定最终 overlay commit SHA，并先在私有候选空间验证，不注入真实密钥。
4. 经 Owner 单独授权后，才由 Owner 使用平台 Secret 管理、核实访问控制/单副本与持久卷语义，执行首次构建/启动；这些步骤在本次只读准备中没有执行。

本节是与历史冻结 main `4a95cae` Docker 验收不同的 ModelScope 目标基线核算。PR #75 的 Docker CI 成功不证明平台导入、启动、HTTPS、Secrets 或存储语义；也不构成部署批准。

### ModelScope 官方文档依据与 Owner 实测项（只读）

只读来源：[ModelScope `ms-studio-deploy` 官方 Skill](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md)，读取版本 `main` SHA `20359af8bbe803791909ed99055518ee7eb6f63c`。该文档说明 Docker Studio 应监听 `0.0.0.0:7860`；Docker 构建前需完成阿里云账号绑定和 ModelScope 实名认证；默认重启会丢失 `/mnt/workspace` 以外的数据，Studio 改名/转移也会丢数据；Secrets 列表只返回 key，不返回 value。文档将 `/mnt/workspace` 标作持久化目录，但没有承诺其 POSIX 锁、fsync、原子 rename、崩溃耐久性或本目标空间的访问控制。

上述是平台文档能力，不是本目标空间实测或 Owner ACL 证明。Owner 在任何获批部署前须逐项验证：

- Docker 构建前账号绑定与实名状态满足平台要求，目标空间的实际 Docker build 配额、权限及运行资源可用；本次没有检查账户或空间。
- 容器确实由平台以其预期方式路由至 `0.0.0.0:7860`，HTTPS ingress、健康探针和外部访问控制适用于这个目标空间。
- 唯一受支持的 `/mnt/workspace` 是否在容器当前 service UID 下可写，是否跨容器重启/重建保持同一挂载；应用要求的规范账本目录/文件权限、稳定 UID、单进程/单副本、exclusive-create、锁排他、同目录原子 rename、文件与目录 fsync 及崩溃恢复行为均须以合成数据实测。官方“持久化目录”描述不能替代这些语义证据。
- 分别审查能够读取/管理 Secrets、写代码或构建定义、触发构建、替换镜像/命令、重启服务和切换公开版本的角色。Secret 列表仅返回 key 不能证明谁有权部署可读取 Secret 的代码；不得通过 API/CLI 认证或读取真实 Secret value 来完成本只读准备。
- Studio 改名/转移会丢数据；账本若依赖 `/mnt/workspace`，不得将重命名/迁移作为无损回滚方式。保留原空间和同一状态挂载，直到有 Owner 批准且验证过的迁移方案。

若 `/mnt/workspace` 无法满足稳定私有 POSIX 状态存储和单实例锁语义，或既有真实调用的预算/授权连续性无法证明，则保持 **NOT READY FOR SECRET INJECTION / DEPLOYMENT NO-GO**；不得通过创建空账本、重置生产预算或新增付费调用绕过阻塞。本次没有查看目标空间权限/Secrets、执行认证示例、构建、启动或部署。

宿主 HTTPS 由经批准的反向代理终止 TLS 并转发 loopback:7860；ModelScope 由平台 HTTPS ingress 转发容器 7860，不需要在 Node 内配置证书。平台由自身网络访问容器时不要将进程改成 127.0.0.1。平台具体公网 URL、健康探针配置、TLS/转发行为仍待实际验收。

构建基础 node:24-bookworm-slim 当前是浮动 tag；历史构建记录不保证未来 npm/基础层完全相同。正式发布应记录基础镜像 digest、最终 registry digest、平台架构和源 SHA；固定 digest 的代码变更须交 owner 审批，不在本次修改。

### 环境与安全配置

| 变量/配置 | 默认与部署要求 |
| --- | --- |
| NODE_ENV | 镜像 production；必须保持，决定 0.0.0.0 |
| PORT | 镜像 7860，整数 1–65535；与平台/映射/健康检查一致 |
| PUBLIC_ORIGIN | 默认空；HTTPS 上线前设精确 https://域名，不含 path/尾斜线；非法值启动报错 |
| DEEPSEEK_API_KEY | 默认不存在；本阶段明确留空，不可写进构建上下文/ARG/镜像/前端 |
| DEEPSEEK_MODEL | 可选；不是授权。受控付费 transport 只接受审批定价模型，不可盲信历史默认 |
| generationAccess | 不是环境变量；CLI 不注入，默认拒绝 |
| interactive、mochi 授权/预算/enable | 不是靠通用环境变量开启；默认关闭，须 owner 单独交付正式集成 |
| TLS/域名/访问控制 | 平台或代理配置；证书自动续期、私有预览访问控制、流量限制由部署 owner 验证 |

静态预览不需要任何模型密钥。未来如批准在线 AI，只能用平台 secret store/运行时注入；先完成认证、共享持久预算、审计脱敏、审批和供应商费用隔离。不得将开发 .env、私密账本、历史真实响应或本地 evaluator/proxy 放到生产服务。冻结历史政策曾在2026-10-20 00:00过期。当前PR75定价代码有效期为2026-10-21 00:00 +08:00；deepseek-flash/CNY input2、output8/百万token。到期保持拒绝；定价代码不等于新的费用许可。

.dockerignore 是 allowlist，排除 .env、key、pem、credentials、secrets、日志等，最终阶段仅 curated 文件；它不能发现源代码/public 中硬编码秘密。完整镜像层和源内容秘密扫描未执行，必须列为发布前复核。

### Studio Secrets、权限与运行时边界（SECRET-1）

SECRET-1 规定真实 `DEEPSEEK_API_KEY` 仅由项目负责人在 ModelScope Studio Secrets 管理，Agent 不索取、不读取。本节只记录无秘密的仓库证据与尚缺的平台证据；没有查看 Secrets UI、环境变量值、密钥或账号权限，也没有注入/轮换密钥、部署或发送真实模型请求。冻结初赛候选保持 `4a95cae50f772cd242d932cdbd93366381d1df74`，不因本安全接入候选切换。

已检查的静态配置范围：冻结候选 Dockerfile 没有 `DEEPSEEK_API_KEY` 的 `ARG` 或 `ENV`，runtime stage 只声明 `NODE_ENV`、`PORT`；`ms_deploy.json` 仅声明 Docker SDK、资源规格和端口，没有声明 Secrets、卷、用户权限、构建权限或部署角色。Docker CI 使用空 Key，不能证明 Studio 的运行时注入行为。故“Studio 仅运行时注入”是将来必须遵循的配置要求，当前仍为 **NOT VERIFIED**；“Secrets UI 不可见”也不是密钥只有 Owner 可读取的证据。

若后续经负责人单独批准启用，密钥只能由 Studio 的运行时 Secret 管理注入服务端进程；禁止通过 Docker build args、镜像 `ENV`、构建步骤、仓库文件、前端资源、日志或 Artifact 传递。构建期必须在没有真实 Secret 的环境运行。运行时读取密钥的代码以及能够替换该代码的主体都能窃取或外传密钥，因此必须分别核实谁可查看/编辑 Studio Secrets、修改仓库或构建定义、触发构建、替换镜像或启动命令、重启运行服务、部署/切换公开版本；能够改动可执行代码、构建产物、启动配置或部署目标的权限都属于密钥信任边界。当前没有这些角色/权限的无秘密导出或审核记录，**Owner 独占性及最小权限均 NOT VERIFIED**，不得声称已由平台权限保证。

持久预算账本的单实例卷也没有可验证的平台证据。Dockerfile 未声明 volume，`ms_deploy.json` 未配置挂载；Run 39273438702 的容器测试没有挂卷、跨重启持久性或多副本协调测试。本机没有可用容器运行时，未做卷探针。现有 CI 产物只能证明 runner 内单容器短时行为，不能证明 ModelScope 的存储语义。启用受保护模型入口前，平台 Owner 必须以合成数据和无密钥检查证明：恰好一个写入进程/副本；重启前后挂载到同一持久 POSIX 文件系统；私有预建目录权限为 `0700`、账本/锁文件为 `0600`；exclusive-create、同目录原子 rename、文件与目录 `fsync`、锁排他性和释放顺序符合预期；不得通过删锁、重置账本或换卷“修复”未知状态。上述全部 **NOT TESTED / BLOCKING**。Gateway/Core 对临时账本的 Mock 测试不能替代平台卷验收。

Gateway deployment handoff 的附加硬性要求（PR #75/#76 集成和产品负责人另行授权之后才可验收）：运行时必须严格为 **one server process / one replica**，且跨重启使用稳定 service UID；状态须位于同一绝对规范路径挂载的**本地持久 POSIX 卷**，不得使用共享或网络文件系统。Owner 预建私有目录必须为 `0700`；canonical ledger、binding、approval、issuer 状态文件必须已经存在，均为普通文件、同一 UID、`0600`、`nlink=1`。缺失、损坏、未结算或状态无法确认时保持关闭并人工对账；stale lock 也只能人工恢复，绝不自动删除锁、创建空账本、切换账本路径或重置状态来恢复额度。此前已结算的真实调用与剩余授权连续性尚未证明，不能借新空账本重新获得预算。

发布和回滚必须保留同一状态卷：先停止新请求接入，排空并结算/标记在途请求，再释放 Gateway 锁；升级或回滚均复用原卷，不恢复更旧账本副本、不删除 issuer/approval/binding 状态。镜像默认入口保持关闭，不开放付费 public routes。`stat`/权限/nlink 检查不能证明平台 ACL、单副本、卷持久性或 `fsync`/exclusive-create/atomic-rename 语义；每项都需在平台用合成状态、零密钥提供单独证据。上述全部仍为 **NOT TESTED / BLOCKING**，本节没有授权合并、部署、改密钥或付费调用。

当前门禁：**NOT READY FOR SECRET INJECTION**。在真实密钥注入之前，需补齐 Studio 注入时机、角色权限/代码供应链信任边界、单实例持久 POSIX 卷及最终候选 SHA 的独立验收；之后仍需负责人另行批准密钥注入、真实调用或部署。DOCKER GO 仍只覆盖历史冻结 main 的离线容器范围，不升级为付费入口或生产部署 GO。

### 健康、页面和 API Smoke

- 内部：GET http://127.0.0.1:7860/api/health → 200 application/json 精确 {status:'ok'}。
- HTTPS 外部：GET /、/ai-create、/app-renderer；首页入口一致、JS/CSS/font MIME 与正文非空，动态图片与浏览器 console 也要检查。
- POST /api/ai/generate，JSON {idea:'offline smoke'} → 401 JSON error.code=UNAUTHORIZED。
- POST 同一路径，JSON {idea:'offline smoke',protocol:'trusted-interactive/1'} → 同样 401。
- 带伪造 Bearer/Origin/XFF 不得改变拒绝。外部 Origin 需与 PUBLIC_ORIGIN 对齐，不能把正常 origin 白名单误当授权。
- /api/unknown → 404 JSON；/api/local-project-export（GET/POST/带 query）拒绝，不泄漏本机 ZIP 服务。
- traversal 使用 curl --path-as-is 或 raw HTTP 验证；客户端 URL 归一化会掩盖测试路径。
- HTTPS 验证证书链、无混合内容、代理超时/限流、重启后健康、持续稳定运行。本次均 NOT TESTED。

部署后 Smoke 必须是上述拒绝/静态检查；不发送真实付费生成请求。复用本地 Smoke 脚本的断言思路时，将目标 URL 改为经批准的候选环境，不能直接以该脚本声称平台已验收。

### 回滚

上线前保留已知可用镜像不可变 registry digest、源 SHA、无秘密配置快照与上一版本平台 revision。先在私有候选环境验证再切流；失败则切回旧 digest/revision，复验健康、页面、匿名 v1/v2 拒绝，停用故障候选。禁止以浮动 latest 作为唯一回滚标识，禁止靠重新构建“旧 tag”代替原镜像。平台文档说明 Studio 改名/转移会丢数据，因此状态恢复必须留在原空间并复用原挂载，除非另有经 Owner 验证、明确获批的数据迁移方案。Run 39273438702 只产出 runner 本地 image ID `sha256:7272e404...`，没有 registry digest、已部署平台 revision 或公网 URL；因此无实际可回滚生产目标，回滚演练 NOT TESTED。

未来预算/审计账本不回滚、不删除、不重置来释放额度；未知在途请求需人工对账。生产 AI 默认关闭应在切换与回滚后保持。

## 9. 未覆盖项与待接手工作

| 项目 | 状态/后续责任 |
| --- | --- |
| 冻结 main 直接容器匿名 v1/v2、health、7 资源、路径/ZIP 隔离 | PASS，Run 39273438702 |
| PR #75 合成候选 launcher 打包、最终镜像 ESM、健康及匿名 v1/v2 基本拒绝 | PASS，仅限候选 Docker CI Run 39312992630；PR 仍 Draft/未合并 |
| 本地伪造身份矩阵及预算/模型安全套件 | PASS 16/16；不等同镜像内全套 |
| 镜像内 ledger.mjs 显式 stat/import、完整清单、秘密扫描 | NOT TESTED；原 Docker owner 复核 |
| 浏览器 generation/Mochi/workshop-export | CI 明确 NOT RUN；其他 trusted-interactive/reliability/pomodoro browser 也未由此 workflow 调用 |
| 正式 Mochi Provider、Workshop B/C 产品闭环 | BLOCKED；交产品/Engine/Workshop 与独立 QA，不由 Docker 代理修改 |
| 冻结 main commit 直接 CI、持续 push main CI | 直接 run PASS；push-main 自动触发未配置 |
| ModelScope 权限/资源、HTTPS/域名、代理、平台架构、重启/资源/负载/回滚 | NOT TESTED；DEPLOYMENT GO BLOCKED |
| 真实付费在线生成 | NOT TESTED 且未获本任务授权；不新增调用 |
| 最终发布与切流 | 禁止本代理执行，需 Tech Lead 决策和明确授权 |

活跃 Docker owner branch/worktree：`docs/docker-deployment-handoff-20261019`，worktree `/Users/nanmuxun/BlockAI/BlockCraft-AI-docker-handoff-20261019`，本次仅修改 handoff 文档。Deployment-Support-QA 获准在独立冻结-SHA checkout 做只读/离线验证，仅新增 tests/deployment-support/** 与 docs/acceptance/deployment-support/**；不得编辑 Docker owner 文件。冻结产品 SHA 为 `4a95cae50f772cd242d932cdbd93366381d1df74`；对应 CI 临时镜像标签 `blockcraft-ci:39273438702-1`、runner-local ID `sha256:7272e404...`，不是 registry artifact，故不能在未来 runner 上拉取作为部署镜像。组合候选 PR #75 `7bc5aeb932e01276ddfea9216e65b30cf31b553e` 的 CI 通过也没有 registry artifact。public_url=NONE；平台实际部署验证时间=NONE。已部署回滚目标=NONE；禁止以缺失的候选 tag 或换卷/重置账本代替回滚。原 Docker owner 后续复核本报告、候选 overlay/LFS 清单与平台门禁即可；历史 Docker CI 无需重复运行。

Agent C 独立复核重点：tree 绑定、Artifact checksum、两种 protocol 的实际 Smoke body、命令退出传播、默认拒绝/无真实 Key；不要沿用过时 BLOCKED 或宽泛 PASS。当前应用可见线程列表及 archived 列表未定位 Agent C 或原 Docker owner 的可寻址聊天，尚未通过消息投递；报告已作为共享文件准备交接，不猜测收件人或覆盖 QA 文件。识别到正确聊天后按用户授权投递此报告。

## 10. 最终门禁

- **DOCKER GO**：冻结 main `4a95cae` 的直接 GitHub Linux Docker build/启动/health/HTTP smoke 基础范围（Run 39273438702），以及 PR #75 合成候选限定打包/default-closed smoke（Run 39312992630）；分别只证明对应 CI runner 与精确 commit，不代表 main 已合入或平台已部署。
- **PRODUCT GO：BLOCKED**：不能把 Docker 成功等同于 Mochi/Workshop 正式产品闭环。
- **DEPLOYMENT GO：BLOCKED**：public_url=NONE、未部署、无 registry digest/回滚 revision；平台/HTTPS/持久 POSIX volume 等未验收。

下一步是交接证据与补测缺口；本报告不批准合并、上线、发布生产镜像或付费请求。
