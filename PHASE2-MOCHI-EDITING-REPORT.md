# Phase 2 Mochi Editing Engine — 2026-10-19

## 最新 main 集成候选（2026-10-19，本节覆盖下文历史阻塞状态）

**main 基线迁移已实际完成；本地可供审查，PUBLISH BLOCKED，构建/产品 QA BLOCKED，MERGE BLOCKED。** 不再以 #42 为 PR base；#42/#40 Bundle 只可能用于历史恢复，本轮没有依赖 Bundle。本报告完整保留原工作树中的全部未提交历史记录，下文各轮“未创建候选”等描述是当时事实，不是当前状态。

### 基线来源与隔离

- 经用户指定的新 main：`d644835bc915528fddc873e2687c84471f22ec52`；本地 origin/main 和提交对象已存在。
- `git show -s`：该提交为 Merge pull request #45，父提交 `b56a26a9803718d806bac3ddbd7fbe19e0c495c6`、`d6dd7fe3ff25e8c8f1141b136704cfbaf67d1b97`。
- `git cat-file -t <SHA>` = commit；`git cat-file -t '<SHA>^{tree}'` = tree。
- `git fsck --full --no-reflogs d644835bc915528fddc873e2687c84471f22ec52`：exit 0，仅有 dangling 提示，无 missing/corrupt 对象；未删除或清理这些对象。
- 新 worktree：`C:\Users\干陆烃芸\Desktop\HKS\BlockCraft-AI-mochi-main-candidate`；新分支 `phase2/mochi-editing-main-candidate`，直接从上述 main 创建。
- 原 worktree/分支保持 `phase2/mochi-editing-engine` / `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`；原安全测试和未提交报告保留，未 reset/rebase/stash/clean/覆盖。
- 远程 `git ls-remote origin refs/heads/main` 仍失败于 `Could not resolve host: github.com`，因此这证明迁移到已验证的指定本地 main 对象，**不证明服务器当前 main 未前进**。发布前必须重新核对。

### 共享接口兼容矩阵

使用 `git diff 692b7f56e1df094f4db95e35cc3be1fc72cc3dfc d644835bc915528fddc873e2687c84471f22ec52 -- <以下生产文件>` 检查无输出，说明本次需要的 main 生产接口与原 #40 源基线逐文件内容相同。不是把 #40 文件复制到 main。

| 接口 | main 中已验证文件/函数 | 结果 |
| --- | --- | --- |
| Runtime | `src/model/appRuntime.ts` AppRuntime/executeCommand(request,authorization)、getSnapshot/subscribe/customProject | 兼容；未迁移或改动 Runtime。 |
| CAS/revision/授权 | `src/model/customProjectSession.ts` commitBuiltin；`src/integrations/custom-block-bc/owner.ts` compareAndSwap、getAuthorization | 兼容；保留 expected snapshot、captured authorization、revision +1 检查。 |
| Mochi Host | `src/integrations/mochi/host.ts` createMochiHost、PlanRequest、selection/epoch/取消生命周期 | 兼容；仅增加 presentation diff 投影。 |
| Preview/Confirm/Planner | `src/model/appChangePlan.ts` createAppChangePlanner.preview/confirm/cancel、trusted scope、原计划句柄 | 兼容；增加受控命令白名单及 presentationChanges，不改变确认授权链路。 |
| AppSpec/命令 | `appSpec.ts` BlockSpec/AppCommand，`appSpecValidation.ts` assertCommandRequest，`appCommands.ts` processCommand | 兼容；只增加展示属性类型、校验和事务 merge case。 |
| Provider | `modelPlanProvider.ts` createModelPlanProvider；`planning.ts` toMinimalPlanInput/禁用正式 Provider | 兼容；只更新 instruction。正式 AI 入口仍禁用，零模型调用。 |
| C 渲染 | `AppRenderer.tsx` BuiltinBlockRenderer/RecordEditor | 兼容；只消费新增文字和容器样式。 |

main 相对 #40 另有 `host.test.cjs` 的授权参数转发修复与 CAS 回归，本候选完整保留它，不用旧测试覆盖。`git diff <main SHA> -- appRuntime.ts customProjectSession.ts owner.ts host.test.cjs server/index.mjs WorkshopMochi.tsx CustomBlockCanvas.tsx` 无输出。没有发现需要 Agent A 补写的共享接口，本轮没有修改共享服务或 Workshop 文件。

### 专属迁移范围：11 文件

先从原始 Commit 相对其 #40 父提交导出仅 9 个专属源码/测试文件的补丁；在 main 新工作树执行 `git apply --check` exit 0 后才应用。main 中对应源文件内容相同，无文本或语义冲突。再逐字节复制现有安全测试与完整报告，共 **7 个生产文件、3 个测试文件、1 个报告**。没有复制 #40/#42/#45 历史、提交 Core 基线代码或沿用旧 PR base。

| 文件 | 生产 Hunk 数（`--unified=0`）/目的 |
| --- | --- |
| `src/model/appSpec.ts` | 2：BlockPresentation、命令 union |
| `src/model/appSpecValidation.ts` | 5：严格 patch 校验、允许的 block 字段、命令校验 |
| `src/model/appCommands.ts` | 1：克隆事务内 merge case |
| `src/model/appChangePlan.ts` | 3：白名单、diff 类型、before/after 计算 |
| `src/integrations/mochi/host.ts` | 1：Preview 展示 |
| `src/integrations/mochi/modelPlanProvider.ts` | 1：受控模型指令说明 |
| `src/components/app-renderer/AppRenderer.tsx` | 4：参数类型/按钮文字/容器样式读取 |
| `tests/mochi/presentation-native.test.mjs` | 原有 19 项 |
| `tests/mochi/editing-safety-native.test.mjs` | 原有新增 46 项，SHA256 `3206B05193E1C027A58036AE36111EAA30BF1AC1AA20F885BD2E7799F8A64389` |
| `tests/mochi/presentation.test.cjs` | SSR 检查，当前仍缺依赖 |
| `PHASE2-MOCHI-EDITING-REPORT.md` | 全部历史与本轮 main 证据 |

生产差异共 17 个零上下文 Hunk，新增完整文件另计。最终 Commit SHA 由提交后的 `git rev-parse HEAD` 及最终回复提供，避免报告自引用其自身 SHA。

### 新 main 候选的实测结果

```text
node --experimental-transform-types --test --test-reporter=tap --test-reporter-destination=.cache/mochi-main-acceptance/native.tap tests/mochi/presentation-native.test.mjs tests/mochi/editing-safety-native.test.mjs
→ 65 tests / 65 pass / 0 fail / 0 skipped / 0 cancelled
```

这是**在新 main 候选工作树**运行的组合回归，区别于前文仅原基线测试结果。没有增加测试数量。测试证明连续更新 0→1→2、真实 owner CAS 两种先后顺序、旧计划/授权拒绝、Provider 迟到/超时/畸形响应以及失败原子性。它仍不代表 UI 和生产构建验收。

| 实际检查 | 结果 |
| --- | --- |
| `node --check tests/mochi/editing-safety-native.test.mjs`、`node --check tests/mochi/presentation.test.cjs` | exit 0 |
| `git diff --check` | exit 0 |
| `npm test` | exit 1，9 个文件启动失败，`Cannot find module 'typescript'`，0 pass / 9 fail（依赖加载阶段）。 |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 1，TypeScript MODULE_NOT_FOUND，未完成类型检查。 |
| `npm run build` | exit 1，`tsc` 不可用；Vite build 未执行。 |
| `node tests/mochi/browser.cjs` | exit 1，Playwright MODULE_NOT_FOUND，浏览器未启动。 |

完整日志位于候选自身 `.cache/mochi-main-acceptance/` 的 native.tap、npm-test.log、typecheck.log、build.log、browser.log。候选 node_modules 不存在，npm registry 仍为 `https://registry.npmjs.org/`；未连接原项目依赖，未改全局配置或扩大权限。main 新增的 Host CAS CJS 测试保留，但受缺 TypeScript 阻塞未运行，不计为通过。

### Workshop 联调交接：契约保持不变

