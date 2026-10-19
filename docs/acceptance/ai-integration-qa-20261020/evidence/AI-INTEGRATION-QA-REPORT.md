# AI-INTEGRATION-QA — 独立验证与断电交接

报告时间：2026-10-20 00:58 北京时间。接收方：Issue #57 的 Lead / Supervisor。

状态：本轮独立 QA DONE；真实生成上线 BLOCKED / NO-GO。真实 DeepSeek NOT TESTED，真实模型调用 0。未修改产品代码；未合并、部署、读取生产 Key、修改预算/定价授权。产品修复仍须由 Lead 分配原 Owner。

已读取 Lead 离线检查点与决策：
https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6272482713
以及 00:55 heartbeat 6272538696。只延续独立验证和保存，不启动新的长期研发。

## 精确版本与证据来源

下表是本轮 00:53 左右独立读取的快照；恢复后必须 fresh fetch，不能把本表当作后续状态。

| 对象 | 完整 SHA | 本轮范围 |
| --- | --- | --- |
| main | 4a95cae50f772cd242d932cdbd93366381d1df74 | 对比、CI 元数据 |
| PR #56 | 7d00712a2e11494eac9cd2e5bf83fb147d553d56 | 接口与 CI 元数据 |
| Core #61 | 84e61496868b6dea161782c8c3b821df3a0d039f | 接口、组合来源 |
| Gateway #63 | 1c0bd2672a53756ac9a0e8f537cf3320b6c2e01f | 接口、组合来源；base 63a4ab2b65b9ffba72875a383a4ad82f472725fe |
| 组合 #68 | d6f2cb4f110d22f665690e3af1d818249cc03b99 | 本机所有直接测试的代码版本 |
| QA #59 | 31ef69bfbacaa02385a23736fd2735212a947c85 | 相关证据版本核对 |
| QA #60 | dc064a929cc7946749b29d625a73b3e213c257ca | 相关证据版本核对 |
| QA #62 | a087a161eee1e12f03b6084f6ed799711751466e | 相关证据版本核对 |
| QA #67 | 374c7e443ae9012655bee8ae95cc3cff4a344f11 | 相关证据版本核对 |
| 独立 QA #69 | 7e6af81b067f54e28187fe6fe1a51357fe6e0ed1 | 读取 REPORT.md、browser/report.json；未本机重跑浏览器 |

00:55 之后 Issue 新增 Gateway #71 HEAD 0abfe8454d4679ac323cd73754a52dcb82460541，base #63。已读取 Owner 报告与 Supervisor 派发 6272529089；Tech Lead 负责独立只读验收。本轮不将其 Owner 自述 41/41 计为独立 PASS。

#68 由 Core #61 与精确 Gateway #63 delta 组合。本轮未发现此前所称 fetchImpl/model 遗失：实际使用 requestOptions.fetchImpl / requestOptions.model。

## 接口兼容性检查表

