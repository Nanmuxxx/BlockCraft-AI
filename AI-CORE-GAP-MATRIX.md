# AI Core Gap Matrix

基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。状态描述当前代码，VERIFIED 必须有本轮命令与结果（详见 docs/agent-a-night/logs/commands.jsonl）；历史文档不充当本轮验证。REAL_MODEL_CALLS=0。

| 环节 | 状态 | 具体代码/函数 | 测试与缺口 |
| --- | --- | --- | --- |
| v1 自然语言生成 | VERIFIED | `AiCreate.tsx:submit` → `generateApp.ts:generateProject` → `server/index.mjs:createAppServer/generate` → `buildGenerationMessages` | `tests/generation/compatibility.test.mjs`、`server/server.test.mjs`；本轮服务 HTTP/浏览器通过（commands.jsonl）。非任意功能，只支持现有 primitive |
| 输出完整性 | VERIFIED | `assertAppSpec`、`checkGeneratedApplication` | `tests/generation/generation.test.mjs`；结构完整不等于自然语言需求满足 |
| v2 可信交互 | PARTIAL | `generateInteractiveProject`、`server/trusted-interactive.mjs:createInteractiveGate/assertInteractiveSpec` | `tests/trusted-interactive/*.test.*`；只允许单个 pomodoro，付费入口默认关闭 |
| 离线正式入口 | IMPLEMENTED | `trustedPomodoroFixture.ts`、`AiCreate.tsx` | `tests/trusted-pomodoro-ui/`；保留明确非 DeepSeek 说明 |
| 生成取消/项目替换 | VERIFIED | `AiCreate.tsx` active 身份与双重 `beforeContextChange`；`generateApp.ts` AbortController | 既有 UI 竞态测试；已补有界读取、忽略 abort 传输/响应体、迟到响应取消；56 项相关检查通过 |
| Artifact Installer | VERIFIED | `generated-artifact/install.ts:createGeneratedArtifactInstaller`、`ui.ts:createGeneratedArtifactUI` | `tests/generated-artifact/`、`tests/generated-artifact-ui/`；准确摘要、预览、确认、授权与 revision |
| CustomBlock 生成 | PARTIAL | `server/custom-block/generator.mjs:createGenerator`、`provider.mjs`、`store.mjs` | `tests/custom-block-generation/`；仅 pending-build，无自然语言到正式安装的 UI 通路 |
| CustomBlock B/C 映射 | IMPLEMENTED | `custom-block-bc/adapter.ts`、`CustomBlockInspector.tsx`、`CustomBlockViewer.tsx` | `tests/custom-block-bc/`；同一 owner/props/layout，运行仍需隔离准入 |
| Runtime owner/CAS | VERIFIED | `customProjectSession.ts:createProjectSession`、`owner.ts:createProjectRevisionOwner`、`appRuntime.ts` | `tests/custom-block-workshop/authorization.test.cjs`、`tests/custom-block-bc/authorization.test.cjs` |
| Mochi Host 修改 | PARTIAL | `mochi/host.ts:createMochiHost` → `appChangePlan.ts:createAppChangePlanner` | Host 可确认受控命令；正式 Workshop 使用 `unavailablePlanProvider`；不支持按钮颜色/文字命令 |
| Mochi Conversation | IMPLEMENTED | `mochi-ai/client.mjs:createMochiConversation`、`workshop.mjs`、`server/mochi-ai/service.mjs` | `tests/mochi-ai/`；只读建议、上下文绑定、历史/迟到门禁；修改明确禁用 |
| Mochi 源码修改 | PARTIAL | `mochi-source/planning.ts:createSourceEditPlanner/validateSourcePlan`、`providers.ts` | `tests/mochi-source/planning.test.cjs`；完整 TSX 候选版本、摘要与确认，未接正式 UI、不可运行 |
| 隔离执行 | BLOCKED | `custom-block-bc/viewer.ts:viewerState`、`CustomBlockViewer.tsx` | `tests/custom-block-sandbox/`、`tests/custom-block-compiler/`；缺少实测隔离 provider，禁止绕过 |
| B/C 状态一致性 | VERIFIED | `AppSpecWorkshop.tsx:MochiWorkshop`、`appRuntime.ts`、唯一 `customProject` | 相同 Runtime，模式切换不复制项目；本轮 service-runtime 及模型计划浏览器通过，字段编辑后 B/C 一致 |
| 参数保存/重新安装 | PARTIAL | `customProjectSession.ts:install`、`custom-block/project.ts` | 现有 session 内保存与替换边界；无跨刷新存储，不增加隐式 localStorage |
| React ZIP | PARTIAL | 现有 `integrations/project-export` 与 `tools/project-zip-export` | Agent B 所有；本分支只提出接口契约，不编辑 |
| 任意自然语言 → TSX → Mochi → C → ZIP | BLOCKED | 上述环节尚未构成完整生产闭环 | 无真实模型调用与隔离运行证据，不给主观完成百分比 |

