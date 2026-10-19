# ModelScope 首次部署操作与审批包

状态：BLOCKED — INITIAL MODELSCOPE DEPLOYMENT NOT COMPLETED。未上传、构建、启动、设置Secret或公开切换。

## 精确目标

- 空间：https://www.modelscope.cn/studios/Nanmuxxx/BlockCraft-AI-Fullstack
- GitHub main：4a95cae50f772cd242d932cdbd93366381d1df74（冻结，未改）。
- 产品候选PR75：7a2adbbfaa1d8bfd3c8853a4d204d1d6532bbe8a；tree f3d6757dd3880eba3426c96fb33e1b18a53e49f0；仍Draft，不要求先合并main。
- ModelScope master只读基线：7637f1bde9fcb8989c805dca4eef9eacc3ae120e，只有README.md和.gitattributes。实际写入前重新读取；有变化就重算，不覆盖远端历史。
- 完整可恢复源码：[固定SHA下载](https://github.com/Nanmuxxx/BlockCraft-AI/archive/7a2adbbfaa1d8bfd3c8853a4d204d1d6532bbe8a.tar.gz)。逐blob清单：modelscope-candidate-7a2adbb-manifest.json（与本文同目录）。Hash不能代替文件；该URL绑定实际远端源码。
- 清单：746普通blob，20,732,372bytes，最大495,835bytes；无LFS指针、symlink或submodule。目标README原样保留，.gitattributes保留平台LFS规则并追加候选规则；预计overlay747paths。平台大小限制/实际导入未验。

## 已完成的验证与边界

组合源代码326e961/tree4df727与候选的产品代码一致，后续仅添加证据：Python/OpenSSL向量、generation109/109、TypeScript/Vite build、HTTPS Chromium登录→自然语言Mock生成→B→C25分钟启动/暂停/重置→B/C保留→replay401均PASS。精确0.0.0.0:7860启动/health200/匿名401、缺失损坏配置和缺失账本统一失败、0upstream也PASS。证据位于候选docs/acceptance/studio-hardening-composite-20261020/。

新候选云Docker CI39316292354发布时仍IN PROGRESS，待独立读取完整Job/实际checkout/tree。旧CI39312992630只覆盖7bc5/tree7b33，实际checkout为e7673eaf合成merge。不得用旧绿灯为新SHA背书。

历史本地REAL AI PASS单独绑定e4d65ac，1真实请求/616tokens；不是当前Studio候选的真实或公网验收。PUBLIC PASS BLOCKED。完整镜像/secret内容扫描、目标ACL/存储/TLS/实际启动、费用连续性未验。

## 构建和文件结构（Agent准备，负责人不需修代码）

根目录Dockerfile、.dockerignore、ms_deploy.json、package.json、package-lock.json、index.html、vite.config.ts、tsconfig.json；src/public/server递归保留。使用完整固定SHA源码及manifest核对，避免手工挑文件遗漏；.git、本机node_modules、生成dist、私有配置和账本不上传。

Dockerfile：node:24-bookworm-slim双阶段，npm ci→npm run build→npm --prefix server run build→挑选runtime文件；USER node；EXPOSE7860；默认CMD node server/index.mjs。ms_deploy.json：sdk_type=docker、port7860、platform/2v-cpu-16g-mem。资源费用与配额由Owner在平台确认，不能假定免费。默认CMD不注入generationAccess，生成请求401；不配置Key亦可检查容器/静态页面。这是平台基础验收阶段，不是以离线功能替代真实AI目标。

## 负责人最少操作（必须先明确批准对应动作）

1. 打开空间“空间文件”，确认账号确为Owner；不要在聊天/Issue/命令参数粘贴任何Token或Key。确认Docker资源可用，账号绑定/实名满足要求；保持私有或受限访问。具体按钮名称以实际页面为准，本轮未验证部署设置UI。
2. 批准“将固定候选按manifest导入上述空间并以默认关闭入口首次构建/运行；不注入Key、不启用付费生成”。此批准不包括真实AI开放。Agent可完成本地overlay、清单与代码排障；仅Owner完成平台要求的登录/写认证。终端认证失败时可使用网页上传，前提是页面实际支持目录/多文件导入；未核实ZIP自动解包，不应直接把压缩包当部署文件。若网页不支持大量文件上传，使用页面给出的Git clone地址与Owner本地安全凭据管理器；不再让组员发送Token。
3. 技术执行者从目标master建overlay提交（以它为父，非GitHub直接push），保留README/合并attributes，复核差异无删除，再由有权限Owner按平台认证push。push或上传提交可能自动触发部署，必须在第2项批准后；禁止force push。记录最终ModelScope overlay commit，而非冒称与GitHub同SHA。
4. 平台构建/运行成功后提供页面显示的实际App URL/revision；Agent负责收集脱敏build/run证据并安排QA。不要猜/studios页面就是服务origin。
5. 仅在平台Mock/安全门禁和真实账本连续性核对完成后，再独立批准真实Secret注入/付费启动/公网可见性。Key仅Owner在实际受保护的运行时Secret设置输入；如果平台不能区分构建/执行/日志权限或不能保护Secret，停止，不复制本机私有文件上平台。

## Studio真实入口：已验命令，不是已获部署授权

镜像工作目录/app；现有模块startStudioServer支持host/port。QA验证的可选平台启动命令：

```sh
node --input-type=module -e "import { startStudioServer } from './server/studio-launcher.mjs'; startStudioServer({host:'0.0.0.0',port:7860}).catch(()=>{console.error('STUDIO_START_REFUSED');process.exitCode=1})"
```

需要DEEPSEEK_API_KEY（仅运行时Secret）、精确HTTPS PUBLIC_ORIGIN、STUDIO_APPROVAL_PATH指向已审批私有配置。无有效approval/issuer/持久账本时拒绝启动，不自动创建或回退匿名入口。不可只设Key就开放。平台是否支持安全命令覆盖未验；若不支持，由Agent在独立PR准备最小入口变更并重新CI/审查，不能临时关闭鉴权。

## 真实AI前的平台安全门禁（先用合成数据，不读真实Secret）

- 单进程/单副本、稳定service UID；私有本地POSIX持久卷跨重启保持，0700目录/0600普通单link文件；验证exclusive lock、原子rename、文件/目录fsync与故障恢复。官方/mnt/workspace仅说明持久目录，不证明全部语义。
- Owner独占Secret、代码/构建定义、执行命令、重启、日志管理和版本切换权限；开发Agent只能受控测试接口。Secrets列表不返回value，不等于ACL已合格。
- TLS实际origin、cookie Secure/HttpOnly/Strict、登录/匿名/伪造/重放、限流、幂等、原子预算预留、并发1、max3请求、2048output token、30s超时/0自动重试及fail-closed。不能把独立Mock结果当实际平台证明。
- 已发生1次local真实调用。local profile/ledger与Studio格式不同，当前可用剩余额度未建立：禁止copy/rename/新空账本、重置或恢复旧state以获得额度；由Owner批准明确连续性方案后Agent开发与合成验收。¥19.998378仅已知单次估算余额，不是账户实查或新的Studio授权。
- 当前deepseek-flash定价CNY2input/8output每百万，快照有效到2026-10-21 00:00 Beijing；到期或价格/在途/账本不明保持拒绝，不盲目续期。

## 验收、停止与失败处理

默认关闭首次运行：真实URL下health200、静态资源/页面路由、B/C离线操作、匿名v1/v2401、零模型请求；保存GitHub SHA、Studio overlay/revision、build/run日志及截图。平台基础PASS不等于真实AI PASS。

真实入口另获批准后：同一“帮我做一个25分钟番茄钟”经过真实受控DeepSeek→合法Schema→Runtime start/pause/reset，录屏和脱敏上游request/token/耗时证据；记录PUBLIC PASS或明确失败点。禁止Fixture冒充。

发生构建/启动/安全异常：一次收集通用错误及脱敏日志后停止，不无限重建或自动重试付费；Agent在独立分支修复/Mock/审查后再请求新候选批准。首次部署无历史可用镜像，所谓回滚只能停止/撤下本次候选，不能声称回到已运行旧版。真实服务需停止接收新请求、drain并结算在途、保留同一账本/issuer状态及挂载，Owner从平台停止实例；不删锁、不恢复旧账本、不换卷、不自动重启补额度。

## 审批状态

OWNER_APPROVAL_REQUIRED：首次目标空间写入/构建/启动；真实Secret注入与费用连续性方案；真实入口与公网开放分别批准。当前没有执行上述操作。Tech Lead范围GO和云CI均不代替Owner授权。