权威值为 `runtime.getSnapshot().spec.blocks[稳定ID].presentation`；B 从共享 adapter builtin `item.block.presentation` 读取，不另建状态。字段：buttonText?:string（form-only，非空≤120；默认“提交”），backgroundColor/textColor?:string（仅 #RRGGBB，未设置沿用 CSS），borderRadius?:integer（0–32 px；undefined 沿用 CSS，0 有效）。部分更新保留未提及字段，null/删除/恢复默认尚不支持。

C 在 `AppRenderer.tsx:89` 读取容器颜色/圆角，`:93` 传按钮文字，`:44` 渲染新记录提交按钮。B 的 CustomBlockCanvas 已订阅共享 snapshot，但未映射 presentation；请 Workshop 负责人确认并实施卡片样式及普通文字示意，不在卡片 button 内嵌套 button。颜色/圆角语义是积木容器，不承诺子元素或按钮颜色。完整契约和真实 B→Preview→Confirm→C 浏览器测试要求见后文，继续有效。

本轮仅形成可交接结果，工具无法向其他 chat 直接发送消息，未声称已与 Workshop 完成联调，也未修改其文件。B/C 视觉一致性仍待 UI 接入与正式浏览器验收。

### Draft PR 准备与剩余阻塞

Draft 目标 base 已改为 **main**，不再 Depends on #42 源分支；说明应记录它已经由主线吸收，列出原始 Commit 和本候选精确增量。Draft 说明准备于 `.cache/mochi-main-acceptance/draft-pr-body.md`。

允许本地独立候选提交，不表示构建或 UI 已通过。远程 main 当前值无法重新查询，不能安全 Push 后宣称 Draft PR base 已核验。本轮保留本地候选，**PUBLISH BLOCKED：GitHub DNS**；Draft PR URL 无。原生 65/65 是可审查的真实证据，完整类型检查/生产构建/浏览器及 B 展示缺口明确未验收。MERGE、部署、Force Push、付费调用仍禁止。

## 离线 Bundle 可访问性检查：文件不可见（2026-10-19，本轮最新）

**在第一阶段停止，未导入。** 当前环境为 `Microsoft Windows 10.0.26200`，IsOSPlatform(Windows)=True；cwd 为 `C:\Users\干陆烃芸\Desktop\HKS\BlockCraft-AI-mochi-editing-engine`。Tech Lead 提供的是 macOS 路径，当前执行环境未能访问该位置。没有搜索、遍历或尝试其他用户目录，没有扩大权限。

实际只读检查：

```powershell
[System.Runtime.InteropServices.RuntimeInformation]::OSDescription
[System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
Get-Location
Test-Path -LiteralPath '/Users/nanmuxun/BlockAI/reports/offline-pr42-20261019-112043/' -PathType Container
Test-Path -LiteralPath '/Users/nanmuxun/BlockAI/reports/offline-pr42-20261019-112043/phase2-core-42.bundle' -PathType Leaf
```

目录和文件的 Test-Path 均为 **False**。这证明当前路径不可见，不代表远端文件不存在或 Bundle 内容无效。

| 交付项 | 本轮结果 |
| --- | --- |
| A. 可访问性与实际路径 | 提供的 macOS 目录/文件不可见；尚无当前 Windows 环境可读取的 Bundle 实际路径。 |
| B. SHA256 / bundle verify / list-heads | 未执行：文件不可读，不能计算或宣称匹配。预期 SHA256 为 `bd01023d9dbcc6adbdbd36196f5c11413b76304fa8a4b3e0e0193085e0ff7192`，仅记录用户提供值。 |
| C. 导入后的 #42 SHA | 未导入。预期为 `764f2dd023d3e3ca54af755f6291e142e0ccb915`，不能写成实际导入结果。 |
| D. #42 兼容矩阵 | 仍未核验；下文已保留各接口的精确待核对调用点。 |
| E. 候选分支/HEAD | 未创建新候选。原分支 `phase2/mochi-editing-engine` / `2148e7444b9f4e9a2a6994f0c93c804b3efcf885` 保持不变。 |
| F. 相对 #42 文件/Hunk | 尚无法计算，未迁移或应用补丁。 |
| G. 测试/构建/浏览器 | 本轮停在访问检查，未重跑；此前原基线 65/65 PASS 不代表 #42 验收。完整构建/浏览器仍未完成。 |
| H. Draft PR | 无；基线恢复 BLOCKED，下游 PUBLISH BLOCKED。 |
| I. 风险 | Bundle 可见性、独立完整性验证、接口兼容、最小迁移及产品验收均待完成；不以其他文件代替 Git 对象。 |

**请求 Tech Lead 通过授权方式将原 Bundle 传递到当前隔离环境**，例如当前已授权工作区 `C:\Users\干陆烃芸\Desktop\HKS\phase2-core-42.bundle`，并告知最终可读的绝对路径。此路径只是建议接收位置，本轮未创建或写入该文件。收到后先独立计算 SHA256 并完整比较，再执行 bundle verify/list-heads、隔离导入及对象校验；任何失败均停止。

全部原始工作和未提交测试/报告保留，本轮仅追加此节。没有 Commit、Push、Merge、部署、付费调用、Force Push、reset、clean、rebase 或共享模块改动。等待 Bundle 的授权传递。

## #42 精确分支恢复执行：FETCH BLOCKED（2026-10-19，本轮最新）

本轮收到 Tech Lead 独立确认信息：仓库 `Nanmuxxx/BlockCraft-AI`，#42 源分支 `integration/phase2-core-candidate-20261019`，预期 HEAD `764f2dd023d3e3ca54af755f6291e142e0ccb915`；GO FOR DRAFT PR、MERGE BLOCKED。源分支名现已由用户提供，取代下文早先“分支名未知”的历史状态；但本机仍未取得该 Git 对象，不能宣称本机完成远端核验。

### A. 对象获取与保护结果

先执行 git status/worktree list/rev-parse：原始分支仍为 `phase2/mochi-editing-engine`，HEAD `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`；全部原有工作树保留。报告已有未提交修改，安全测试仍为未追踪文件，未覆盖或暂存。安全测试 SHA256 仍为 `3206B05193E1C027A58036AE36111EAA30BF1AC1AA20F885BD2E7799F8A64389`；开始时报告 SHA256 与上轮备份一致，为 `90C6919DF7C26C3DC2E2AC2DA92F90373644759D1768AF30FE60BBDBA88AA502`。

本轮实际命令和结果：

```text
git cat-file -t 764f2dd023d3e3ca54af755f6291e142e0ccb915
→ fatal: git cat-file: could not get object info

git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 fetch --no-tags origin refs/heads/integration/phase2-core-candidate-20261019:refs/remotes/origin/integration/phase2-core-candidate-20261019
→ exit 1; Could not resolve host: github.com

git rev-parse --verify refs/remotes/origin/integration/phase2-core-candidate-20261019
→ fatal: Needed a single revision

git cat-file -t 764f2dd023d3e3ca54af755f6291e142e0ccb915
→ fatal: git cat-file: could not get object info
```

按要求仅做这一次有界 fetch，未重试、未改变全局 Git/代理/DNS 配置、未申请扩大权限。工作区内未发现 `.bundle` 文件。由于缺少对象，没有运行或声称通过 #42 的 git fsck；本地缓存和网页文件都未替代 Git 对象。

### B. #42 兼容核验状态

| 接口 | 精确待核对调用点 | 本轮状态 |
| --- | --- | --- |
| Host/选择/取消 | `src/integrations/mochi/host.ts` createMochiHost、PlanRequest、setSelection、cancelRequest、dispose | #42 对象缺失，无法比对 |
| Preview/Confirm | host projection/onConfirm → `appChangePlan.ts` preview/confirm/cancel | 无法比对，不推定接口存在或缺失 |
| Runtime | `appRuntime.ts` executeCommand(request,authorization)、getSnapshot/subscribe/customProject | 无法比对 |
| CAS/授权 | `customProjectSession.ts` commitBuiltin → `custom-block-bc/owner.ts` compareAndSwap(expected,next,captured) | 无法比对；未修改共享 Core |
| AppSpec/命令 | `appSpec.ts` BlockSpec/AppCommand；`appSpecValidation.ts` assertCommandRequest；`appCommands.ts` processCommand/apply | 无法比对 |
| Planner/Provider | `appChangePlan.ts` createAppChangePlanner；`modelPlanProvider.ts` createModelPlanProvider；`planning.ts` toMinimalPlanInput | 无法比对 |

