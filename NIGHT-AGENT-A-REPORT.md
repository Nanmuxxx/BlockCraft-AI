# NIGHT AGENT A — AI 核心阶段报告

阶段检查点：2026-10-19 03:29（Asia/Shanghai），约01:48开始，持续开发中。六小时窗口尚未结束，本报告不是六小时完成声明。

## 1. 实际完成的功能

- 恢复v1 AppSpec、trusted-interactive v2、Artifact Installer、CustomBlock、Mochi、owner/CAS状态，具体文件/函数/证据见[差距矩阵](AI-CORE-GAP-MATRIX.md)。
- 生成客户端与服务端限制字节、严格UTF-8、completion包络、截止时间和主动取消；不服从AbortSignal的传输/响应体也可退休，迟到响应体被释放。保留#39离线可信来源说明。
- 实际本机HTTP Fixture→客户端验证→原有Runtime→Mochi预览/确认/CAS→B/C共同项目，受控表单增加可选备注字段；没有另建Runtime或生成协议。
- 既有Mochi模型计划/源码模型seam增加最小上下文与出站边界，修复provider/注册表/全项目校验取消和同步abort重入。正式Workshop修改入口仍未启用。
- Artifact原生File使用字节/fatal解码；读取/prepare取消、项目切换、权限与revision变更不会复活旧草稿；确认租约保留。
- Mochi会话发布user/busy之前取得请求所有权，订阅取消/替换不再发出旧分析；只读建议服务、可信鉴权/费用准入有截止时间及断连处理。外部适配器任意code/status异常不能泄露到HTTP。
- CustomBlock调用方取消在不可逆store.put之前阻止写入；进入存储后报告实际结果。存储配额新增跨handle/进程目录租约，避免maxArtifacts=1并发保存两份。
- 组合Fixture案例：DeepSeek HTTP envelope→pending store→exportPendingInstall→正式UI控制器→选中源码模型seam→确认CAS。按钮文字props与蓝色源码版本被验证、旧Artifact/历史保留，C只显示pending-build/unavailable，未运行生成按钮。
- 同版本重装保留状态/布局，新版本仅重置选中状态，无效替换原子失败；危险源码Fixture始终惰性且execution denied。
- 私有存储读到EOF后再校验，修复短读接受合法JSON前缀、遗漏尾部内容；精确字节上限和stat后增长均有回归。
- 两个Mochi模型修改适配器均有最长45秒截止时间；取消/超时退休忽略abort的completion，消费迟到拒绝，清理信号。保留AppSpec适配器原有同步调用时序；超时后零写入，新请求可确认且旧结果不能覆盖。

- 第六轮：Mochi未完成上传提前拒绝后关闭连接；上下文身份/历史原子发布防同步重入，出站前绑定本次项目；观察者异常不能阻断取消。鉴权/ledger异常净化、可信访问scope快照；Artifact观察者异常不能把已成功安装回执改为失败。修复前失败均有保存。

## 2. Diff 与 Commit

- 基线main：`4044fb185a2720eead0dc6710b0d38a215439b98`。HTTPS fetch凭据不可用；通过连接的GitHub工具核对main SHA，未声称fetch成功。
- 分支`agent-a/ai-core-night-20261019`；worktree `/Users/nanmuxun/BlockAI/BlockCraft-AI-agent-a`。
- 精确提交：[LOCAL-COMMITS.txt](docs/agent-a-night/LOCAL-COMMITS.txt)；本地/远端SHA及逐一校验的同一文件树：[COMMIT-MAPPING.json](docs/agent-a-night/COMMIT-MAPPING.json)。Git-data API提交时间不同，不能将本地SHA当作远端SHA。
- 审查命令：`git diff --stat 4044fb1...HEAD`和`git diff 4044fb1...HEAD`。
- 最近代码提交：`d3a9c2f`跨writer配额、`84a1255`完整有界文件读取、`2f6d630`源码模型截止、`9c9bc81`AppSpec模型截止；均已同步Draft PR，树摘要逐一验证。

## 3. Draft PR