| 接口/边界 | 已核契约与结果 | 限制 |
| --- | --- | --- |
| Gateway 导出 / Core 导入 | createPrincipalPaidGenerationRuntime({env,bindingKey,fetchImpl?,timeoutMs}) → 冻结的 forRequest / close；命名和使用一致，server build PASS | 不是生产初始化验收 |
| 请求上下文 | forRequest({principal,idempotencyKey,payload}) → 冻结的 {apiKey,model,fetchImpl}；一次性上下文、HMAC 绑定、共享并发 | POSIX runtime 完整本机执行受限 |
| 请求参数 | principal 为服务端身份；key 为32–128位 [A-Za-z0-9_-]，前端 UUID 满足；payload={idea,protocol?}，缺省 v1 | 不接受客户端自述为可信 principal |
| HTTP / 前端 | POST /api/ai/generate；单个 Idempotency-Key；same-origin credentials；redirect:error；鉴权在解析/上游前 | 生产 cookie/身份签发尚未证明 |
| legacy 响应 | 200 为裸 AppSpec v1，前端 assert；Schema 校验后进入 B/C 与 Runtime | CRLF checkout 存在下述 P1 |
| interactive 响应 | {protocol:'trusted-interactive/1',spec,provenance:{source,model}}；严格 v2 pomodoro 校验与独立 gate | 不扩展为任意 TSX 能力 |
| provenance | 来自实际 requestOptions/model，而非进程默认值 | 静态检查与 Mock 范围 |
| 错误 | principal401；key/payload400；replay/conflict/context409；cancel504；storage/budget/pricing503；固定安全响应 | 真实上游未调用 |
| AppSpec / Runtime | root205覆盖 Schema、记录、布局、变更与 Runtime；LF generation fixtures 覆盖 HTTP→Spec→CRUD | 不等于生产鉴权+账本+浏览器整体打通 |
| 取消 | pre-abort 零 transport；忽略 abort 的迟到响应 body 被取消；卡住的 body reader 解锁；独立补测3/3 | Mock fetch；见 cancellation.log |
| shutdown | beginShutdown→停止 admission→有界 drain→必要时 abort→等待 handlers→runtime.close→sidecar/ledger；close 拒绝 active runtime | Windows 信号测试 SKIP；POSIX 生命周期仅 CI 日志核验 |
| 启动入口 | startServer 支持显式 bindingKey；CLI startServer({host,port}) 未提供 bindingKey | 生产稳定 secret 注入路径/批准仍缺；不得自行发明或读取 Key |

## 验收矩阵：直接执行、CI 核验与他人证据分开

环境：Windows，Node v24.22.0。两个干净 detached checkout 均为精确 #68；一份 core.autocrlf=true，另一份 false。npm ci --ignore-scripts 使用锁定依赖。子测试不继承应用凭据或任意 NODE_OPTIONS；preload 拒绝非 loopback fetch/http(s)，测试注入 Mock transport。该措施是纵深防护，不声称完整网络沙箱。

| 检查 | 独立本机结果 | 证据 |
| --- | --- | --- |
| server TypeScript / protocol build | 两种换行均 PASS | buildServer、protocol 日志 |
| root AppSpec / B/C / Runtime 等 | CRLF 205/205 PASS | root.log |
| TypeScript / Vite build | CRLF PASS | tsc.log / vite.log |
| generation CRLF | 29 PASS / 29 FAIL / 1 SKIP | generation.log；不是验收 PASS |
| generation LF | 46 PASS / 12 FAIL / 1 SKIP | lf/generation.log；剩余为 POSIX 私有权限拒绝，信号测试跳过 |
| server CRLF | 120秒 runner timeout，部分结果 | server.json / server.log；不得计 PASS |
| server LF | 39/39 PASS | lf/server.log；含 disconnect、timeout、忽略 abort、admission 清理、安全错误 |
| paid-gateway CRLF | 4 PASS / 37 FAIL | gateway.log；Windows LEDGER_PERMISSIONS，未绕过 |
| 额外前端取消 | LF 3/3 PASS | lf/cancellation.log；脚本 scripts/generation-cancellation.test.cjs |
| 浏览器本机 | BLOCKED：Edge 启动退出 | lf/browser.log；无成功截图或浏览器报告 |
| POSIX principal/ledger HTTP 全链路 | 本机 BLOCKED | 不削弱0700/0600保护 |
| 真实 DeepSeek / 公网 | NOT TESTED / NO-GO | 实际调用0；无部署 |

独立读取 #68 Actions 原始 job 日志：
https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39286576330