具体需求及原候选签名、拟迁移 11 文件清单和 block.presentation/B/C 契约完整保留在下文。本轮没有可验证的“共享接口缺失”证据，不向 Agent A 报告臆测的缺口。

### Core Lead Bundle 请求（待转交，未发送）

当前可用工具没有跨 chat 向 Core Lead 发送消息的能力；未声称已联系。请转交以下精确请求：

> 请从 PR #42 的准确 HEAD `764f2dd023d3e3ca54af755f6291e142e0ccb915` 制作包含完整可达祖先的 Git Bundle，放入 HKS 工作区可读位置，附 Bundle SHA256、git bundle verify/list-heads 结果及源分支 HEAD。不要提供网页源码或手工文件拼接。若源分支 HEAD 已变化，请停止制作并由 Tech Lead 裁决。

Core Lead 可在其持有准确分支的仓库执行下列命令；这是交接说明，**本机未执行导出或声称生成 Bundle**：

```powershell
$expectedCommit = '764f2dd023d3e3ca54af755f6291e142e0ccb915'
$sourceRef = 'refs/heads/integration/phase2-core-candidate-20261019'
$actualCommit = git rev-parse --verify $sourceRef
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $expectedCommit) { throw 'STOP: #42 HEAD differs or is missing' }
git fsck --full --no-reflogs $expectedCommit
if ($LASTEXITCODE -ne 0) { throw 'STOP: object integrity check failed' }
$bundlePath = Join-Path (Get-Location) 'phase2-core-candidate-764f2dd.bundle'
if (Test-Path -LiteralPath $bundlePath) { throw 'STOP: preserve existing bundle; choose a new filename' }
git bundle create $bundlePath $sourceRef
if ($LASTEXITCODE -ne 0) { throw 'STOP: bundle creation failed' }
git bundle verify $bundlePath
if ($LASTEXITCODE -ne 0) { throw 'STOP: bundle verification failed' }
git bundle list-heads $bundlePath $sourceRef
Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256
```

Bundle 到位后的接收步骤：比对独立提供的 SHA256；在新建隔离验证仓库执行 bundle verify 和 list-heads，确认源 ref 对应完整预期 SHA；导入到隔离验证仓库，执行 cat-file/rev-parse 和 fsck。对象与祖先完整后才导入候选所用仓库并创建 #42 工作树。任何 SHA 不符、缺失 prerequisite 或 fsck 错误都停止；不使用网页、猜测分支或 #40 代替 #42。本轮没有 Bundle，故未执行这些后续步骤。

### C–G. 当前交付状态

- 原始 Commit 保持 `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`；新候选分支/HEAD/Commit **未创建**。
- 相对 #42 的真实文件及 Hunk 清单 **无法计算**；此前导出的专属补丁只是原基线交接材料，不是 #42 兼容证明。
- 65 项测试最近一次复测仍是上轮原基线的 **65 PASS / 0 FAIL**，本轮没有新增或重跑测试；没有 #42 基线测试结果。
- 类型检查、构建、正式 B/C 浏览器验收仍未完成，历史缺依赖/DNS 证据有效；本轮未借用依赖或宣称通过。
- Draft PR URL：**无**。精确获取基线受 DNS 阻塞，即使源分支名已有 Tech Lead 确认，仍不能绕过接口审计、迁移和 Diff 校验直接发布。
- **最终状态 BLOCKED：FETCH BLOCKED；下游 PUBLISH BLOCKED。** 等待准确 Git Bundle 或正常网络恢复；GO FOR DRAFT PR 授权持续有效。没有 Push、Merge、部署、付费 API、Force Push、reset、clean、rebase、破坏性 checkout 或工作树删除。

## GO FOR DRAFT PR 后的 #42 交付执行（2026-10-19，本轮最新）

**最终状态：BLOCKED（FETCH BLOCKED）；发布状态：PUBLISH BLOCKED。MERGE BLOCKED 继续有效。** 已实际执行本地对象检查、远程查询和 fetch，不是仅提出迁移方案。本地缺少 #42 对象，GitHub DNS 失败，无法满足“#42 完整且接口兼容”这一迁移前提。本轮不增加测试数量、不改生产代码、不创建伪基线分支或迁移 Commit，不 Push/创建 PR/Merge/部署。

### A. #42 来源核验与接口兼容矩阵

用户指定 #42 HEAD：`764f2dd023d3e3ca54af755f6291e142e0ccb915`，本轮尚未取得并验证该对象。

| 实际执行 | 结果 |
| --- | --- |
| `git cat-file -t 764f2dd023d3e3ca54af755f6291e142e0ccb915` | `could not get object info` |
| `git show -s --format='%H%n%P%n%s' 764f2dd023d3e3ca54af755f6291e142e0ccb915` | `bad object` |
| `git branch --all --contains 764f2dd023d3e3ca54af755f6291e142e0ccb915` | `no such commit` |
| `git diff --name-status <#40 SHA> <#42 SHA> -- <接口文件>` | `bad object`，无法对照实际接口 |
| `git ls-remote origin refs/pull/42/head refs/heads/main` | `Could not resolve host: github.com` |
| `git fetch origin refs/pull/42/head:refs/remotes/origin/pr42` | 同一 DNS 错误，fetch 失败 |
| `git show-ref --verify refs/remotes/origin/pr42` | `not a valid ref` |

已检查 `git worktree list`：HKS 内现有 BlockCraft 工作树均共享当前对象库；没有 #42 工作树。工作区内文件名搜索未找到 #42 bundle/patch，只发现与 #42 无法建立来源关系的旧 server.patch，未拿它替代基线。未扩大个人目录访问范围。

下表为**已定位原候选调用点及对 #42 的待核验要求**。#42 代码不可读，不能把“未知”写成“缺失”或“兼容”。

| 接口 | #40/原候选中实际调用点及所需契约 | #42 兼容结果 |
| --- | --- | --- |
| Mochi Host | `src/integrations/mochi/host.ts`：createMochiHost(runtime, provider)，PlanRequest 的 requestId/context/snapshot/signal，selection/epoch/授权失效绑定。 | 未核验；对象缺失。 |
| Preview/Confirm | 同文件 projection/callbacks.onConfirm；`src/model/appChangePlan.ts`：createAppChangePlanner.preview/confirm/cancel，opaque plan 所有权及 diff。新增 presentationChanges 必须由生成端与投影端共同支持。 | 未核验。 |
| Runtime | `src/model/appRuntime.ts`：AppRuntime.executeCommand(request, authorization)、getSnapshot/subscribe/customProject；planner.confirm 传原 request 与捕获 token。 | 未核验，禁止自行补写共享 Runtime。 |
| owner/CAS | `src/integrations/custom-block-bc/owner.ts`：getAuthorization、compareAndSwap(expected,next,captured)；`src/model/customProjectSession.ts`：commitBuiltin。必须保留授权身份、snapshot identity 和 next revision 校验。 | 未核验。 |
| AppSpec/命令 | `src/model/appSpec.ts` BlockSpec/AppCommand；`appSpecValidation.ts` block/assertCommandRequest；`appCommands.ts` apply/processCommand。只迁移 presentation 字段及命令 case，不搬整个协议模块。 | 未核验。 |
| 模型适配 | `src/integrations/mochi/modelPlanProvider.ts`：createModelPlanProvider(complete,{timeoutMs}) 与 JSON request 形状；`planning.ts`：toMinimalPlanInput。 | 未核验，不能自动引入 #40 adapter 来填缺。 |
| C 渲染 | `src/components/app-renderer/AppRenderer.tsx`：BuiltinBlockRenderer 和 RecordEditor 的按钮文字/容器样式；不涉及 Workshop 卡片修改。 | 未核验。 |

给 Agent A/Tech Lead 的最小解除阻塞输入：提供可验证的 #42 Git 对象及其祖先（成功 fetch 或放在工作区内的 Git bundle），并提供 #42 的真实远程 head 分支名/当前 SHA。取得后先检查以上具体函数及调用点；若确有共享接口缺失，逐项提供缺失函数与最小签名要求，由 Agent A 修复。**当前没有证据认定 #42 已缺少哪一个 Core 函数，也未联系或修改其他 Agent 模块。**

### B/C. 分支、HEAD 与已准备的最小增量