## 本轮新增证据与边界

- `generateApp.ts:requestGeneration/readGenerationResponse`、`server/index.mjs:generate/readUpstream`、`server/ai-abort.mjs:abortable`：字节/UTF-8/取消/超时/严格包络与未用响应体释放。`response-cleanup` 56/56。
- `mochi/modelPlanProvider.ts:createModelPlanProvider`：只输出选中块元数据、无 records/authorization，64 KiB 入站/出站 JSON；保留原 Host→Planner→确认→CAS。`model-plan-cancellation-fixed` 13/13（含本地 HTTP 垂直案例）。正式生产 Provider 尚未接通，状态 PARTIAL。
- `mochi-source/planning.ts:createSourceEditPlanner`：取消立即退休、先 detach 再 abort；同步重入 epoch 复现先失败再修复。`source-reentrant-fixed` 37/37。仅惰性源码版本与历史，不表示可执行 TSX。
- `server/custom-block/provider.mjs`：限时读、迟到/提前拒绝响应体回收、混合工具/error 包络拒绝。`custom-provider-cleanup` 26/26。
- `tests/ai-quality/evaluate.cjs:assertQualitySpec`：质量评估显式 v1；共享 schema 合法 v2 仍需单独质量契约。`quality-v1` 61/61。
- `security-prerequisites-fixed` 187/187：可信编译器先经 `npm ci --ignore-scripts` 及固定包 SRI/字节比对，再编译两个审核样本；未知源码与 Viewer 仍拒绝运行。
- 浏览器 JSON 报告在 `docs/agent-a-night/browser/`；artifact-races 旧脚本内 baseline 是历史常量，实际本轮源码/命令以 Git 提交与日志为准，不把历史常量冒充当前 SHA。
- MISSING：正式自然语言修改计划 HTTP 路由与授权/费用闭环；跨刷新项目存储；经过真实隔离验收的 Viewer。
- BLOCKED：真实模型验收（本任务无付费许可）；任意 TSX 安全运行；跨 Agent 的 ZIP/部署集成。

- `core-complete` 568/568；`custom-workshop-browser` 桌面1366/手机390通过，含参数/重新安装/B-C/不可执行 Viewer。`model-request-bound-fixed` 14/14。未来生产接入见 `docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md`。

## 第二轮证据（02:32）

- 源码请求所有可撤销await均可取消；`source-registry-after`39/39；注册表迟到拒绝不能覆盖新预览/历史。
- Artifact `prepare` 增加内部取消代际，`installer-cancel-final`63/63（含源码）；确认安装租约不提前解除。
- Mochi建议客户端：忽略abort的fetch/流、迟到body、永不完成cleanup、非法UTF-8、原型链错误码均有回归；会话取消及时结束，先detach再abort保留新请求所有权。`conversation-cancel-after`25/25。
- `server/mochi-ai/http.mjs:createMochiHandler/read`：严格UTF-8、access默认五秒上限、请求/连接中止信号传给可信适配器；`advice-http-disconnect`23/23。
- 最新较广核心回归`core-checkpoint`622/622，时间早于HTTP入口最后三项新增测试；不得把这些结果混为一次625项运行。
- 正式Artifact桌面/移动通过；Mochi正式页面串行重跑通过，0外部请求/0真实模型调用。最新变更继续遵循PARTIAL/BLOCKED，未启用生产修改/Viewer。