- run completed/success，job118174642772。
- 实际 checkout 是 merge dbcd9f7e08a756c26ebe7cd59fad741361bfaed2，parents main4a95cae… / #68d6f2cb4…；Git API 核对其 tree 与 #68 完全相同：c16eab10bc473b1be4b8267d2329f989d0cdb2ea。不是直接 HEAD checkout。
- 日志中 root205、server39、generation59、mochi-host57、trusted-interactive31、pomodoro-ui2、workshop-export9 均 PASS；Docker build/import/container smoke 成功。
- 此 CI 未运行完整 paid-gateway41 或浏览器。摘录存 evidence/ci-39286576330-excerpt.log；本机执行与 CI 日志核验不可混称。
- 之前读取 main run39273438702、#56 run39259896714、#61 run39285196408 success 元数据；#63/QA59/60/62/67 初查无 HEAD run，不能继承为 #68 证明。

读取独立 QA #69 的 browser/report.json：精确 #68、Chromium156.0.8078.4、1366/390两种宽度，每宽9个离线 fixture +5类失败保留+retry，B字段编辑/C记录 true，page/external/asset errors为空、realModelCalls0。此 harness 注入 legacy HTTP fetch，绕过 principal runtime/真实 ledger；其 Markdown REPORT 仍写 browser待验，与 JSON 不同步。本轮未执行其浏览器、未目视截图，故只记“证据已读”，不作为本机独立浏览器 PASS。

## 已确认缺陷：P1 Windows CRLF 协议读取失败

独立报告/申请原 Core Owner 分配：
https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6272456711

精确 #68 的 server/aiGenerationPrompt.mjs:19 用包含 LF 的固定字符串匹配 src/model/appSpec.ts：`source.includes(extension)`；CRLF 文件触发 `Review v1 protocol projection`，有效 legacy Mock生成可能502。两个干净同 SHA checkout 对照：CRLF FAIL，LF PASS。

最小复现（无需 Key、无需模型/网络调用，在仓库目录执行）：

```powershell
node --input-type=module -e "import {readV1GenerationProtocol} from './server/aiGenerationPrompt.mjs'; readV1GenerationProtocol()"
```

evidence/newline-probe.json 记录：CRLF44处，原始 SHA256 7f8db4b0b9bd64456bb5da9bfc4ed8bd3b328789f467e8fe0bc7cc5ccd4e9e5b；LF0处，SHA256 691d51d0c7aeb5df79fe3c8193c79ab3aca48e3807712149a2d9d666c8e119d1；CRLF归一化后同 LF hash。完整 stack 与 OS/Node/SHA 已保存。

这两个相关文件相对 main 无 diff，属于继承问题，不能归因于 #68 新增。建议原 Core Owner 对读取源文本归一化 CRLF，或明确强制 LF 并增加 LF/CRLF 回归。未自行修复、未跨写 Owner 文件。

## 上线阻塞与 GO/NO-GO

| 优先级 | 阻塞 | 解锁所需证据/Owner |
| --- | --- | --- |
| P0 | pricing有效期已在2026-10-20T00:00:00+08:00到期 | 仅授权人提供新的批准；当前日期必须拒绝且零上游流量。历史 Mock clock 不延长授权 |
| P0 | 生产可信身份/opaque session 签发与校验、稳定 bindingKey 注入未验收 | Core/Gateway/Lead 按现有批准边界提供验证方案；不得索取生产 Key |
| P0 | 单实例持久 POSIX私有账本卷、锁/fsync、重启/不确定支出关闭路径无本机完整证明 | 稳定 POSIX Supervisor 独立复测，保持0700/0600；不绕过保护 |
| P0 | 真实 DeepSeek→公网→B/C/Runtime 未测试 | 需未来明确 live-call 与部署授权；本任务禁止真实付费调用，不能自己解锁 |
| P1 | CRLF协议读取失败 | Lead 分配原 Core Owner，修复 SHA 后独立 LF/CRLF 复测 |
| P1 | 账本 reserve失败前 sidecar已经持久 claim；同key重启后409 | Gateway #71、Tech Lead 独立接受 consumed-key rejection 契约；不是缓存结果 replay；不得静默删除 claim 或自动重试 |
| P1 | Windows完整 Gateway/Principal测试与本机浏览器受环境阻塞 | POSIX/可用浏览器环境续测，报告精确 SHA；不得把 Owner 自述或其他 QA JSON 等同自身执行 |

