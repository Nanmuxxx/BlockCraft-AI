# T2：真实图片供应商与费用复核

查询日期：**2026-10-29，Asia/Shanghai**。独立 Cost-Security 文档研究；未登录供应商控制台、读取密钥、调用生成 API 或修改任何预算。参考代码 HEAD：`77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad`；main/base：`bcb6c1a7402ad4b4514feb4865c38d769d7244d1`。关联 [#91](https://github.com/Nanmuxxx/BlockCraft-AI/issues/91)、[#92](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92)。

## 推荐及官方能力比较

**首选候选：Qwen `qwen-image-2.0-2026-03-03`，Singapore International，1024×1024，n=1。备选：OpenAI `gpt-image-2.5-flare-2026-09-08`，1024×1024、low、PNG、n=1。** 首选理由是固定版本、现有离线请求 schema 可复用、按张计费容易保守预留；代价是必须另做安全下载。备选直接返回 Base64，减少 URL 获取攻击面，但 token 费用最大值仍需验证。这是工程推荐，不是质量实测或用户授权。

| 项目 | 阿里云 Model Studio Qwen 2.0 | OpenAI GPT Image 2.5 Flare |
|---|---|---|
| 模型与版本 | 当前官方仍列出 `qwen-image-2.0-2026-03-03`；2.1、3.0 已存在，不能因价格更低自动替换旧 schema。[Qwen API](https://help.aliyun.com/en/model-studio/qwen-image-api) | 当前指南推荐 2.5 Sunburst/Flare；Flare 有上述固定快照。[模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) |
| endpoint / 鉴权 | `POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`；服务端 Bearer Key。旧 `dashscope-intl.aliyuncs.com` 仍可用；北京/新加坡 key 不通用。[API](https://help.aliyun.com/en/model-studio/qwen-image-api) | `POST https://api.openai.com/v1/images/generations`；服务端 Bearer Key。明确 model，不走浏览器，不启用 Responses 额外模型工具链。[API](https://developers.openai.com/api/reference/resources/images/methods/generate) |
| 输出 / 分辨率 | PNG URL；总像素 512²–2048²，默认 2048²，n=1–6；本项目固定 1024²、n=1。[API](https://help.aliyun.com/en/model-studio/qwen-image-api) | Base64；PNG/JPEG/WebP；推荐 1024²、1536×1024、1024×1536；自定义尺寸必须满足 API 限制，2560×1440 以上属实验范围。本项目固定 PNG 1024²。[API](https://developers.openai.com/api/reference/resources/images/methods/generate) |
| 官方公布费用 | Singapore：**$0.035/输出张**；2.0 无按分辨率分档。2.0 Pro $0.075；较新 2.1 Turbo $0.016。不同模型/区域不混算。[国际站价格](https://www.alibabacloud.com/help/en/model-studio/model-pricing) | Standard：文本输入 **$5/M tokens**，图像输入 $8/M，图像输出 **$30/M**；Batch 的 $2.50/$15 不适用于本次同步调用。[价格](https://developers.openai.com/api/docs/pricing) |
| 限流 | 官方该版本 Singapore 2 次/秒；额度按账号聚合，并非每个 Key 独立。本项目建议并发 1、最多每分钟 1 次。[限流](https://www.alibabacloud.com/help/en/model-studio/rate-limit) | 模型页 Build 为 20 IPM / 250k TPM，免费 tier 不支持；实际账号额度未核实。[模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) |
| 超时 / 取消 | 所选 API 同步返回；已阅资料没有确认可终止远端生成并免计费的 cancel 协议或超时 SLA。客户端断开须视为结果/费用未知。 | 指南称复杂请求可约 2 分钟；Images API 未见独立取消 endpoint。Responses cancel 不能移植为 Images 的取消保证。[指南](https://developers.openai.com/api/docs/guides/image-generation) |
| 审核 | `DataInspectionFailed` 可表示输入或输出安全拦截；不等于项目儿童使用场景已通过审核。[错误码](https://www.alibabacloud.com/help/en/model-studio/error-code) | 提示词和结果有过滤；保留 `moderation:auto`。不得因拒绝而自动降到 low 或换供应商。[指南](https://developers.openai.com/api/docs/guides/image-generation) |
| 获取与保留 | 临时公共 URL 有效 24h、之后清除；需服务端及时下载到候选存储。此期限不能推断全部输入/审计日志保留政策。[API](https://help.aliyun.com/en/model-studio/qwen-image-api) | 直接有界读取 JSON/Base64；Images 无应用状态保留，默认滥用监控 30 天；ZDR 有条件，不是默认已开通。[数据控制](https://developers.openai.com/api/docs/guides/your-data) |

本表 Qwen API 事实摘要限于所选 2.0，同页的新域名变化应与实施者确认。现有 `server/image-generation/supplier-contract.mjs` 只构造/检查离线信封；没有已授权 transport、下载或结算能力。

## 单张估算与分辨率差异

- Qwen 所选操作：一张成功图的官方模型计算价 $0.035，3 张为 **$0.105**；这是价目表算术，不是账单。失败请求/处理错误按官方指南不收费，但网络超时无法证明服务端失败。[计费规则](https://www.alibabacloud.com/help/en/model-studio/text-to-image)
- Flare：估算公式 `(文本输入 tokens × 5 + 图像输出 tokens × 30)/1,000,000`。假设 1,000 输入及 2,000 输出 tokens，则 **$0.065/张**；输出改为 7,000 tokens 则 $0.215。这里的 token 数是规划假设，**不是 1024² low 的实测/官方固定张价或上界**。分辨率和质量影响输出 tokens，不能假设像素翻倍就费用翻倍。[官方费率](https://developers.openai.com/api/docs/pricing)
- 作分辨率参考，官方指南仍列 GPT Image 2 输出估算：1024² low/medium/high 为 $0.006/$0.053/$0.211；1536×1024 为 $0.005/$0.041/$0.165，另加输入。**不能把这张 GPT Image 2 表套给 2.5 Flare。** `gpt-image-1` 已于 2026-10-23 停用。[指南](https://developers.openai.com/api/docs/guides/image-generation)
- 上述不含税费、汇率、对象存储、出网、解码计算及额外独立审核服务。不假设免费额度或活动价，也没有确认当前账号余额、区域资格、实际费用/退款或账单时延。

旧报告里的 OpenAI 单张 $0.0085 不能直接作为新 2.5 标准调用预算。当前价格页 Standard 与 Batch 并列，应绑定具体操作与价目快照；未完整核实标准模型行时不得从 Batch 推导同步费用。

## 部署、下载与费用控制设计

源码 `ms_deploy.json` 表明项目面向 ModelScope Docker/7860，`Dockerfile` 使用 Node 24、非 root 用户，但没有证明实际部署国家、网络出口、持续磁盘或可信图像身份/账本已经可用。OpenAI 支持列表包含新加坡、未列中国大陆；不能据用户语言推断其账号/部署资格，也不能用代理绕过限制。[支持地区](https://developers.openai.com/api/docs/supported-countries) Qwen 必须核实账号所在站点、地域 Key、workspace 和 International 部署范围；本次没有探测生产网络。

Qwen 下载只允许由受批准配置指定的精确 HTTPS 主机，不按任意 `*.aliyuncs.com` 放行；每次解析和连接均拒绝非公网地址，禁止重定向、凭据 URL、非 443 端口，固定连接地址与 TLS 主机名防 DNS 重绑定。下载字节、总耗时与解码内存全部有界；URL/查询签名不进入日志或浏览器。Base64 同样先限 JSON/字符/解码长度，再校验 PNG 实际结构、尺寸与有界解码。现有单图 512 KiB 不能保证容纳模型原图；规范化或拒绝要保留已发生的费用，不能自动重新生成。

建议未来**单独审批**的 Qwen 隔离测试范围：固定上述版本/区域/尺寸/n=1，最多 3 次派发、先做 1 次成功后核对账单，再做下一次；每次保守预留 $0.05，**总最高 $0.25 USD**，并发 1。$0.05 仅是该 $0.035 操作的规划预留，不证明包含税费等全部费用；批准前须把明确计费口径/价目证据补齐。剩余预算不允许尝试别的模型。未批准、过期或费用无法核对时派发数为零。备选 Flare 不共享这份预算，需另行证明安全费用上界并审批。

持久事务同时保留 user/project/global/approval 范围、幂等 key、请求摘要、币种、价格版本与最大成本；预留和派发标记持久化后才可一次性 egress。超时、取消、断连、崩溃、未知账单均保留预留并暂停该批准范围的后续派发；只读对账不自动重新生成。成功生成但下载/审核/存储失败仍记成本。服务重启、日期翻转或清浏览器状态不能清债；生产默认关闭。供应商建议的退避重试不覆盖本项目“未知费用不自动重派”的限制。

## 本轮证据与限制

实际读取官方页面及上述源码，无 REAL 请求；质量、延迟、输出体积、账单一致性、真实取消/退款、区域账号资格、儿童输入输出审核、生产持久账本均 **UNVERIFIED**。Qwen 隐私页面工具访问失败，因此没有宣称所有输入数据只保留 24h。OpenAI pricing.md 被 web 工具拒绝 `Unsupported content-type: text/markdown`，使用已成功打开的 HTML 价格页，不把读取失败当成服务 API 失败。

只读排障记录：`rg -n 'ModelScope|modelscope|Singapore|ap-southeast|deployment' Dockerfile docker-compose* server/README.md docs/acceptance/image-backend-cost/design.md` 在 zsh 5.9 arm64 报 `zsh:1: no matches found: docker-compose*`，退出 1。依 [zsh 官方 filename generation](https://zsh.sourceforge.io/Doc/Release/Expansion.html) 确认未匹配 glob 导致 shell 先拒绝；改用 `rg --files` 查实际文件再读取，退出 0。没有改 shell 配置或仓库源码。

```text
[REPORT]
role: Cost-Security
base_sha: bcb6c1a7402ad4b4514feb4865c38d769d7244d1
head_sha: 77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad
pr: NONE
status: PARTIAL
completed: 2026-10-29 官方供应商/版本/接口/费率比较；首选与备选、费用不确定性、拟审批预算和安全设计；未改源码/共享契约
tests: OFFLINE read-only source inspection; docs web reads; no model call; REAL_PROVIDER=NOT_RUN
blockers: provider/model/budget not approved; identity/ledger/deployment eligibility and actual billing unverified
next: Supervisor 将研究并入实施提案，补齐可信身份/账本与精确费用上界后提交独立付费测试审批
approval_needed: NONE
```

上述 NONE 仅适用于已完成的研究；后续须分别获得 PAID_API、SECRET、BUDGET 等所需批准。