[PR #40](https://github.com/Nanmuxxx/BlockCraft-AI/pull/40)，保持Draft、未合并、未部署。当前已发布代码至本地`9c9bc818e770f2e3befda2dd862e9adc59e72d4b`对应远端`8fb63c539b0b2ab08b695ebfb52479b60f1329d8`，树一致；后续文档同步见映射。

## 4. 测试命令及退出码

每条命令、cwd、时间、退出码和原始日志见[TEST-COMMANDS.md](docs/agent-a-night/TEST-COMMANDS.md)与[commands.jsonl](docs/agent-a-night/logs/commands.jsonl)。修复前失败、前置产物缺失、一次启动参数错误和修正后重跑均保留。

- 最新`node tests/ai-core-night/regression.mjs`：**746/746，退出码0**（运行早于第六轮最后几项服务/Artifact修改），自动发现Agent A测试族并构建可信服务/CustomBlock协议；没有编译或执行生成源码。ZIP兼容测试依赖已准备的可信资源，准备责任在Agent B。
- 组合安装/编辑1/1，重装相关26/26，惰性源码/Viewer25/25，鉴权异常HTTP19/19，跨进程存储/安装32/32，退出码均0；这些属于各次运行，不能相加成另一项全量结果。
- 最近生产构建`build-model-deadline`退出0，对应代码HEAD `9c9bc81`；此前`build-source-deadline`亦退出0。
- 存储短读修复前2项失败，修复后相关37/37、精确上限19/19；源码截止首次3项失败，修复后含owner组合50/50；AppSpec截止首次2项失败，第一次修复改变调用时序导致旧取消测试超时，恢复时序后相关73/73及同步异常16/16，全部保留日志。
- 历史较广核心649/649、622/622、568/568，安全/编译/质量187/187、默认npm test192/192；准确范围及当时提交以日志为准。

- 第六轮：未完成上传32/32，chunked兼容14/14，上下文重入37/37，观察者取消38/38，适配器异常37/37，访问scope30/30，Artifact回执36/36；均退出0。build-context-atomic退出0，早于最后服务/Artifact修改。

## 5. 真实模型调用

**REAL_MODEL_CALLS=0**。本轮HTTP传输和源码completion均为显式注入的离线Fixture；测试里的allowPaid配置只作用于注入的假transport，不发网络。归档Artifact的历史deepseek来源不是本次调用。未读取生产密钥或私人数据。

## 6. 浏览器证据

[浏览器报告](docs/agent-a-night/browser)与[文件大小/SHA-256清单](docs/agent-a-night/browser-inventory.json)保留正式`/ai-create`、可信离线入口、生成Fixture、安装/替换竞态、CustomBlock参数/重装、Mochi计划/只读建议。桌面1366与移动390；移动为Chromium视口/触摸模拟，不冒充真机。

正式页面`artifact-utf8`和`advice-publication`桌面/移动均通过，0外部请求、0真实模型调用。前者包含原生File损坏UTF-8拒绝后正常预览/安装，后者覆盖正式只读Mochi。最新`model-deadline`桌面/移动模型计划fixture浏览器通过，baseline为`9c9bc81`；它是Mochi集成测试页，不冒充正式修改服务。一次并发运行初始输入框超时，串行重跑通过；缓存竞争尚非已确认根因。旧脚本报告中的固定baseline不能证明最新HEAD。新增组合源码案例为Node协议回归，未声称浏览器执行了生成TSX。

第六轮正式页面`context-atomic`桌面/移动通过，0外部请求、0页面异常；证据对应当时客户端代码66eddef，后续服务和Artifact修改需另行验证。

## 7. 新发现的问题

- AbortSignal不保证外部操作完成；所有可撤销等待需主动退休、消费迟到拒绝，确认租约/CAS不可提前解锁。
- 同步abort/状态订阅重入可破坏请求所有权，已保留复现并修复。
- UTF-8替换解码会静默改变JSON字符串；字节入口已严格解码。
- 共享v1/v2 schema曾令v1质量评估误收v2，现明确分离。
- 私有store的先读目录后写入配额有并发竞态，已用跨进程非等待目录租约修复。崩溃残留`.write-lock`需可信宿主检查后恢复；不自动删除未知锁。
- 单次文件read不保证读完，旧实现可漏检尾部；现读到EOF且限制实际累计字节。两个可注入模型completion原先没有独立截止时间，现最长45秒并保留取消/迟到结果门禁。
- 源码语法准入不是沙箱认证：危险DOM/网络/无限循环源码可作为数据保存，但不得执行；Viewer仍拒绝。
- 会话历史长期保留可能增长，需持久化/保留策略，不随意删除回滚证据。

## 8. 下一阶段最有价值的工作

继续独立边界审计、协议兼容/取消/持久化回归。生产接入需遵循[接口契约](docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md)：可信鉴权、持久预算、明确确认、revision/owner/CAS；真实模型语义验收需另获付费授权。隔离Viewer和跨刷新项目持久化需独立设计验收。

## 9. 其他 Agent 配合

Agent B负责React ZIP模板/导出器，本分支不修改其文件；需共同验收精确版本/props/state导出。Viewer隔离后端需独立安全验收。避开PR #35 Docker、#36 Mochi Host测试文件，未修改部署、冻结视频和商业材料。

## 10. 产品真实 AI 闭环判断

受控AppSpec服务协议、验证、项目创建、B模式编辑和确认修改有离线端到端证据。CustomBlock源码/props版本修改已在同一owner/CAS完成，但只到受验证pending-build。生产DeepSeek语义生成未在本次验证；正式Mochi修改接口未启用；任意TSX安全运行和独立ZIP全链路尚未完成。按可观察行为判断，不给主观完成百分比。