- 原始 worktree 与分支保留：`C:\Users\干陆烃芸\Desktop\HKS\BlockCraft-AI-mochi-editing-engine`，`phase2/mochi-editing-engine`。
- HEAD 仍是原始 Mochi Commit `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`，父提交 #40 `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`。
- **新独立分支/新 Commit：未创建**；没有可验证的 #42，不能用 #40 冒充新基线。相对 #42 的实际文件/Hunk Diff 目前无法计算。
- 为恢复后可直接开展迁移，已实际导出 `.cache/mochi-pr42-handoff/mochi-original-increment.patch`，仅提取原始 Mochi Commit 相对其 #40 父提交的 9 个源码/测试文件，不含 #40 历史文件、不含 UI Workshop/server、不执行 apply。
- 补丁 SHA256：`FE8C28E2AA74EFDAC4321B696669D85B234454E9305E04C7659C79508394275F`；`git apply --stat`（只读统计）结果 **9 files, 247 insertions, 11 deletions**。这仅证明来源增量，不证明适用于 #42；取得对象后还须逐 hunk 审查并停止于语义冲突。
- 同目录另存未提交 46 项测试的逐字节副本，SHA256 `3206B05193E1C027A58036AE36111EAA30BF1AC1AA20F885BD2E7799F8A64389`；本轮更新后的完整报告也保存副本。所有原始未提交文件仍在原处。

| 准备迁移的文件/Hunk | 理由 |
| --- | --- |
| `src/model/appSpec.ts` | BlockPresentation 和 configureBlockPresentation union 扩展 |
| `src/model/appSpecValidation.ts` | 严格属性校验、受支持 block 字段、命令校验 case |
| `src/model/appCommands.ts` | 克隆事务内的受限 presentation merge case |
| `src/model/appChangePlan.ts` | 命令白名单、presentationChanges 类型和 diff 生成 |
| `src/integrations/mochi/host.ts` | 一条 presentation diff 的 Preview 投影 |
| `src/integrations/mochi/modelPlanProvider.ts` | 模型 JSON instruction 的受控命令说明 |
| `src/components/app-renderer/AppRenderer.tsx` | C 容器样式和表单按钮文字读取，不修改 Workshop UI |
| `tests/mochi/presentation-native.test.mjs` | 原有 19 项无依赖引擎回归 |
| `tests/mochi/presentation.test.cjs` | 原有 React SSR 回归，仍缺依赖未执行 |
| `tests/mochi/editing-safety-native.test.mjs`（单独副本） | 新增 46 项安全测试，保留但不再扩增数量 |
| `PHASE2-MOCHI-EDITING-REPORT.md`（完整副本） | 全部未提交验收记录及本轮阻塞证据 |

候选移植材料共 11 文件；最终相对 #42 的范围可能因基线已有能力减少，必须取得 #42 后才决定。未将本地补丁当成新实现或以 #40 的大历史直接创建 PR。

### D. 65 项复测结果及边界

本轮实际执行：

```text
node --experimental-transform-types --test --test-reporter=tap --test-reporter-destination=.cache/mochi-editing-safety-native.tap tests/mochi/presentation-native.test.mjs tests/mochi/editing-safety-native.test.mjs
tests 65 / pass 65 / fail 0 / cancelled 0 / skipped 0
```

测试对象仍是 **2148e744 的原基线生产代码 + 未提交安全测试**，不是 #42 集成候选，不能据此宣称 #42 已兼容或验收通过。没有新增测试。完整 build/tsc/浏览器仍未通过，沿用前文缺依赖、npm DNS、B 卡片展示缺口等记录。

### E/F. 发布决定

Draft PR URL：**无**。GitHub DNS 失败，无法确认 #42 真正的 head 分支和最新 HEAD，也无法取得基线。依赖接口、相对 #42 的 Diff 都无法核验，所以既不能创建满足前提的新本地迁移 Commit，也不能 Push 或创建正确 base 的 Draft PR。

解除 FETCH BLOCKED 后的执行顺序已明确：核对 #42 对象/远端分支 → 完成兼容矩阵 → 创建独立 worktree/分支 → 按上述专属 hunk 迁移（冲突立即停止）→ 65 项复测与 Diff 核验 → 更新真实新 Commit → 再核对远端 base 后 Push/Draft PR，描述注明 Depends on #42 和未完成验收。GO FOR DRAFT PR 授权已记录，无需重新请求重复授权；但不能越过无法验证基线这一事实条件。未 Merge、部署、付费调用或 Force Push。

## 独立安全测试继续推进（2026-10-19，本轮最新）

保留提交 `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`、`phase2/mochi-editing-engine` 和 #40 基线不变。开始时报告已有未提交追加 164 行，已保留。本轮只新增自身测试文件 `tests/mochi/editing-safety-native.test.mjs` 并追加本节；没有修改原有测试、任何生产模块、Workshop UI、server/index.mjs、授权检查或其他 Agent 文件。未 Commit、Push、Merge 或部署。

受测状态是既有 HEAD 的生产代码加本轮未提交测试文件，不是一个新的已提交候选。Tech Lead 集成裁决、依赖环境和浏览器验收仍待完成，整体交付状态仍为 BLOCKED。

### 执行命令与结果

环境沿用独立 worktree 的 Node `v24.22.0` 原生 TS transform/node:test；没有安装包、借用原项目 node_modules、联网调用模型或扩大权限。

```text
node --experimental-transform-types --test tests/mochi/editing-safety-native.test.mjs
→ tests 46, pass 46, fail 0, cancelled 0, skipped 0

node --experimental-transform-types --test --test-reporter=tap --test-reporter-destination=.cache/mochi-editing-safety-native.tap tests/mochi/presentation-native.test.mjs tests/mochi/editing-safety-native.test.mjs
→ tests 65, pass 65, fail 0, cancelled 0, skipped 0

node --check tests/mochi/editing-safety-native.test.mjs
→ exit 0

git diff --check
→ exit 0
```

联合回归包括原有 19 项及新增 46 项，不是新增 65 项。TAP 日志保存在本工作树 `.cache/mochi-editing-safety-native.tap`，该目录被 Git 忽略；未将本地日志作为新功能文件提交。Node TS transform 提示 experimental warning，这不是 tsc 类型检查。

### 46 项新增测试与真实状态证据

测试辅助 `capture/unchanged` 同时检查 Runtime snapshot 引用、owner snapshot 引用、完整 Runtime JSON 和 canUndo；拒绝不得悄悄改动数据或历史可用性。成功辅助 `applied` 构造预期完整 ProjectState 并做 deepEqual，覆盖 spec、records、布局、revision、其他积木；另核对 owner revision。以下每类均有最终状态断言，而非仅断言错误码。