## 第三轮边界证据（02:48）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 文件取消及重入 | VERIFIED | generated-artifact/ui.ts:readFile/invalidate | ui.test.cjs：cancel/replace/dispose/revision/permission/supersede、订阅重入；旧实现6项超时 |
| 原生文件UTF-8与大小 | VERIFIED | ui.ts:readFile的arrayBuffer/fatal解码 | artifact-byte-final35/35；正式production-browser.cjs桌面1366/移动390拒绝损坏文件后正常预览安装 |
| 生成发出前断连 | VERIFIED | server/index.mjs:createAppServer/generate | generation-predispatch-before复现错误调用；after44/44，断连零调用且释放并发 |
| 源码模型出站边界 | VERIFIED | mochi-source/providers.ts:createModelSourcePlanProvider | provider.test.cjs：实际UTF-8/转义512KiB、调用前后取消、超大响应；源码43/43 |
| 会话状态发布取消 | VERIFIED | mochi-ai/client.mjs:createMochiConversation/run | client.test.mjs：message/busy同步取消与替换，旧分析零发出；相关28/28；正式浏览器通过 |
| CustomBlock调用方取消 | VERIFIED | server/custom-block/generator.mjs:createGenerator；provider.mjs:createDeepSeekProvider | pipeline/provider31/31：预取消零调用、忽略abort及时退休、迟到拒绝/响应体清理、存储前零写入 |
| 存储开始后取消 | IMPLEMENTED | generator.mjs:store.put边界 | 已进入不可逆存储则等待实际结果；不虚构回滚，无新增执行权限 |

core-caller-cancel最新649/649；REAL_MODEL_CALLS=0。上述VERIFIED仅指Fixture协议/取消行为，不是实际模型语义或任意TSX运行验收。

## 第四轮边界证据（03:07，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 鉴权/预算异常净化 | VERIFIED | server/trusted-interactive.mjs:createInteractiveGate/AdmissionError | gate/server回归19/19：任意code/status/null异常不能泄露或变成非法HTTP状态；零模型调用 |
| 会话重装与状态 | VERIFIED | customProjectSession.ts:install | reinstall.test.cjs：同版本保留状态/布局，新版本仅清除选中状态，非法替换原子失败；无跨刷新承诺 |
| 组合安装/源码修改 | VERIFIED | createGenerator→exportPendingInstall→createGeneratedArtifactUI→createSourceEditPlanner | installation.test.cjs：受控按钮文字props/颜色源码版本替换、预览零写入、确认一次CAS、旧制品/历史保留；fixture HTTP/模型seam各1次 |
| 源码执行边界 | VERIFIED | contract.mjs:admitOutput；viewer.ts:viewerState | 危险源码仅以数据存储，execution denied；伪造runnable/旧版本观察值均不执行；不是安全沙箱认证 |
| 跨writer存储配额 | VERIFIED | store.mjs:createPendingStore/put | pipeline.test.mjs：旧代码maxArtifacts=1并发落盘2份；新目录租约覆盖独立handle和独立进程；未知/残留/符号链接锁不删除、不跟随 |
| 独立测试发现 | IMPLEMENTED | tests/ai-core-night/regression.mjs | 自动发现Agent A测试族；构建可信协议而不构建生成源码。ZIP兼容测试需预备可信依赖，由Agent B负责准备 |

组合案例只证明源码/props修改和共同项目元数据；C模式仍pending-build或unavailable，不声称按钮已运行。存储若崩溃留下.write-lock，需可信宿主人工检查恢复；没有隐式清锁逻辑。