预算/幂等静态检查：私有目录0700/文件0600；锁/fsync；不确定支出 halt；无自动 refund。claim 在 reserve 前持久化，因此 budget/expiry拒绝可出现 claim1/reservation0，之后相同 key409。Gateway #71 正补“重启、零egress、零新增entry”证据，由已派发 Tech Lead 验收；本机未独立重跑。

结论：Mock 子集 PASS / CI日志核验 PASS，有明确范围；完整本机端到端 PARTIAL。真实生成维持 NOT TESTED / NO-GO，保持默认关闭。

## 断电后的最小接手操作

1. 在 Issue #57 读取本报告后的全部 REPORT/DECISION；确认 Lead 分配与 Owner 边界。fresh fetch main、#68、#69、#71、后续修复完整 SHA/CI；无变化不重跑或重复评论。
2. 从分支 qa/wip-ai-integration-windows-20261020 取 docs/acceptance/ai-integration-qa-20261020/。它是证据 WIP 恢复点，不要合并到 main；首 checkpoint 943e95bf94e03cd43f96597ebe29a457dbc16a79 被保留。
3. 建一个 scratch 目录，把 scripts/*.cjs 放到 scratch 根；精确产品 checkout 放 scratch/BlockCraft-AI，LF对照 scratch/BlockCraft-AI-lf。脚本默认输出 scratch/../outputs，QA_CHECKOUT和QA_OUTPUT可覆盖。npm ci --ignore-scripts 在产品 checkout 内执行。
4. Windows LF 复测命令（先检查新测试无真实流量）：`$env:QA_CHECKOUT='BlockCraft-AI-lf'`；`$env:QA_OUTPUT='lf'`；`node scratch/run-qa.cjs buildServer protocol generation server cancellation`。CRLF单独保留旧失败日志；`node scratch/probe-newlines.cjs` 仅离线读取源文件。
5. POSIX 稳定 Supervisor 在未修改权限守卫的精确快照运行 buildServer、protocol、generation、gateway、server；记录 OS/Node/原始日志/完整SHA。当前过期定价必须 fail-closed/零egress；针对 #71 由已分配 Tech Lead 验 consumed-key409 契约。
6. Core 修复被分配并提供新 SHA 后，只补必要 LF/CRLF 协议与 HTTP Mock 回归；产品修复不能写入本证据分支冒充 Owner 改动。
7. 浏览器在可用环境独立复测；区分 legacy Mock fixture 与 principal+ledger+鉴权+UI 的组合链路。Windows浏览器脚本需要隔离安装 Playwright，当前 Edge路径固定；不要为启动失败绕过环境保护。
8. 最终结果只在 Issue #57 报 Lead。禁止真实费用、生产 Key、预算/定价变更、未授权合并/部署。

## 持续执行边界

本聊天没有已建立的定时任务，也没有已确认接手执行的稳定在线 Supervisor；不能声称后台继续工作。已检索可用工具，无 automation_update 能力。openai-docs 技能核实官方文档：本地项目定时任务依赖电脑和桌面应用保持运行，不能作为断电容错。依据：https://learn.chatgpt.com/docs/automations?surface=app 。本轮不新建 Actions schedule、不擅自启用付费资源。Lead 可以从远端恢复点派发给已有稳定执行器；没有变化时保持安静，仅对新 SHA/新失败/需要授权事项汇报。

下一轮待验证：Core CRLF修复分配与新 SHA；Tech Lead #71独立验收；稳定 POSIX完整 Gateway测试；已授权身份/bindingKey/私有卷准备证据；新的批准定价。无上述实质变化则不重复测试。
