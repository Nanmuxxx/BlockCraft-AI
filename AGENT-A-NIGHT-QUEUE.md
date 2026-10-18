# Agent A 夜间任务账本

- 开始日期：2026-10-19（Asia/Shanghai）。约六小时窗口；所有结论以实际证据为准。
- 分支：`agent-a/ai-core-night-20261019`；worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-agent-a`。
- 基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。HTTPS fetch 已尝试，缺少凭据；已连接 GitHub `fetch_commit(main)` 核对同一 SHA。
- 开放 PR：#35 Docker（不触碰）、#36 Mochi Host 测试（不覆盖其测试文件）。已有 worktree/分支通过 `git worktree list`、`git branch -r` 检查。
- Agent B：`agent-b/react-zip-night-20261019`，正在修改 `tools/project-zip-export/templates.mjs`。本分支禁止编辑导出器、模板、部署及冻结材料。
- REAL_MODEL_CALLS=0。服务测试显式注入固定 Fixture；不读取 `.env`、生产密钥或私人材料。

## 当前任务（2026-10-19 04:47）

已完成第一轮链路恢复、生成/协议/取消修复和离线端到端验证；继续接口审计、核心回归、生产浏览器盲区与 Draft PR 准备。六小时窗口尚未结束，不声称已工作六小时。

当前：第十轮正式HTTP生成桌面/移动及取消竞态已完成，核心786/786通过；归档定位回调项目/取消门禁并继续纯文字安全浏览器测试。正式修改服务、隔离Viewer、付费语义验收和跨刷新设计仍受阻。详细本轮记录在末尾。

## 已完成与 Commit

- `fd861f9`：生成客户端 128 KiB/fatal UTF-8、45 秒截止、取消、v1/v2 分离。
- `b4c8c42`：最小选中上下文模型计划适配器；服务 HTTP→客户端→Runtime→Mochi 确认→B/C 离线案例。
- `dce2212`：服务端严格 completion 包络、UTF-8；测试命令/退出码记录器。
- `40f9db5`：不服从 AbortSignal 的传输/响应体仍按时释放服务并发。
- `0544d74`：既有 Mochi 浏览器用例通过模型 JSON seam 重跑。
- `c73edba`：v1 业务质量评估拒绝合法 v2，避免错误协议验收。
- `98865fe`：客户端/服务端未使用及迟到响应体取消。
- `e7feadc`：Mochi completion 不响应取消时立即退休；修正测试漏传 requestId。
- `ad36214`：CustomBlock Provider 相同边界、混合 error/工具包络拒绝。
- 源码计划：取消不再等待永不完成 provider；修复同步 abort 重入共享 epoch（9f42962）。

修改文件精确清单使用 `git diff --name-status 4044fb1...HEAD`。未编辑 Docker、导出器模板、冻结视频、PR #36 Host 测试或 Agent B 文件。

## 测试结论

每个命令、参数、开始/结束时间、退出码见 `docs/agent-a-night/logs/commands.jsonl`，原始输出保留（含失败及修复后重跑）。早期命令见同目录 legacy 日志。

- 生成/服务/响应体释放：56/56；模型计划与服务垂直：13/13。
- 生成/质量/CustomBlock/隔离/可信样本编译：187/187；只编译仓库审核样本，未执行组件。
- CustomBlock Provider+Pipeline：26/26；源码计划：37/37。
- 桌面/手机：生成、正式离线可信番茄钟、番茄钟替换竞态、Artifact 正式入口、Artifact 安装竞态、Mochi 模型计划 fixture、Mochi 正式只读建议全部通过。
- 生产构建通过，最新 build-after-source 退出码 0；后续源码变更仍需构建。
- 曾失败：构建前置产物缺失、质量评估版本边界、测试计数设置、漏传取消 ID、dispose 错误优先级、新重入复现。均保存失败证据，已针对修复重跑。

## 阻塞与下一任务

- Git HTTPS 无本机凭据：通过已连接 GitHub Git-data API 发布独立分支/Draft PR；不能称 fetch 成功。
- 真实 DeepSeek 付费调用未授权：REAL_MODEL_CALLS=0；继续已审核 fixture 通路。
- 正式 Mochi 修改入口仍 unavailablePlanProvider；新 seam 不隐式启用付费或网络。需要独立服务鉴权/费用接口契约。
- 任意 TSX Viewer 缺少验收隔离后端：保持 execution denied。
- 会话内参数保存/重装已测，不提供跨刷新持久化。保留版本历史可能长期增长，需设计保留策略而非直接删除回滚证据。
- 下一步：归档已发布至80c32a3的差距矩阵和浏览器证据，发布ff61d48及本轮账本；继续检查源码与Artifact安装映射、Owner/CAS及协议兼容边界。

- 最新完整核心回归 core-complete：568/568；正式 CustomBlock Workshop 桌面/手机均通过。
- `4c40e94`：Mochi instruction+选中上下文 UTF-8 64 KiB 出站限制；model-request-bound-fixed 14/14（首次测试使用错 fixture 层级，已保留失败）。
- 接口契约已写入 `docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md`；生产修改传输及 Viewer 仍待独立验收。

## 第二轮进展（02:32）

- Draft PR #40 已创建并关联；通过 GitHub Git-data API 发布21个提交，逐一验证blob/tree SHA。远端HEAD `a638a31df15ccde8562807682244959380843ed9`；本地HEAD `031eac6`，文件树相同。
- `5ac2d22` 源码注册表取消39/39；`49627e8` 建议客户端传输/严格UTF-8；`baeffb1` 会话取消/同步重入25/25。
- `a0c8eec` Artifact prepare取消/替换/关闭，安装及源码相关63/63；首次夹具同摘要未触发目标查询，修正后旧代码3项超时、新代码通过，日志均保留。
- `031eac6` Mochi HTTP严格UTF-8、可信access五秒上限、断连取消；23/23。
- core-checkpoint622/622，构建0，正式Artifact桌面/移动通过。Mochi页面并发Vite时初始输入框超时；串行重跑通过（浏览器缓存冲突为待确认原因）。
- 阶段报告 `NIGHT-AGENT-A-REPORT.md` 已建立，仍持续开发；不得声称六小时已过。
- 当前：同步报告/测试账本并复核服务入口边界。下一步：审计项目文件读取与参数持久化边界，保留租约/CAS和execution denied。

## 第三轮进展（02:48，继续开发）

- e8816ff：Artifact文件读取取消/切换/关闭/权限/revision/替换及时结束；同步订阅重入保留新草稿。旧实现6项超时，修复后通过。
- a073fa2：原生File字节严格UTF-8和实际大小检查；旧实现会接受损坏名称/props。正式页面桌面/移动拒绝损坏文件后正常安装，C仍unavailable。
- b7f47f4：请求体刚读完但响应已关闭时，禁止新生成调用；旧实现复现1次错误上游调用，新实现0次。44/44相关回归。
- 47c2fe5：源码模型seam序列化请求512KiB上限、调用前后取消检查；43/43。
- 0bb57e3：Mochi请求在状态发布前取得所有权，订阅取消/替换不再发出旧分析。28/28；正式Mochi桌面/移动通过。
- dca5903：CustomBlock生成器和Provider接收调用方signal，取消及时退休、迟到错误/响应体被消费，存储前取消零写入。进入store.put后返回真实存储结果；不宣称回滚。31/31。
- 最新核心回归core-caller-cancel：649/649；build-source-publication退出0。修复前失败、一次回归启动命令漏掉node导致127均保留；修正命令后通过。
- 上述代码已同步Draft #40；未合并、未部署、REAL_MODEL_CALLS=0。
- 当前：同步证据；下一任务：核心持久化/重装及模型适配层剩余盲区，继续安全独立工作。

## 第四轮进展（03:07，继续开发）

- 0fd3d19、5597ebf：可信交互access/budget异常统一为安全BUDGET_UNAVAILABLE，HTTP不泄露任意code/status；修复前失败保留，19/19。
- 9ebce4b：owned-family回归自动发现，首次716/716；新增组合测试后721/721。
- 1e7205a：同版本重装保留状态/布局、新版本仅重置选中状态、无效替换原子失败；26/26相关测试。
- 36025d2：危险源码语法准入保持惰性、未构建/不可执行；25/25边界回归。
- 6d70036：fixture HTTP envelope→存储→导出→正式安装UI控制器→选中源码模型seam→确认/CAS→B/C投影一致；按钮文字/蓝色仅在惰性源码和props中验证，不执行TSX。
- d3a9c2f：复现并修复共享目录配额竞态，独立handle/进程共用非等待目录租约；残留锁需人工检查，未知锁不删除。相关32/32，正在执行扩展核心回归。
- 当前：归档证据并同步Draft #40；下一任务：审计当前生成协议/源码编辑/Artifact的剩余安全独立盲区。
- 已修改文件按git diff --name-status和LOCAL-COMMITS.txt核对；未修改Agent B导出器、Docker、冻结视频或PR #36 Host测试。
- 阻塞仍为真实付费语义验收、正式Mochi修改服务、实测Viewer隔离后端和跨刷新存储设计；REAL_MODEL_CALLS=0。

## 第五轮进展（03:15，继续开发）

- 84a1255：存储readBounded读到EOF，短读/尾部隐藏复现旧实现2失败；修复及精确上限/stat后增长19/19。
- 2f6d630：源码模型completion最长45秒、忽略abort也退休；同步异常/信号清理、超时后新请求唯一确认50/50。
- 9c9bc81：AppSpec模型completion相同截止，保留同步调用时序；首次改成microtask导致旧取消测试超时，修正后相关73/73、同步异常16/16。
- 最新自动发现核心736/736，build-model-deadline退出0；Mochi模型计划集成页桌面/移动浏览器通过，baseline9c9bc81，非正式修改服务。
- 三项代码已同步Draft #40，远端8fb63c539b0b2ab08b695ebfb52479b60f1329d8，树一致；没有合并或部署。
- 当前：归档短读与deadline证据。下一任务：服务错误/请求资源释放及协议兼容剩余盲区；六小时窗口仍在进行。
- 已修改store、两个模型适配器及其测试；详细清单见LOCAL-COMMITS。REAL_MODEL_CALLS=0。

## 第六轮进展（03:29，继续开发）

- ba9fbd6、dac42d0：Mochi提前拒绝未完成上传后关闭连接；旧实现401连接滞留复现，相关32/32。超限chunked返回413，跨块emoji合法输入兼容，14/14。
- f56d2d4：上下文身份/历史先发布再通知及abort；避免订阅syncContext递归和旧项目切换覆盖新项目。发出前/接收后均绑定本次上下文，重入切换零旧请求发出；37/37。
- 66eddef：会话观察者异常不再阻断传输取消，38/38。正式/ai-create桌面与移动回归通过，无外部请求。
- c27a704：鉴权适配器及伪装CANCELLED的ledger异常转安全503，旧代码3失败，修复相关37/37。
- 11e952e：预算await之前捕获可信访问scope，复现共享access对象变更导致跨scope去重；修复相关30/30。
- Artifact观察者异常曾把已提交安装回执变为error；现隔离观察者异常，36/36。没有修改owner/CAS或确认租约。
- 当前：归档第六轮证据并同步Draft #40；下一任务：协议兼容、源版本/安装边界与参数持久化剩余盲区。
- 本轮较广回归746/746及build-context-atomic退出0，时间早于最后鉴权/访问scope/Artifact观察者修复，不能宣称覆盖后续HEAD。
- REAL_MODEL_CALLS=0；正式修改Provider和隔离Viewer仍受阻，持续安全独立开发。

## 第七轮进展（03:44，继续开发）

- d14d9cb：同步可信回调取消不再漏过listener注册；预算后gate取消零Provider发出；主动授权撤销后重授不能复活旧请求。旧实现3个复现失败，相关32/32。
- 9757f48：Host本身退休忽略AbortSignal的Provider等待，涵盖取消、选择、dispose、替换及同步取消后throw。旧实现4超时，修复相关79/79；新预览可确认、旧失败不覆盖lastApplied。首次补丁在发布前校验失败时产生未处理取消Promise，修正Promise创建位置后通过，日志保留。没有修改PR #36拥有的host.test.cjs。
- 06bcab0：关闭会话后跳过排队opt-in和延迟status；保留已排队显式opt-out。旧夹具悬挂已终止并留日志，修正夹具后旧代码复现失败，新代码相关37/37。
- 最新owned-family全量761/761及build-consent-lifecycle退出0，baseline06bcab0。正式Artifact页admission-artifact桌面/移动通过；Host正式只读建议页host-retirement桌面/移动通过。consent-lifecycle正式浏览器桌面/移动亦通过，代码06bcab0，0页面错误/0外部请求。
- 当前修改：service.mjs、mochi/host.ts、mochi-ai/client.mjs、三个新增测试及证据文档。代码d14d9cb/9757f48/06bcab0已发布；小范围Commit和远端映射见清单。
- REAL_MODEL_CALLS=0；没有部署、合并或执行生成TSX。下一安全任务：继续协议、权限和生命周期审计；准确记录生产模型摘要适配器缺口。

## 第八轮进展（04:00，继续开发）

- d82b341：最新status非法/空对象或适配器拒绝，关闭旧enabled/proactive并退休请求；禁止继承constructor等错误文案。旧3失败，相关34/34。
- 855bd80：迟到opt-in确认不能把disabled能力标记proactive；旧失败，相关35/35。
- 064dd38：主动关闭原子发布，旧订阅重入曾多发一次分析；修复相关36/36。
- 275c306：consentTail先取得队列位置再通知；重入重新开启按false→true发送，与最后用户意图一致；旧顺序true→false复现，相关37/37。
- f1df14f：metadata查询成功/失败通知观察者异常隔离，不再未处理拒绝或跳过健康观察者；旧2失败，相关42/42。
- f95d687：HTTP鉴权scope在异步读取body之前捕获，避免共享resolver对象变更导致跨session/project；旧409复现，修复相关33/33。
- 最新较广回归774/774、build-metadata-observer退出0，代码f1df14f；最后HTTP scope修改晚于该全量，单独33/33通过。status-consent及metadata-observer正式/ai-create桌面/移动均通过，0页面异常/0外部请求。
- 当前：归档第八轮证据并同步Draft #40。下一任务：元数据失败恢复与状态/上下文取消跨层审计，继续独立工作。六小时窗口尚未结束（约01:48开始）。
- 以上六项代码已发布，SHA/树见COMMIT-MAPPING；未修改其他Agent生产文件，REAL_MODEL_CALLS=0。

## 第九轮进展（04:20，继续开发）

- 2e40b76：固定PR35镜像文件清单Node链接检查与交接建议；原清单缺ai-abort.mjs失败，补单文件成功。不修改Docker/部署，不冒充容器验收。
- 2abfb7d：元数据查询失败后切换已准入精确v2引用恢复；相关43/43。原代码通过，只增加有效恢复覆盖。
- 383c64f：旧建议关闭/忽略通知重入门禁；旧3项失败，修复相关40/40。已同步Draft #40，远端cb16eef，树一致。
- 全量775/775、npm test192/192、隔离质量93/93均退出0，baseline2e40b76；之后改动单独验证，不混称最新全量。
- 当前：归档证据并继续服务资源/正式页面生命周期审计。下一任务：请求体、异常及建议操作跨层边界；正式修改服务、隔离Viewer、付费语义和持久化仍受阻。
- 修改文件：部署交接文档、runtime-inventory.mjs、context.test.mjs、client.mjs、suggestion-actions.test.mjs；其余详见提交清单。REAL_MODEL_CALLS=0。

## 第十轮进展（04:34，继续开发）

- aeb97c0：正式/ai-create实际HTTP取消/迟到结果，桌面1366/移动390各6次HTTP和注入上游；取消保留旧记录、替换后旧响应体释放、迟到失败不覆盖、新导航取消，0页面错误/外部请求/未处理拒绝。
- 7b3fd01：实际HTTP生成扩展移动视口，各7种AppSpec、13次HTTP；B Inspector新增字段、C数据编辑和B/C往返；5种服务失败保留旧记录、重试空项目替换。仅上游注入，无生产测试开关。
- bf11cb6及a3c2b0b：继续建议定位回调期间换项目/revision/取消/上下文往返不得发送旧建议；允许一次真实目标选择同步。旧实现分别3和2失败，修复相关47/47。
- 最新自动发现核心786/786、build-focus-epoch退出0，代码a3c2b0b；focus-epoch正式Mochi桌面/移动通过，0页面错误/外部请求，10次离线Provider及12次fixture预留。
- 当前修改：mochi-ai/client.mjs、suggestion-actions.test.mjs、generation/browser.cjs及新增cancellation.browser.cjs。下一任务：正式生成结果HTML/URL文字惰性显示验证，继续独立安全审计。REAL_MODEL_CALLS=0。

95d4156新增正式HTTP纯文字安全浏览器：桌面1366/移动390均验证AppSpec应用/积木名、字段、select选项及记录创建/编辑/B-C往返；HTML、URL、事件文字无探针DOM/执行标记/弹窗/外部请求，0页面错误。命令generation-text-safety退出0，baseline a3c2b0b+未提交测试，生产代码未变。没有执行生成TSX。

## 第十一轮补充证据（04:47，继续开发）

- 71d874d：忽略建议的通知期间cancel、项目A→B→A、选择A→空→A不得发送退休ignore；旧3失败，修复相关41/41。
- 91bbbb3及后续入站测试：真实socket未完成上传的415/403/413/405/404/503、超限chunked、断开释放、UTF-8跨块、408截止及429限流；相关47/47退出0。首次7失败为测试未解码HTTP chunk framing，修正测试后45/45，未修改生产服务以通过。
- 0845361：适配器throw null/undefined及constructor/toString错误码，旧9失败；修复相关37/37，不再跳过上下文退休或向界面发布函数文案，保留原始拒绝。
- 80c32a3：撤销主动授权或能力关闭立即清除已排队settle事件，之后重新授权不复活旧事件；旧2失败，修复相关31/31。真实正式/ai-create桌面1366/移动390验证旧事件零请求、新事件正常；consent-timer报告0页面错误/外部请求，10次离线Provider/12次Fixture预留。
- 最新较广核心808/808与build-consent-timer退出0，代码80c32a3；之后仅新增408/429测试，已单独47/47。adapter-errors正式页亦通过，浏览器没有注入非标准异常，异常专由单元测试验证。
- 四项生产/测试提交已推送Draft #40，本地80c32a3对应远端2f53dd9d4d382bc43323415f847b606490afdacb，树一致；最后408/429测试待下一次同步。未合并、部署或执行生成TSX，REAL_MODEL_CALLS=0。

## 第十二轮补充证据（04:51，继续开发）

- 最新自动发现核心回归810/810，退出0；额外重装/Artifact安装UI/Mochi源码和模型计划/v1-v2兼容聚焦集119/119，退出0；默认`npm test`192/192与`npm run build`均退出0。命令、HEAD、时间、日志及REAL_MODEL_CALLS字段已写入commands.jsonl。
- 状态审计再次核对`createProjectRevisionOwner`、`createProjectSession`、Generated Artifact installer：唯一快照/CAS、revision与授权身份、异步准备退休、确认租约、精确版本替换有测试覆盖；本轮未发现新的可复现生产缺陷。
- 文档提交`122eb1c`补充至本地提交映射，但尚未核验映射文件已同步远端；不要将其计为已发布。此前80c32a3及相关代码远端映射仍有效。
- 当前任务：补齐最近回归证据与Draft PR状态；继续v1/v2协议及Artifact/Runtime互操作审计。安全边界不变：REAL_MODEL_CALLS=0，不执行生成TSX，不合并、不部署。
