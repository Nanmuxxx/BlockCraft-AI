# DeepSeek 密钥录入与启用清单（负责人独立执行）

状态：**DRAFT / NOT READY FOR SECRET INJECTION**。这份清单不是注入、付费调用、部署或合并授权。共享决策与验收签字仅记录在 [Issue #57](https://github.com/Nanmuxxx/BlockCraft-AI/issues/57)，参见 SECRET-1（6271035745）。

## 责任与边界

- 项目负责人独占魔塔 Studio 账号、真实密钥与 Secrets 管理；Agent 不索取、不查看、不传输真实密钥。
- 只有服务端进程可读取 `DEEPSEEK_API_KEY`。不得使用 VITE_/NEXT_PUBLIC_ 等公开前缀，不放前端配置、请求参数、URL、Git、.env 文件、Docker ARG/ENV、构建缓存或CI变量。
- 能改运行代码、启动命令、镜像、构建脚本或进入容器的人，可能在后续运行中读出运行时密钥。Secrets 页面隐藏值不足以证明负责人独占。不要把“有权限部署代码”与“无法接触密钥”同时当成已成立的事实。
- 所有准备验收使用全新临时账本、合成 canary 和 Mock Transport；真实账本不得初始化、重置、修复、删除或改额度。
- 冻结初赛候选独立运行。安全研发候选不得覆盖当前展示版本。

## 阶段 0：注入前核验（无密钥）

以下全部通过前不要录入密钥。每项在 #57 附精确 SHA、证据链接、执行人及 PASS/BLOCKED。

- [ ] 确定最终 Core+Gateway 组合的完整 commit SHA、基线、Draft PR和镜像标识；CI检出的实际SHA与候选一致。证据变更后重新确认，旧SHA的PASS不自动继承。
- [ ] 服务端生产启动入口已接可信身份、持久预算、持久幂等和受控Transport；显式开关默认关闭。仅设置 DEEPSEEK_API_KEY 不能启用。
- [ ] 可信 principal 来自服务端验证过的会话/签名断言；验证签发者、受众、过期和撤销等实际机制。不能信任浏览器自报用户ID、IP、Origin、Host或一个固定true回调。Studio管理员身份不等于应用终端用户鉴权。
- [ ] 缺配置、身份验证失败/超时/异常、预算耗尽、存储故障一律拒绝，不降级匿名、内存账本或任意fetch。未鉴权、仅key、无principal测试均零reserve/egress。
- [ ] 幂等key由可信principal隔离，绑定规范请求；重复/并发/重启至多一次reserve/egress，payload不符拒绝。未知结果保留claim并halt；无自动重试，不能通过换进程绕过。
- [ ] 仅一个进程/副本；私有POSIX持久卷具备独占创建、原子rename、fsync语义；非root运行，目录0700、账本/lock/sidecar0600。同卷重启账本和claim不丢失。临时容器文件系统不算持久卷。
- [ ] 预检卷不可用/满盘/损坏/冲突/锁异常失败时不会先触发上游请求。stale lock和uncertain条目必须走人工审计，不能自动删除。
- [ ] Transport固定DeepSeek官方TLS目标、禁止重定向/自动重试，超时/断连可终止，响应大小有上限。应用所需其他网络访问与付费出口分开核验，不把客户端传入URL当网关目标。
- [ ] QA独立使用Mock完成HTTP→合法AppSpec→ProjectState→B可编辑/C可运行；非法AppSpec、失败、401/503/504保留现有项目；不执行任意生成代码。
- [ ] 合成canary验证HTTP body/headers/错误、浏览器网络与storage、日志、dist/source maps、导出ZIP、镜像层/历史和构建日志均不含canary。测试须注入上游错误/恶意回显，不仅搜索源码。真实密钥绝不用于扫描测试。
- [ ] **Studio平台证据**：确认Secrets对构建与运行的实际可见时机、镜像/日志/终端访问者、仓库/镜像/启动命令可修改者、自动构建与部署触发者；明确每项实际平台能力与证据时间。不清楚就是BLOCKED，不猜测UI。
- [ ] 确认负责人独占真实部署入口；Agent无Studio登录凭证、终端/exec、Secrets、运行日志含敏感配置等访问。代码变更不能自动重建带secret的生产实例。若平台无法隔离，保持关闭，由负责人选择受控发布隔离方案；不自行改权限。
- [ ] 明确可用的“关闭生成”控制和无付费候选回滚路径，且保留原卷/账本/claim；记录当前冻结展示SHA与部署标识。不得通过重置预算“回滚”。
- [ ] 独立Tech Lead在 #57 针对最终SHA给出 **READY FOR SECRET INJECTION**，列出仍存在的限制。作者自测或Supervisor调度成功不替代独立签字。
- [ ] 项目负责人在 #57 明确批准“向指定Studio候选注入密钥”，说明候选SHA、环境与范围。没有批准不得录入。

若无法从Studio验证权限/卷而需要负责人操作，只提供不含secret值的权限说明、配置选项/截图裁剪或平台文档链接；不要发送账号密码、token或密钥。实际平台菜单尚未经核验，因此本清单不编造菜单路径。

## 阶段 1：负责人录入（仅在阶段0通过并明确批准后）

1. 负责人自行在可信设备登录正确的Studio项目，核对项目/候选SHA与批准记录。不要把登录会话、验证码或屏幕控制交给Agent。
2. 再确认生成入口仍默认关闭，自动构建/发布触发受到负责人控制；若保存Secrets会自动启动或重建实例，先停止，不能把录入当成无副作用操作。
3. 通过平台确认的 **Secrets** 配置机制创建服务端变量名 `DEEPSEEK_API_KEY`，将真实值仅粘贴到Secret值字段。不要放普通公开变量，不写入仓库文件或命令行，不生成携带真实值的截图。
4. 只记录变量名、设置时间、目标环境与操作者；不记录值、前后缀、哈希、长度截图或可恢复的导出。密钥若进入聊天/日志/仓库，停止启用，通知负责人按事件处置并自行轮换。
5. 不运行env/printenv、set -x、docker inspect、进程dump或调试页面来“确认密钥”。配置存在性只能用经过审核、无secret值的布尔结果；健康检查不得调用DeepSeek。
6. 本阶段不授权重启/部署/公网切换/真实请求。如果平台要求这些动作才生效，保持待执行，由负责人另行明确批准。记录“已录入但未启用”，不要声称真实AI已验证。

## 阶段 2：候选启用、真实烟测与公开发布（分别审批）

- 启用前重新核对Tech Lead签字SHA、身份配置、卷与既有账本状态，所有检查保持默认拒绝。实际启动命令/开关名应引用最终候选文档；当前未定，不应猜测。
- 负责人分别批准目标候选启动/部署、真实付费烟测、公开入口切换。批准注入不等于批准这三项。
- 若批准付费烟测，批准记录必须限定环境、可信测试身份、请求数量、已有预算上限和停止条件；不得为了烟测增加额度或重置账本。任何额度变更单独审批。
- 先验证无身份/伪造身份拒绝且零付费出口、health不触发模型，再由负责人在批准范围内执行最少量真实请求。Agent不能代为运行未获批准的请求。
- 验证响应为合法AppSpec且B/C可操作，并明确标记“真实在线生成”；Mock或录制回放不得作为真实DeepSeek成功证据。
- 一旦超时、未知结算、异常出口、权限不符或secret泄露，停止后续请求。关闭入口，保留账本/claim/锁和脱敏事件记录，交负责人审计，不自动重试。

## 阶段 3：关闭与回滚

1. 优先关闭生成入口/停止接收新生成请求，验证拒绝与零新增出口；有在途请求时使用已验收的drain流程，不强行解锁。
2. 回到已确认的离线展示候选或批准的无付费版本；生产变更仍由负责人批准执行。
3. 保留相同持久卷和原账本/幂等记录，不删锁、不删除数据、不改变额度。关机不等于未发生费用，unknown/uncertain必须审计。
4. 若需撤销/轮换真实key，由负责人在DeepSeek/Studio自行操作；不要把轮换值交给Agent。
5. 在 #57 仅记录脱敏结果、SHA、时间、停止原因及后续审核项。

## 无秘密签字模板

```text
[SECRET-INJECTION-REVIEW]
candidate_sha:
image_id_or_digest:
core_pr / gateway_pr / qa_evidence_pr:
ci_run_and_actual_checkout_sha:
identity_source_and_validation_evidence:
storage_replica_permission_restart_evidence:
studio_build_runtime_deploy_permission_evidence:
mock_and_canary_acceptance:
real_model_calls: 0
remaining_risks:
tech_lead_independent_verdict: READY | NO-GO
tech_lead_report_url:
owner_injection_approval_url: NONE | explicit approval
deployment_approval_url: NONE | explicit approval
paid_smoke_approval_url: NONE | explicit approval
public_switch_approval_url: NONE | explicit approval
```