| 场景 | 新增数量 | 结果和最终状态证据 |
| --- | ---: | --- |
| 连续合法修改 | 1 | 第一轮设置 buttonText/backgroundColor 后 revision=1，第二轮仅设置 textColor/borderRadius=0 后 revision=2；保留第一轮参数。确认第一轮旧的已提交句柄只作幂等响应，不把 revision=2 的状态覆盖。两次 receipt 为 1、2，完整业务数据保持预期。 |
| 两个独立 planner 预览同一 revision | 2 | 两个计划都在 revision=0 预览；分别测试任一计划先提交，胜者 receipt=1，败者 REVISION_CONFLICT。最终仅有胜者文字、revision=1，无丢失更新。 |
| 真实 owner CAS 竞争 | 2 | 两个已构造的合法候选持有同一 expected snapshot 和 authorization，分别测试候选 0/1 先提交。直接调用真实 customProject.compareAndSwap，第二个候选实际被 owner 以 REVISION_CONFLICT 拒绝，胜者完整状态与 revision=1 保持不变。没有替换 CAS 或返回值。 |
| 两个 Host 同时确认 | 1 | Promise.allSettled 提交两个预览；一个 fulfilled，一个 PLAN_NOT_PENDING rejected。Runtime 通知使另一 Host 计划失效，最终只应用 winner，revision=1。 |
| 选中项变化/取消/授权撤销重授/Host 销毁 × Provider 迟到 resolve/reject | 8 | 待处理请求以 CONTEXT_CHANGED 退役，Provider signal aborted=true；无视取消的 transport 后续成功或失败都不发布新 HostView。Runtime/owner snapshot 与完整 JSON 不变，revision=0，无 unhandled rejection。 |
| 项目交接 | 1 | 销毁旧项目 Host，新建 reading-log Runtime/Host 后合法提交新文字，next revision=1；旧 Provider 后到达，旧项目仍 revision=0，新项目仍保持自己的完整预期状态。明确测试 Host 生命周期接口，不冒充 Workshop UI 项目切换。 |
| foreign project planId | 1 | 两个 Runtime 即使 appId/积木 ID 相同，第二个 Host 也不能确认第一个的句柄：PLAN_NOT_OWNED；两个项目完整状态均不变。 |
| 新请求取代旧请求 | 1 | 新请求确认后仅保留 new，revision=1；迟到旧请求不能覆盖，也不能让 APPLIED 状态退回。 |
| 非法参数 | 13 | 三位 hex、CSS URL、命名色、null 色、负数/超限/小数/字符串圆角、121 字文字、纯空白文字、未知 fontSize、onClick、空 patch 均 VALIDATION/PREVIEW_REJECTED；完整状态与历史不变。 |
| 合法边界 Mock 响应 | 2 | 圆角 0 和 32、120 字文字、六位大小写 hex 通过；Preview 无写入，Confirm 后 APPLIED、revision=1，四个属性在 AppSpec 中与预期完全一致。 |
| Provider JSON/绑定/失败路径 | 10 | 无效 JSON、非字符串、超 64KiB 输出、null JSON、额外 authority、不同 requestId、错误 revision、禁止 undo、同步 throw、异步 reject 均按各自错误和 phase 拒绝；无 preview、无 Runtime/owner/历史变化。 |
| Provider 超时与恢复 | 1 | 测试配置 timeoutMs=5，忽略 abort 的 completion 被 MODEL_TIMEOUT 拒绝，signal aborted=true，状态不变；迟到合法响应仍不发布。随后新请求正常 Confirm，只有 retry 被应用，revision=1。测试不以真实耗时等于 5ms 为断言。 |
| Runtime 批次失败原子性 | 1 | 同批第一条合法表单 patch、第二条非法列表按钮文字，真实 Runtime 返回 VALIDATION，第一条也不发布，revision=0、canUndo 不变；修正后使用同 requestId 成功提交，证明失败未占用回执，revision=1。 |
| 真实旧授权拒绝 | 1 | 捕获 token 后撤销并重授，再传旧 token 到真实 executeCommand，owner 返回 AUTHORIZATION_CHANGED；完整 Runtime/owner 状态不变。 |
| Host 经真实 Runtime 失败后恢复 | 1 | 仅测试内用 executeCommand 包装器将 foreign Runtime token 传给原始 Runtime，真实授权检查返回 AUTHORIZATION_CHANGED，Host COMMIT_FAILED，正式数据/历史不变。恢复原方法后重新请求确认成功，最终只有 fresh，revision=1。未以固定失败返回值替代 Runtime。 |
| **合计** | **46** | **46 PASS / 0 FAIL** |

并发语义边界：Runtime 和 owner 提交接口本来是同步的，测试构造同时未提交的计划/候选并验证两种先后顺序以及 Promise 同轮确认，不虚构多线程执行。planner/Host 提前拒绝与实际到达 owner 的 CAS 拒绝分别测试、分别记录。

### 未改变的交付限制

这批测试填补了真实 owner CAS 竞争、Provider 失败及生命周期覆盖，不解决 #40/main 服务冲突、B 卡片展示投影或 npm DNS。未重跑已知受缺依赖阻塞的 tsc/build/浏览器，不宣称它们通过。原有各轮报告与证据保留在下文。本轮结束仅报告和新测试文件为预期未提交成果，等待 Tech Lead 裁决。

## 阻塞处理交付：最小解决方案（2026-10-19，本轮最新）

**状态仍为 BLOCKED。** 本轮只做核查和报告交接，不修改实现、测试、Workshop UI 或 server/index.mjs。开始时已有报告未提交增加 85 行，已全部保留；HEAD 仍为 `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`。本节是在既有独立验收之上的追加，不撤销后文证据。

### A. PR #40 基线、冲突归属及 Tech Lead 方案

本轮再次运行 `git ls-remote origin refs/heads/main refs/pull/40/head`，返回 `Could not resolve host: github.com`。**未取得实时服务器 HEAD**，不能将本地跟踪引用称作最新远端结果。可确认的本地值如下：

- main：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`。
- #40：`692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`。
- 本分支父提交：`692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`，证明以 #40 为实际基线；相对它仍仅 10 文件。
- 共同基线：`4044fb185a2720eead0dc6710b0d38a215439b98`；本轮只读 `git merge-tree <共同基线> origin/pr40 origin/main` 仍复现冲突，没有执行 merge。

冲突范围与语义：

| 一侧 | 可定位证据 | 需保留的语义 |
| --- | --- | --- |
| #40 | 本工作树 `server/index.mjs:213–220`，`if (isInteractive)` 中 AbortController、response close listener、admitInteractive 的 signal 和 finally 移除监听；读取输入后另有 res.destroyed 判断。 | 客户端断开时停止等待准入，避免已失去请求所有权后继续生成；#40 还包含上游取消与响应 envelope 验证，不能用整文件取 main 的方式丢弃。 |
| main | 从共同基线到 origin/main 的 server Diff：新增 fs/path 导入、requestPath/staticPath/serveStatic、生产静态资源配置；同一 admission try/catch 改为分行格式，未带 cancellation signal。 | 维持 #35 的容器/生产静态资源服务及路径、realpath 边界检查；不能用整文件取 #40 的方式丢弃。 |

同段冲突核心是 main 重排准入 try/catch 与 #40 加入取消逻辑重叠，并非两个互斥产品需求。建议负责人保留 main 的静态服务和边界检查，并把 #40 的准入取消语义完整带入；具体代码与回归由服务负责人负责。本次引擎提交不包含 server/index.mjs，**冲突属于依赖整合范围，不属于新增 presentation 命令范围**。

Tech Lead 可执行决策：

1. **建议主路径**：指定 #40/服务负责人，在其隔离整合分支核对实时 main/#40，解决服务冲突；用 Mock 验证断连、准入取消、生成迟到、静态资源/路径边界和 Docker 检查。发布明确的安全集成 SHA 和测试结果后，Editing Engineer 才在另行授权的非破坏性整合步骤中适配该基线。本轮不执行整合，也不改动现有提交。
2. **若先做代码评审**：可由 Tech Lead 批准将来使用 #40 的实际源分支作 stacked Draft PR base。上线/合并仍受主线整合和验收阻塞；不能对 main 展示 386 文件并称为本功能。GitHub 源分支名、实时 HEAD 及比较范围需联网重新核对，`origin/pr40` 是本地引用，不是已核实的 PR base 分支名。
3. **暂不选择独立搬运到 main**：当前依赖 #40 的 Host/Provider 与安全语义，不能只搬命令文件便宣称独立可交付；若有此需求，需先定义最小依赖集合及单独授权，不重复提交那 378 文件。

### B. Workshop 最小 B/C 显示属性契约（交接草案，未确认或发送）

权威字段位置为 `runtime.getSnapshot().spec.blocks[id匹配项].presentation`；B 的 adapter snapshot 中为对应 builtin `item.block.presentation`，底层来自同一 owner 的 `snapshot.base.spec.blocks`。不新增本地项目副本、DOM 写入或权限来源。

| 字段 | 类型、校验与适用对象 | 缺省/未传行为 | C 模式读取位置 |
| --- | --- | --- | --- |
| `presentation` | 可选对象；已设置时非空；表单/列表/指标可用，番茄钟与 CustomBlock 不在本命令范围。 | undefined 表示沿用既有展示；不把默认值写回 AppSpec。 | `AppRenderer.tsx:89`、`:93` |
| `buttonText` | 可选 string，trim 后非空，原字符串长度 ≤120；仅 form。React 文字显示。 | 新建表单按钮显示 `提交`；记录编辑按钮仍为 `保存修改`，不受本字段影响。 | `AppRenderer.tsx:93` 传入 RecordEditor，`:44` 消费。 |
| `backgroundColor` | 可选 string，仅六位十六进制 `#RRGGBB`。 | 不设置内联样式，使用各 surface 既有样式；C 的 `.renderer-block` 默认 white。 | `AppRenderer.tsx:89` 的 section.backgroundColor。 |
| `textColor` | 可选 string，仅 `#RRGGBB`。 | 不设置内联 color，按样式继承；没有统一持久化默认色。 | `AppRenderer.tsx:89` 的 section.color；并非重写子元素显式颜色。 |
| `borderRadius` | 可选 integer，0–32，渲染单位 px；0 必须正确显示。 | undefined 使用既有样式；C 的 `.renderer-block` 默认 16px；B 的缺省仍为现有卡片样式。 | `AppRenderer.tsx:89` 的 section.borderRadius。 |

