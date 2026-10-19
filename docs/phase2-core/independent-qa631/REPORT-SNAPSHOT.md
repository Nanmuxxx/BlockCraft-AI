# Phase 2 候选独立 QA：63197299 / PR #44、#45

当前裁决：**BLOCKED，禁止作为 READY FOR MERGE。部署 NO-GO。**

## 精确版本与归属

2026-10-19 10:49（Asia/Shanghai）重新读取 GitHub：

- main：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`，已包含 #35、#41。
- PR #42：`764f2dd023d3e3ca54af755f6291e142e0ccb915`。
- PR #44：`da212774b7022f95c036b1167ae2d204f65080bc`，OPEN / Draft / mergeable=true。
- PR #45：`1e5ac96ac60404549bc8405f07185d51b6eb706e`，OPEN / Draft / mergeable=true。
- 本 Agent 实际执行：`63197299ab85330a63dc9af8525d5c5e8d78b48c`；tree `ba8e37824ec0a4e2a5bfab77dbdf120b637faa35`。这是独立临时工作树中的组合候选，不是正式 main 合并。
- #45 与受测 631 的生产 blob 对比完全相同，范围 src/server/tools/Dockerfile/.dockerignore/package*.json/vite.config.ts。不同项为文档、日志和第 11 项安全测试。不能把实际执行 SHA 改写为 #45 HEAD。映射证据：`evidence/phase2/pr45-production-mapping.json`。
- #44 的 5 个 gateway 模块与 631 相同；两个 Provider 和入口已由 Core 组合，不能声称 #44 与 631 全树相同。映射：`evidence/phase2/pr44-production-mapping.json`。

所有 tracked 文件测试前后 SHA-256 完全一致；只增加 tests/phase2-qa 与 evidence 的临时验收产物。未修改生产代码、main、其他 Agent 工作树；未 Merge、部署、访问生产密钥或执行付费请求。

## 运行环境与证据限制

macOS Darwin 25.6 arm64；Node 24.22.0；npm 11.19.1；Playwright 1.64.1；Chromium 156.0.8078.4。测试预加载 `tests/phase2-qa/no-paid.cjs`，禁止 Node fetch 出站到非 loopback，Provider 为闭合 Mock。浏览器回放也拒绝非本地源。普通 npm 安装单独走包注册表，不能据此称模型外网调用成功。

核心批次约 02:17–02:18 UTC；新增回放 02:49:40.162–02:49:54.985 UTC（14.823 秒）。完整命令索引记录每次起止、耗时、退出码、环境和 SHA。**这是短时验收，没有五小时或六小时稳定性证据。**

本候选没有重新执行 npm test 全量；没有把开发方 812/812 或旧 main 194/194 计为独立通过。当前正式全量门禁保留 NOT_RUN。

## 实际自动化与浏览器结论

- TypeScript/Vite build PASS；server / protocol / ZIP prepare PASS。
- 原安全集 10/10 PASS；另取 #44 精确测试副本 11/11 PASS（路径改变，不改断言）。两组重叠，不能相加称 21 项独立覆盖。
- Mochi CAS 57/57 PASS；ZIP exporter 63/63 PASS；独立 generation/Mochi/deadline/owner 边界 44/44 PASS。
- 未认证 legacy v1 / v2，无 Origin、伪造令牌等 8 个独立请求均 401，Provider 0 次。
- 正式 `/ai-create` 生成回归：7 个可信 AppSpec Fixture ×1366/390，B/C、失败保留、重试 PASS。真实后端经过本地代理，模型端为 Mock。
- 正式页面取消：1366/390 PASS；忽略 abort 的 Mock 迟到成功/失败不覆盖、记录保留、离页/请求体取消。
- PR #39 可信离线番茄钟：1440/390 PASS，25 分钟、显式加载、来源、B/C 状态、开始/暂停/继续/重置；v2 ZIP 拒绝、无 TSX 执行。独立 race 测试使用 QA Vite 内存 transform，不能冒充未修改正式 UI 的全部行为。
- 正式 Mochi Workshop：1366/390，真实服务端/客户端协议 + Mock 响应，授权撤回/重新授权、隐私、预算零调用、失败重试 PASS。**正式修改 composer 仍禁用，Mochi 修改现有组件端到端为 BLOCKED。**
- `/__mochi` Fixture Host：1366/390 修改、owner/revision/CAS、取消生命周期 PASS。仅此夹具结果，不能用来宣称正式 `/ai-create` 修改已接入。
- 正式 Workshop ZIP：1366/390 下载、B/C、旧快照、v2 拒绝 PASS；普通生产导出端点 404 的既有边界保持。
- 下载 ZIP 在新目录、空 npm cache/config 执行普通 `npm ci`（没有 --ignore-scripts）、build、独立 preview，1366/390 完整 CRUD PASS：原 ID 更新、无重复、取消、删除编辑中记录、空列表、刷新初始快照。隐藏字段/非法 ID 检查使用 QA React callback 注入，不能称正常 UI 操作。截图经独立目视检查。
- ZIP SHA-256：`f3fdc43d9673ce69c6b944b98f1a852c26bc711087e8084c402a426582584fa7`，39519 字节、15 文件。详情 `evidence/phase2/standalone/report.json`。

## #44 网关与脱敏响应回放

开发方提供 todo/club 两份历史脱敏响应。独立校验响应 SHA 与随附 live-browser 报告完全一致，协议/Runtime 3/3 PASS。历史真实网络调用的来源由开发方证据提供，本 Agent 没有独立旁观当时的网络，因此表述为“开发方提供的真实响应样本回放”，不称本 Agent 实时模型验证。

回放脚本 `tests/phase2-qa/replay44.mjs` 已彻底移除 live 分支、密钥读取和付费 transport；正式 `/ai-create`、真实本地后端与认证代理，todo/club ×1366/390 PASS：字段验证、新增/查看/编辑/取消/删除编辑中记录、B/C 数据保留、网络失败/非法响应/取消与迟到响应不覆盖、空列表、无 iframe/任意生成 TSX。没有前端源码 transform 或 Runtime 内省。真实模型请求 0；浏览器外部请求 0。该脚本基于 #44 evaluator 的浏览器步骤改为 QA replay-only，独立结果见 `evidence/phase2/pr44-replay/replay-browser.json`。

安全检查已覆盖：默认拒绝、legacy 绕过、native egress 拒绝、固定 endpoint/model/输入字段、预算先持久化后 fetch、金额/次数上限、并发、超时取消、未知 usage 永久 halt、lease/权限/损坏账本、密钥错误脱敏。失败不退款：预留故意保留且停止下一调用，这是保守费用规则；请求 active 锁释放与金额退款不能混为一谈。

补充独立 6 项：4 PASS / 2 FAIL，原始失败保留，不改生产实现或断言：

1. PASS：预取消零预留零 Provider；跨 transport 共账本拒绝第二预留；取消 pending body 后锁释放但保留预留，重开账本仍 halt。
2. PASS（行为记录）：完全相同顺序请求会分别占两次预留/两次 Mock 调用；hash 相同、reservation ID 不同。**无幂等去重**，总预算/六次 cap 仍生效。如产品要求同 requestId 只计一次，需要开发方明确契约。
3. P2 / FAIL：`server/paid-gateway/provider.mjs:80` 的 onResponse 回调未放入 abortable；10ms deadline、挂起回调，40ms 后仍 pending，释放回调后甚至返回成功。需要可挂起自定义 hook 才触发；默认无 hook，当前 owner evaluator 的 hook 为同步写文件。不能泛化为所有网络超时失效。
4. P2 / FAIL：`:76–80` 仅检查 content 中 API key，却复制任意 upstream model 字符串。Mock 上游将测试 key 放入 model 时，onResponse 与 transport Response 都含哨兵。不是线上真实密钥泄露证据，也没有证明 HTTP AppSpec 路由会回传此字段；暴露面是 transport 输出/使用该字段的审计钩子。建议模型字段严格匹配固定模型或使用固定值，并对整个安全信封检查敏感值。

复现：带 no-paid preload 运行 `node --test tests/phase2-qa/gateway-independent.mjs`。两项产品边界断言失败，非浏览器环境故障。详情 `evidence/phase2/commands/gateway-independent.log`。未发现新的可证实 P0/P1 认证或预算绕过；不能把两项 FAIL 写成全部安全 PASS。

## 集成阻塞与交接

P1 集成阻塞：静态打包审计 exit 1，Docker build/runtime COPY 都未覆盖 `server/ai-abort.mjs`、paid-gateway 的 access/egress/pricing/provider；ledger 作为受控适配器依赖也应纳入完整目录/allowlist。当前不能构建可依赖的集成镜像。Docker owner 实际构建、健康检查、HTTP smoke 证据尚未到位，本机没有 Docker CLI；实际容器测试 BLOCKED。静态审计不能替代镜像运行。

合并建议：Agent A 统一冻结共享入口与 Provider 模型契约；Docker owner 在同一精确组合树修正所需文件打包并给出构建+health+未认证 HTTP 拒绝证据；QA 对新 SHA 先做 blob 差异映射，再补测受影响网关/取消/browser/ZIP；满足门禁后才交 Tech Lead 授权。#42/#44/#45 不应在共享入口不同版本上盲目顺序合并。本 Agent 不处理生产冲突或执行 Merge。

Core 后续离线 gateway-composition 4/4 属开发方提供的信息，尚未绑定本次独立执行 SHA，不计入上述独立结果。新的模型 allowlist 补丁尚未提供可核验精确 SHA，NOT_AVAILABLE；到达后增量验收，不重跑无关整套。

## 命令索引

每条完整参数、退出码、时间、环境和 Git 状态均另存同名 JSON。可信 Fixture、Mock、历史真实响应回放已按上文区分。

| 组 | 实际命令 | 退出码 | 结论 | 持续时间 | 证据 |
|---|---|---:|---|---:|---|
| admission-observer | `node tests/phase2-qa/admission-observer.mjs` | 0 | PASS | 0.192s | [日志](evidence/phase2/commands/admission-observer.log) |
| build | `npm run build` | 0 | PASS | 4.243s | [日志](evidence/phase2/commands/build.log) |
| cancellation-browser | `node tests/generation/cancellation.browser.cjs` | 0 | PASS | 4.641s | [日志](evidence/phase2/commands/cancellation-browser.log) |
| cas | `npm run test:mochi-host` | 0 | PASS | 0.457s | [日志](evidence/phase2/commands/cas.log) |
| docker-audit | `node tests/phase2-core/audit-server-packaging.mjs` | 1 | BLOCKED | 0.203s | [日志](evidence/phase2/commands/docker-audit.log) |
| export-prepare | `node tools/project-zip-export/prepare.mjs` | 0 | PASS | 0.306s | [日志](evidence/phase2/commands/export-prepare.log) |
| focused | `node --test tests/phase2-qa/generation-boundary.test.cjs tests/phase2-qa/mochi-boundary.test.mjs tests/phase2-qa/server-deadline.test.mjs tests/phase2-qa/owner-sequences.test.cjs` | 0 | PASS | 1.200s | [日志](evidence/phase2/commands/focused.log) |
| gateway-independent | `node --test tests/phase2-qa/gateway-independent.mjs` | 1 | FAIL | 0.437s | [日志](evidence/phase2/commands/gateway-independent.log) |
| generation-browser | `npm run test:generation:browser` | 0 | PASS | 7.572s | [日志](evidence/phase2/commands/generation-browser.log) |
| mochi-host-browser | `node tests/mochi/browser.cjs` | 0 | PASS | 16.082s | [日志](evidence/phase2/commands/mochi-host-browser.log) |
| mochi-workshop-browser | `node tests/mochi-ai/workshop-browser.cjs` | 0 | PASS | 30.674s | [日志](evidence/phase2/commands/mochi-workshop-browser.log) |
| pomodoro-browser | `node tests/trusted-pomodoro-ui/browser.cjs` | 0 | PASS | 10.573s | [日志](evidence/phase2/commands/pomodoro-browser.log) |
| pomodoro-races | `node tests/trusted-pomodoro-ui/races.browser.cjs` | 0 | PASS | 4.366s | [日志](evidence/phase2/commands/pomodoro-races.log) |
| pr44-replay-browser | `node tests/phase2-qa/replay44.mjs` | 0 | PASS | 14.823s | [日志](evidence/phase2/commands/pr44-replay-browser.log) |
| pr44-samples | `node --test tests/phase2-qa/real-samples44.test.mjs` | 0 | PASS | 0.284s | [日志](evidence/phase2/commands/pr44-samples.log) |
| pr44-security | `node --test tests/phase2-qa/security44.test.mjs` | 0 | PASS | 3.399s | [日志](evidence/phase2/commands/pr44-security.log) |
| protocol-prepare | `node server/custom-block/build-protocol.mjs` | 0 | PASS | 0.386s | [日志](evidence/phase2/commands/protocol-prepare.log) |
| security | `node --test tests/paid-gateway/security.test.mjs` | 0 | PASS | 3.307s | [日志](evidence/phase2/commands/security.log) |
| server-prepare | `npm --prefix server run build` | 0 | PASS | 0.294s | [日志](evidence/phase2/commands/server-prepare.log) |
| standalone | `node tests/phase2-qa/standalone.mjs` | 0 | PASS | 11.881s | [日志](evidence/phase2/commands/standalone.log) |
| workshop-browser | `npm run test:workshop-export:browser` | 0 | PASS | 4.636s | [日志](evidence/phase2/commands/workshop-browser.log) |
| zip | `node --test tests/project-zip-export/export.test.mjs` | 0 | PASS | 0.515s | [日志](evidence/phase2/commands/zip.log) |

原始生成/取消共用输出目录导致 report.json 后写覆盖；各自独立报告已从各自原始命令日志重建为 generation/generation-report.json 与 cancellation-report.json。现存 trace 同名文件属于后跑取消测试，不能冒充生成 trace；截图名称不同并保留。

文件内容摘要：`evidence/phase2/source-before.json` / `source-after.json`；命令全集：`evidence/phase2/command-index.json`；样本哈希：`evidence/phase2/sample-hashes.json`。源码 tracked diff 为空。