## 第五轮边界证据（03:15，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 存储完整有界读取 | VERIFIED | server/custom-block/store.mjs:readBounded | pipeline.test.mjs：31字节短读、合法JSON前缀后隐藏内容、精确512KiB及stat后增长；修复前2失败，修复后19/19 |
| 源码模型completion截止 | VERIFIED | mochi-source/providers.ts:createModelSourcePlanProvider | provider/planning/installation50/50：忽略abort、迟到拒绝、同步abort+throw、超时零写入和新请求唯一CAS；最长45秒 |
| AppSpec模型completion截止 | VERIFIED | mochi/modelPlanProvider.ts:createModelPlanProvider | model-plan/generation/planning73/73；同步异常16/16；恢复原有同步调用时序，未改Host协议或正式Provider配置 |
| 当前构建与回归 | VERIFIED | tests/ai-core-night/regression.mjs；npm run build | 736/736退出0；build-model-deadline退出0；模型计划集成浏览器桌面/移动通过，baseline9c9bc81 |

所有completion均为fixture注入；不授予付费调用、修改或TSX运行权限。正式页面修改服务仍MISSING，源码隔离执行仍BLOCKED。

## 第六轮边界证据（03:29，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 未完成HTTP上传退休 | VERIFIED | server/mochi-ai/http.mjs:send | http.test.mjs：401/403/415未完成上传及时close；超限chunked结构化413；emoji跨块兼容；相关32/32及14/14 |
| 项目切换同步重入 | VERIFIED | mochi-ai/client.mjs:syncContext/retire/run | client.test.mjs：递归同步、通知期间第三项目、abort重入、出站前项目替换；旧实现4失败，修复37/37 |
| 观察者与取消/回执 | VERIFIED | client.mjs:emit；generated-artifact/ui.ts:publish | 观察者失败不阻断取消或把实际成功安装显示为失败；建议38/38，Artifact36/36 |
| Mochi适配器异常净化 | VERIFIED | http.mjs:resolveAccess catch；service.mjs:budget catch | MochiError私有code/message/status和伪造CANCELLED均为安全503；HTTP3项旧失败，修复37/37 |
| 可信访问scope快照 | VERIFIED | service.mjs:analyze | service.test.mjs：预算await期间复用access对象变更不污染跨项目去重；旧实现失败，相关30/30 |

较广核心746/746与build-context-atomic退出0；正式/ai-create桌面/移动context-atomic浏览器通过。该全量/浏览器早于本轮最后几项服务及Artifact修改，准确覆盖以命令时间和代码提交为准。REAL_MODEL_CALLS=0。

## 第七轮边界证据（03:44，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 同步准入取消/撤销 | VERIFIED | mochi-ai/service.mjs:analyze | admission-cancellation.test.mjs：missed abort、预算后gate、主动授权ABA；旧3失败，修复相关32/32 |
| Host等待退休 | VERIFIED | mochi/host.ts:onRequestPlan | host-cancellation.test.cjs：忽略abort的Provider四种退休、迟到拒绝、新请求唯一确认、同步abort+throw；相关79/79 |
| 已关闭consent队列 | VERIFIED | mochi-ai/client.mjs:setProactive/refreshStatus | consent-lifecycle.test.mjs：排队opt-in及status零发出，显式opt-out继续完成；相关37/37 |
| 当前完整验证 | VERIFIED | regression.mjs；npm run build | 761/761退出0、build-consent-lifecycle退出0，baseline06bcab0；正式Artifact页与只读建议页桌面/移动分别通过 |

生产源码模型计算密码学摘要的语义可靠性仍未验证；现有seam只完成fixture。建议未来可信适配器复用computeVersionDigest，然后仍经resolveArtifact/validateSourcePlan，不绕过校验。该生产适配器MISSING；REAL_MODEL_CALLS=0。