颜色/圆角的当前语义是**积木容器**样式，不是按钮样式。C 的表单按钮、输入框和 metric output 有自身颜色规则；不能承诺 textColor 改变全部子元素。若产品期望按钮背景或 metric 数值颜色，需先约定新的明确语义，再增加允许字段或渲染映射，不能临时把旧字段解释为任意 CSS。

C 的正式路径：`AppSpecWorkshop.tsx:89` → `CustomBlockRunSurface` → `BuiltinBlockRenderer`，后者订阅 runtime；不是只在独立 AppRenderer demo 中生效。

B 的缺口定位：`CustomBlockCanvas.tsx:15–19` 已订阅 adapter snapshot 并读取 orderedBlocks，`:54–69` 用 catalog tone、name、description 渲染，`:60` 的 style 只有 left/top/width/height。数据能到达，缺少 presentation 的读取和投影，**不需要新增 Runtime API**。

Workshop 最小改动建议（仅由 UI 负责人执行）：

1. 仅对 builtin 卡片读取 `item.block.presentation`，将已定义背景色、文字色、圆角映射到卡片容器；保留拖动布局和选中/焦点可见性，undefined 不覆盖现有 CSS。0 圆角不可用 truthy 判断丢弃。
2. form 的 buttonText 在卡片内以普通文本/示意标签展示，不替换 block.name，不改变积木身份或业务提交行为。卡片本身是 `<button>`，不得再嵌套真正的按钮。
3. 沿用 Host callbacks 和 diff：`operation='configureBlockPresentation'`，target 为稳定 blockId，before/after 为 JSON 文本；Confirm 提交原 planId。B/C 切换仅改变视图，不请求、刷新或重新授权计划。
4. 修改协议仍是 `{type:'configureBlockPresentation', blockId, presentation:非空部分对象}`。部分对象按字段合并，未提及字段保留；null、空对象、删除字段/恢复默认命令尚不支持。UI 如需恢复默认功能应单独提出，不能自行写 Runtime 状态。

最小验收要求：在真实 Workshop 浏览器夹具中注入固定 JSON Provider，B 选稳定 ID → 输入指令 → Preview 显示准确 before/after 且 revision 不变 → 明确 Confirm 后 revision +1 → B 卡片显示相同参数 → C 的真实 section computed style 和表单文字匹配 → 回 B 参数仍在。fixture 必须支持 presentation，现有只增加字段的 fixture 不够。另测两次部分更新、borderRadius=0、缺省旧项目、拒绝后卡片与 C 都不变、选中/焦点样式及拖拽不受破坏。自动化必须检查真实 B 卡片及 C 渲染器，不能两次调用同一个 AppRenderer 替代。

### C. npm DNS 与隔离测试能力

本轮只读核查：

- `npm config get registry`：`https://registry.npmjs.org/`。
- Node DNS lookup：host `registry.npmjs.org`，code `ENOTFOUND`，syscall `getaddrinfo`，没有取得地址；属于域名解析失败，不能归因为 package 版本或编译错误，也不能凭此确定是机器 DNS 还是沙箱策略。
- lockfileVersion=3；Node 内置 fs/JSON 对照 package.json 与 lockfile 根 packages['']：dependenciesMatch=true、devDependenciesMatch=true；全部 resolved URL hostname 为 registry.npmjs.org。没有证据要求更换 registry 或重建 lockfile。
- 本地 package.json SHA256 `0785D305ED02705F8FD8F621981CFF5E353B93145DA1E65E7B2865EE0BBED839`；lockfile SHA256 `E1F636902E0D2A77C2E7BF6B092F730044137D195764093EEB7AD5051B6F80B9`，未变化。
- `Test-Path node_modules`、`node_modules/typescript/bin/tsc`、`node_modules/playwright` 均 False。此前独立离线缓存缺包、在线 DNS 失败记录继续有效。没有使用原项目依赖，没有修改全局 npm/Git/代理设置，也未扩大环境访问权限。
- 隔离环境可用能力：Node `v24.22.0`、npm `11.19.1`、Node 内置 TS transform 和 node:test。本轮重跑 `node --experimental-transform-types --test tests/mochi/presentation-native.test.mjs`：**19/19 PASS**；这不提供 React、tsc 或浏览器。

本轮没有新安装，没有反复运行已知缺依赖的完整检查。上一轮 npm test、tsc、build、浏览器的失败结果仍为未通过。最小恢复条件是环境维护者在获准环境中提供此 worktree 专用、与 lockfile 一致且不链接原项目的依赖及 Playwright/浏览器；之后再执行完整检查。无需为本轮诊断调整任何全局或代理配置。

### D/E. 责任与执行顺序

| 负责人 | 最小下一步 | 完成证据 |
| --- | --- | --- |
| Tech Lead | 指定 #40/服务冲突负责人，决定安全集成基线或 stacked review base，确认实时 SHA；安排可用的隔离依赖环境。 | 已核实的远端引用/源分支名、集成 SHA、server/Docker/准入取消回归、隔离依赖来源与可用状态。 |
| Workshop | 确认 B 卡片字段映射契约并修改其 UI；决定缺省展示与子元素颜色语义。 | 真实 B 卡片读取同一 snapshot，参数可见，拖动/选择/焦点不回归。 |
| Editing Engineer，可独立继续 | 在自身引擎/测试范围补真实 owner CAS 竞争和跨 Runtime/项目撤销测试、Provider 的 presentation 浏览器 fixture 方案、输入参数/连续修改/来源记录与旧协议兼容审计；保持正式入口禁用。 | 原生测试可现在运行；新增测试应区分模拟 executeCommand 失败与真实 owner 拒绝。浏览器 fixture 的实施需避开 Workshop 同一文件并先约定测试边界。 |
| Editing Engineer，待外部条件后 | 基于 Tech Lead 指定候选复核 Diff，运行 npm test/tsc/build/正式 B→C E2E，汇总新的实际证据。 | 全部命令实测及受测 SHA；不能用本轮 19 项替代 UI/构建验收。 |

建议顺序：Tech Lead 确认依赖策略与服务负责人；Workshop 确认并实施展示契约；隔离依赖恢复；Editing Engineer 复核整合候选并验收。前三项可由对应负责人并行推进，但本轮不启动其他 Agent、不发送外部消息、不实现或提交新模块。**本报告完成后等待下一步，不 Push、不创建 PR、不 Merge、不部署。**

## 提交后独立验收结论：BLOCKED

本节为对既有提交的复核，优先于后文开发阶段记录。受测 HEAD：`2148e7444b9f4e9a2a6994f0c93c804b3efcf885`，分支 `phase2/mochi-editing-engine`。验收开始时 `git status --short` 无输出。保留全部实现，不修改生产代码、测试或提交历史；本轮仅更新此报告，不 Commit、不 Push、不创建 PR。

阻塞理由：

1. 本地 #40/main 的只读合并预演仍存在服务准入冲突，不能宣称与主线已安全集成。
2. 当前隔离 worktree 没有 node_modules，完整测试、TypeScript 和 build 没有通过；浏览器启动脚本缺少 Playwright。
3. B 模式卡片 `CustomBlockCanvas.tsx:60` 的 style 仅投影布局，未消费 `block.presentation`。19/19 中的模式一致性只验证 Runtime snapshot 身份；CJS 渲染测试也在两种 mode 下调用同一个 AppRenderer，不验证真正的 B 卡片。B/C 视觉一致性尚未完成。
4. 现有浏览器 fixture 仅生成 addField/configureBlockFields，尚无 presentation 修改的浏览器场景；即使依赖恢复，也不能直接据此宣称新功能 E2E 通过。

### Git、远端与 PR 范围

