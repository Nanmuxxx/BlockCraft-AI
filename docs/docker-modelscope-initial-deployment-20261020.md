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
| Studio secrets / variables | 留空 | 此轮没有任何秘密或运行配置需要注入 |

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
| main SHA/tree、Dockerfile、`.dockerignore`、`ms_deploy.json`、启动监听及默认匿名拒绝 | PASS（静态源码核查） | SHA `4a95cae…`，tree `b19a52f…`；不表示平台实际运行 |
| Docker image build/本地容器 | NOT RUN | 当前环境没有 Docker/Podman/nerdctl；历史 CI 不等于 ModelScope 构建 |
| ModelScope 网页目录/ZIP 上传与 `.dockerignore` 保留 | NOT TESTED | 必须由 Owner 登录目标 Space 后按实际 UI 验证；不得假定 ZIP 自动解包或隐藏文件保留 |
| ModelScope 平台构建、运行状态、健康、页面与 API smoke | BLOCKED / NOT TESTED | 空间尚无部署内容，实际应用 origin 未提供；必须等单独部署授权 |
| DeepSeek / 付费模型请求 | NOT RUN | 无 Key；此包不需要/不要求密钥 |
| HTTPS、公网 URL、ACL、公开切换、平台 Secrets、回滚 | NOT TESTED | 部署前和授权后分别验证；当前无旧 revision |

## 责任边界与交接

- Docker owner：只维护 `Dockerfile`、`.dockerignore`、`ms_deploy.json`、Docker CI 和 `docs/docker-*`。提交首次包的源 SHA、文件清单、命令、具体验收断言和失败处理。
- Tech Lead：独立只读检查目标 SHA/tree、Docker build 入口、监听/端口、无密钥默认拒绝，以及首次部署建议；不能把静态检查升级为目标平台 PASS。
- Supervisor：汇总 Docker/Tech Lead 证据后，向负责人提交一次包含目标空间、精确源 SHA、资源档位/费用确认、私有首次构建与验收步骤的具体部署授权请求。
- Owner：在收到单独授权后亲自在 ModelScope 操作；核对目标和费用、用页面所示 Git 操作或文件上传、保存平台生成 revision 与 build/run 证据。没有授权前只停留在“空间文件”状态。

DOCKER GO、首次平台构建通过、PRODUCT GO 和 DEPLOYMENT GO 是不同结论。当前整体状态仍是 **BLOCKED — INITIAL MODELSCOPE DEPLOYMENT NOT COMPLETED**。