## 第八轮边界证据（04:00，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| status失败关闭能力 | VERIFIED | mochi-ai/client.mjs:refreshStatus | status-validation.test.mjs：非法/null、当前请求退休、原型链reason、null拒绝；相关34/34 |
| consent顺序与撤销 | VERIFIED | client.mjs:setProactive | consent-lifecycle.test.mjs：迟到确认、撤销通知零额外调用、同步重入false→true顺序；相关37/37 |
| 元数据通知隔离 | VERIFIED | context.mjs:notify | context.test.mjs：查询成功/失败时观察者抛错均不跳过后续观察者，无未处理拒绝；相关42/42 |
| HTTP scope快照 | VERIFIED | server/mochi-ai/http.mjs:createMochiHandler | http.test.mjs：body end回调修改resolver对象仍绑定原session/app；旧409，修复相关33/33 |

全量774/774、构建0及metadata-observer正式页桌面/移动通过，baseline f1df14f；之后的HTTP scope修复有独立33/33，未混称已被774项覆盖。所有调用均Fixture；REAL_MODEL_CALLS=0。

## 第九轮边界证据（04:20，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 元数据失败后版本恢复 | VERIFIED | context.mjs:update/read | context.test.mjs：失败v1→精确已准入v2 pending→新字段，相关43/43；不做失败引用轮询 |
| 旧建议动作退休 | VERIFIED | client.mjs:suggestion/ignore | suggestion-actions.test.mjs：dispose零定位/请求、忽略通知换项目/关闭零发送；旧3失败，修复40/40 |
| 镜像运行依赖集成 | BLOCKED | server/ai-abort.mjs；DEPLOYMENT-INTERFACE-NOTE.md | 固定PR35 inventory缺文件时Node链接失败，补单文件成功；部署负责人需真实组合镜像验收 |

全量775/775、默认192/192和隔离质量93/93退出0，baseline2e40b76；晚于此基线的测试/建议动作改动分别独立验证。未执行TSX，REAL_MODEL_CALLS=0。

## 第十轮边界证据（04:34，持续开发）

| 项目 | 状态 | 函数/文件 | 验证 |
|---|---|---|---|
| 正式生成HTTP桌面/移动 | VERIFIED | tests/generation/browser.cjs；server/index.mjs既有路由 | generation-http-mobile：各7应用/13HTTP，B新增字段和C记录一致，5失败保留数据，重试替换成功 |
| 正式生成取消/迟到/导航 | VERIFIED | tests/generation/cancellation.browser.cjs | 各6HTTP；迟到body释放/拒绝消费、旧结果不覆盖、导航取消，0页面异常/外部请求/Node未处理拒绝 |
| 建议定位回调所有权 | VERIFIED | mochi-ai/client.mjs:continueSuggestion/syncContext/retire | suggestion-actions.test.mjs：项目、revision、取消、上下文往返拒绝；单次目标选中允许；相关47/47 |
| 最新核心与正式建议页 | VERIFIED | regression.mjs；focus-epoch/report.json | a3c2b0b核心786/786、构建0、正式桌面/移动0异常/外部请求 |

上述HTTP上游均固定离线completion，未声称真实模型语义生成。正式修改Provider仍MISSING，Viewer隔离执行仍BLOCKED，REAL_MODEL_CALLS=0。

95d4156新增正式HTTP纯文字安全浏览器：桌面1366/移动390均验证AppSpec应用/积木名、字段、select选项及记录创建/编辑/B-C往返；HTML、URL、事件文字无探针DOM/执行标记/弹窗/外部请求，0页面错误。命令generation-text-safety退出0，baseline a3c2b0b+未提交测试，生产代码未变。没有执行生成TSX。

VERIFIED（04:47）：generation/ingress.test.mjs实socket上传拒绝/408/429和释放47/47；adapter-errors.test.mjs非标准异常安全清理；workshop.mjs撤销授权清除计时器，workshop.test.mjs旧2失败、修复31/31，正式桌面/移动consent-timer验证。最新核心808/808、构建退出0（80c32a3）。真实模型0；正式修改Provider与隔离Viewer状态仍MISSING/BLOCKED。