| 检查命令 | 实际结果 |
| --- | --- |
| `git rev-parse HEAD` | `2148e7444b9f4e9a2a6994f0c93c804b3efcf885` |
| `git rev-parse HEAD^` | `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`，等于本地 origin/pr40 |
| `git rev-parse origin/main origin/pr40` | main `b56a26a9803718d806bac3ddbd7fbe19e0c495c6`；#40 `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc` |
| `git ls-remote origin refs/heads/main refs/pull/40/head` | GitHub DNS 失败：`Could not resolve host: github.com`。上述是此前成功 fetch 后的本地远端跟踪值，**本轮无法确认服务器是否已有新 HEAD**。 |
| `git merge-base origin/main origin/pr40` | `4044fb185a2720eead0dc6710b0d38a215439b98` |
| `git rev-list --count origin/pr40..HEAD` | 1 |
| `git diff --shortstat origin/pr40...HEAD` | 10 files changed, 323 insertions(+), 11 deletions(-) |
| `git diff --shortstat origin/main...HEAD` | 386 files changed, 44522 insertions(+), 213 deletions(-)；**不适合作为本功能独立 PR Diff**。 |
| `git merge-tree 4044fb185a2720eead0dc6710b0d38a215439b98 origin/pr40 origin/main` | 无 checkout 的三方合并预演，输出 `server/index.mjs` 冲突标记。 |

本提交没有重新提交 #40 的 378 文件，但对 main 开 PR 会在比较结果中带上基线变更。必须使用经重新核对的 #40 实际源分支作为堆叠 PR base；`origin/pr40` 只是本地拉取引用，不能假定为 GitHub 可选源分支名。目前无法在线核对源分支名。

冲突证据：#40 的 `if (isInteractive)` 内创建 AbortController，注册 `res.once('close', cancelAdmission)`，向 admitInteractive 传递 `signal: admission.signal` 并在 finally 移除监听；main 的同段为不传 signal 的 try/catch。选择错误一侧可能丢失取消准入保护或 Docker/server 集成，需服务负责人整合。本次不解决或提交该冲突。

### 全部 10 个文件与核心 Diff 审计

| 文件 | 提交内变化与评估 |
| --- | --- |
| `PHASE2-MOCHI-EDITING-REPORT.md` | 新增开发报告；本轮附加独立验收结果，保留未提交。 |
| `src/model/appSpec.ts` | 新增可选 BlockPresentation 和命令 union。现有字段、revision、授权参数无删除；类型扩展不等于旧消费者已兼容。 |
| `src/model/appSpecValidation.ts` | 严格限制非空 patch、文字、颜色和圆角，拒绝额外属性；pomodoro 结构仍不接受 presentation。旧版本 validator 未允许此字段，因此新状态不能宣称可由旧版本导入。 |
| `src/model/appCommands.ts` | 新 case 只在事务克隆内 merge presentation，拒绝未知目标、番茄钟及非表单按钮文字。processCommand 的 baseRevision、最终状态验证、回滚、receipts、undo 均未改动。 |
| `src/model/appChangePlan.ts` | 扩大命令白名单，增加必填 presentationChanges diff；新命令落入现有 trusted block/entity scope 检查。confirm 仍提交原 request 与捕获的 authorization，未刷新版本或授权。新增 diff 字段对外部手工构造 diff 的消费者仍需兼容检查。 |
| `src/integrations/mochi/host.ts` | 仅增加一条 diff 显示投影。请求所有权、epoch、选中项、授权失效、Confirm 状态机、原句柄提交均未修改。 |
| `src/integrations/mochi/modelPlanProvider.ts` | 仅扩展 instruction 的命令说明，未接入网络、付费模型或新增权限。 |
| `src/components/app-renderer/AppRenderer.tsx` | 真正读取 runtime block.presentation，设置 section 样式及表单提交文字；React 文字渲染，无 DOM patch。但颜色/圆角作用于 section，不能宣称为按钮样式；子元素有自身颜色规则。 |
| `tests/mochi/presentation-native.test.mjs` | 19 项 Node 原生真实引擎测试；自定义 hook 只补全 .ts/index.ts 路径，不替换生产模块。 |
| `tests/mochi/presentation.test.cjs` | React SSR 测试与错误场景；本轮仅语法检查通过，执行仍受缺依赖阻塞，不是浏览器 E2E。 |

`git diff origin/pr40 HEAD -- package.json package-lock.json src/model/appRuntime.ts src/model/customProjectSession.ts src/integrations/custom-block-bc/owner.ts` 无输出。Runtime/owner CAS 本身未改动。静态路径仍为 processCommand → commitBuiltin → compareAndSwap；owner 检查只读、captured authorization identity、expected snapshot identity、next revision +1。**未发现本次 Diff 禁用权限或绕过 CAS 的改动，但完整回归未通过，不能认证全部主线 API 兼容。**

### 本轮命令与实际结果

环境：Windows_NT 10.0.26200（安装日志），PowerShell，Node `v24.22.0`，npm `11.19.1`；cwd 为本独立 worktree。package.json/lockfile 哈希与后文记录相同。`Test-Path node_modules`、`node_modules/typescript/bin/tsc`、`node_modules/vite/bin/vite.js`、`node_modules/playwright` 均 False。本轮未连接、读取运行或修改原项目 node_modules，未申请扩大权限。

| 实际命令 | 结果 |
| --- | --- |
| `node --experimental-transform-types --test tests/mochi/presentation-native.test.mjs` | **19 pass / 0 fail**，本轮重新运行。不是 tsc 检查。 |
| `node --check tests/mochi/presentation.test.cjs` | exit 0，仅 JS 语法检查。 |
| `git diff --check` | exit 0。 |
| `npm test` | exit 1，9 个测试文件启动失败：`Cannot find module 'typescript'`；0 pass，不代表运行了全部业务断言。 |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 1，MODULE_NOT_FOUND；类型检查未开始。 |
| `npm run build` | exit 1，`'tsc' is not recognized`；Vite build 未运行。 |
| `node tests/mochi/browser.cjs` | exit 1，`Cannot find module 'playwright'`；浏览器未启动，未产生本提交浏览器验收结果。 |
| `node -e 'require("node:dns").lookup("registry.npmjs.org", (error, address) => { console.log(JSON.stringify({host:"registry.npmjs.org",error:error?.code,address})); process.exitCode = error ? 1 : 0 })'` | exit 1，`{"host":"registry.npmjs.org","error":"ENOTFOUND"}`。未重复安装或更改依赖。 |

本轮只读复核此前独立缓存安装日志 `.cache/npm-isolated/_logs/2026-10-19T02_32_18_583Z-debug-0.log`，包含 Vite tarball `getaddrinfo ENOTFOUND registry.npmjs.org`，cwd 正是本 worktree。此前离线 ENOTCACHED 和在线 ENOTFOUND 的完整安装命令见后文。当前 DNS 仍失败，无安全可用的已安装隔离依赖；替代方案是在获准网络环境为此工作树独立安装 lockfile 依赖及浏览器工具，再复跑上述检查。不得借用原项目 node_modules。

### 行为与 CAS 证据边界

19 项断言覆盖已逐项复核：基本提交、8 个非法 patch、4 个 stale/cancel 场景、越权后重新提交、模拟 Runtime 拒绝、批次原子性、连续 merge patch、迟到响应、foreign-owner 授权拒绝。

另运行一次 `node --experimental-transform-types --input-type=module` 内联诊断：导入现有 native 测试注册解析 hook，直接调用 createAppRuntime/createMochiHost，以固定 JSON Provider 提交全部四个属性（无模型/API 调用），实际输出：

```text
ACCEPTANCE_PREVIEW: revision=0, unchanged=true
ACCEPTANCE_COMMIT: beforeRevision=0, afterRevision=1
presentation={"buttonText":"独立验收","backgroundColor":"#abcdef","textColor":"#123456","borderRadius":12}
receipt={"ok":true,"duplicate":false,"committedRevision":1}
ACCEPTANCE_DENIED: baseRevision=0 → REVISION_CONFLICT, revision=1, sameSnapshot=true
```

这些证明 AppSpec/Runtime 真正变化与旧版本拒绝原子性，不是渲染成功证据。foreign-owner 测试经过真实 owner，确认授权对象无法跨 Runtime 使用；名为 owner/CAS denial 的另一测试替换 executeCommand 返回失败，**只验证 Host 错误处理，不能计作真实 CAS 冲突复现**。旧 revision 在 processCommand 被拒绝，也不等于实际到达 owner 的竞争窗口。全量 CAS 回归、跨项目浏览器切换与真实并发竞争仍未验收。

### 交付决定

**BLOCKED，暂不准备推送操作或创建 Draft PR。** 预期目标分支仍为 `phase2/mochi-editing-engine`；将来仅在基线冲突解决并重新核对远端后，以 #40 实际源分支或已吸收 #40 的新 main 为正确 base。预期本功能 Diff 是上述 10 文件，当前禁止直接使用对 main 的 386 文件比较冒充独立功能。

正式 AI Provider 入口保持禁用。没有 Merge、部署、付费调用、reset、force push、依赖连接或工作区清理。本轮结束时 HEAD 保持 `2148e7444b9f4e9a2a6994f0c93c804b3efcf885`，仅本报告为预期未提交修改。

## 基线与隔离

- 远端 main 已成功 fetch：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`。
- PR #40 HEAD 已成功 fetch：`692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`。
- worktree：`C:\Users\干陆烃芸\Desktop\HKS\BlockCraft-AI-mochi-editing-engine`。
- 分支：`phase2/mochi-editing-engine`，直接基于 #40 HEAD；已有 378 个文件不是本功能新增。评审应使用 `git diff origin/pr40...HEAD`，后续 Draft PR 应明确堆叠依赖 #40。
- main 与 #40 merge-base：`4044fb185a2720eead0dc6710b0d38a215439b98`。
- 尝试合入 main 时，`server/index.mjs` 的 trusted-interactive admission cancellation 与 main 的 Docker/server 更改冲突。已 `git merge --abort`，不修改其他负责人服务模块。当前受测代码是 #40 基线加本报告所列修改，**不是已整合最新 main 的候选**。

## 已有能力审计

| 路径 | 实际能力与限制 |
| --- | --- |
| `src/integrations/mochi/host.ts` | 真正的异步请求、选择绑定、epoch、授权身份、取消、迟到响应丢弃、预览句柄、明确确认；不是 UI Mock。Host 本身不自动获得模型权限。 |
| `src/model/appChangePlan.ts` | JSON 深拷贝安全检查、命令白名单、trusted scope、records 保留、不可伪造计划所有权、原请求确认、revision 检查。 |
| `src/model/appRuntime.ts` / `customProjectSession.ts` | 真正的事务处理与共享 snapshot，提交经过 owner/CAS，携带预览捕获的 authorization；本次未更改 owner 或授权机制。 |
| `src/integrations/mochi/modelPlanProvider.ts` | 已有可插拔 JSON completion 接口、大小上限、deadline、取消；本次扩展允许命令说明，未增加网络传输。 |
| `src/integrations/mochi/planning.ts` | 正式 provider fail closed；保持禁用。不能据此宣称已启用真实 Mochi AI。 |
| `WorkshopMochi.tsx` / Conversation | 已有消息、preview、confirm、receipt 交互；会话文字不等于修改执行。未修改这些共享 UI 文件。 |
| CustomBlock / pending-build / execution denied | Host 仍拒绝 CustomBlock 修改，可信番茄钟仍拒绝 AI 计划。未绕过构建、执行或 artifact 安全准入。 |

## 本次真实生效的引擎场景

复用已有 Provider → Host → AppChangePlanner → explicit Confirm → Runtime.executeCommand → owner/CAS 路径。

增加 `configureBlockPresentation`：针对已有 AppSpec 表单、列表、指标，仅允许非空 merge patch。

- 表单按钮文字：非空，最长 120 字符；列表/指标不能设置按钮文字。
- 背景色、文字色：仅 `#RRGGBB`。
- 圆角参数：整数 0–32。
- 禁止未知属性、事件、CSS URL、任意 TSX、DOM 写入。
- diff 包含实际合并后的 before/after。连续修改保留未覆盖参数，失败批次保持原 snapshot。
- `AppRenderer` 从共享 Runtime 渲染按钮文字和受支持样式；没有直接修改 DOM。
- 继续使用已有 `configureBlockFields` 支持字段参数配置，未重新实现字段引擎。

## 实测证据

命令：`node --experimental-transform-types --test tests/mochi/presentation-native.test.mjs`

**19 项通过，0 失败**，Node `v24.22.0`。测试直接导入实际 TypeScript 模块，无 npm 依赖、无复制生产代码、无付费 API。

覆盖：模型 JSON fixture 到确认提交；预览无写入；重复确认一次提交；连续两次 revision 递增；B/C 模式切换持有同一 snapshot；records 保留；非法参数；越权拒绝与重新提交；选择变化；revision 变化；授权撤销后重新授予；取消；迟到响应；批次失败原子性；部分参数合并；模拟 Runtime owner/CAS 拒绝；真实 foreign-owner authorization 拒绝。

真实 Runtime 证据：表单 `presentation.buttonText` 从未设置变为 `立即报名`，revision +1；第二次变为 `再次报名`，revision 再 +1；记录内容保持不变。上述断言已实际执行。

`node --check tests/mochi/presentation.test.cjs` 与 `git diff --check` 通过。**这些不是完整类型检查。**

## 浏览器与依赖安装：未通过验收，明确阻塞

- 原项目和本 worktree 的 lockfile SHA256 均为 `E1F636902E0D2A77C2E7BF6B092F730044137D195764093EEB7AD5051B6F80B9`。
- package.json 不同仅因 #40 已有 scripts；依赖声明相同。原项目 SHA256 `502AF6E0964835F9E47BCF698F2B81A8D60E6FEA4D59EF9FD6E13B39E486A535`；本工作树 `0785D305ED02705F8FD8F621981CFF5E353B93145DA1E65E7B2865EE0BBED839`。
- 原项目 node_modules 存在；本工作树开始不存在，Junction 未成功创建。用户拒绝链接后未再申请链接或扩大权限，未修改原项目依赖。
- 独立 `npm ci --offline --ignore-scripts --no-audit --no-fund --cache .cache/npm-isolated`：ENOTCACHED（缺少 Vite）。
- 独立在线安装（同一沙箱、同一独立缓存）：ENOTFOUND registry.npmjs.org。安装可能留下局部目录，不能视为可用依赖。
- 原有 Host/AppChangePlan 测试与 tsc 尝试失败于缺少 TypeScript，不计为通过。
- 新增 `tests/mochi/presentation.test.cjs` 包含真实 React renderer 的文字、样式、模式一致性检查，**尚未执行**。
- 完整构建、React 渲染、原有 CAS 全量回归及真实浏览器 E2E **尚未完成**。不能把原生引擎的 snapshot 一致性写成浏览器 B/C 视觉验收。

## Workshop UI 接口交接（待对方确认）

未联系或修改其他负责人的 UI 模块。建议由 Workshop 负责人接入：

1. 保持现有 Host callbacks、HostPreview 与显式 Confirm 按钮契约。
2. `preview.changes` 新 operation 为 `configureBlockPresentation`，before/after 是仅供文本显示的 JSON。
3. B 模式从 owner snapshot 的 builtin `block.presentation` 投影卡片展示；C 模式使用实际 `BuiltinBlockRenderer`。不能用 DOM 补丁替代 Runtime 状态。
4. 正式 provider 未批准时继续传入禁用原因，fixture 仅用于测试。

## 提交、PR 与未解决风险

本地提交信息：`feat(mochi): add controlled AppSpec presentation editing`。准确提交 SHA 以 `git log -1` 为准；报告不会把提交自己的 SHA 写入自身形成循环。

Draft PR 尚未创建；本机无 gh，联网受限，且最新用户要求不得扩大权限。可以在可用网络环境推送该独立分支，并以 #40 分支为堆叠基线创建 Draft PR；不得将 #40 的 378 文件作为独立功能。

尚未满足完整成功标准：main/#40 服务冲突仍需对应负责人集成；B 卡片视觉投影及浏览器 E2E 待 Workshop 接口确认和独立依赖可用；CustomBlock 参数修改、跨项目浏览器竞态、完整类型检查、多轮模型上下文与持久化修改来源尚未完成。现有 lastApplied/receipt 提供本次来源身份，不等于持久化审计日志。正式入口继续禁用，零付费调用。
