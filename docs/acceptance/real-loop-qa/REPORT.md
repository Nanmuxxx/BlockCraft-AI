# 真实 AI 生成闭环：独立离线 E2E 验收

2026-10-19，Asia/Shanghai。**离线兼容性 VERIFIED / GO；实时模型生成 NOT TESTED；生产闭环 BLOCKED / NO-GO。**

## 版本和来源

- 指定基线 8cfa37f5112adaab1e0adbb4cb4086240111d436；开始前通过 git ls-remote 核实。
- 期间 main 推进至 4a95cae50f772cd242d932cdbd93366381d1df74，仅增加 supervisor 三个文件；在第二个独立 checkout 重跑同一统一入口，全部通过，证据在 latest-main/。
- PR #44 来源 HEAD aa7766615e0b6bddfe9c72a6f1709a302d3629ca。source-pr44/ 的四份 JSON 逐字节复制自 PR Git 对象；两份 response 的 SHA-256 与历史 live-browser 审计一致。
- todo SHA-256：1dbe4fc23b93d5f7075e311350eea12d1dafb884f0c831e9cd2ea7ba5d972de2。
- club SHA-256：348bb62c3c24ad87029b40e3390a0a870c2a6925aef80ce517b96cd74da1ca14。
- source-pr44/live-browser.json 是历史审计，不能把其中 live=true 作为本轮 live 测试。本轮真实模型调用始终为 0，没有生产密钥、合并或部署。
- 原始日志/exit code/时间/完整 SHA：commands.json 和 latest-main/commands.json。浏览器：browser-report.json。截图索引：SCREENSHOTS.md。
- AI Core 新 PR 精确 HEAD 尚待负责人提供；不对其未验收代码作通过声明。

## 场景矩阵

| 场景 | 来源 | 实体/字段 | 积木统计 | 1440×900 | 390×844 | ZIP独立构建 |
|---|---|---|---|---|---|---|
| 任务 todo | PR44 历史真实响应回放 | task：标题text、日期date、完成boolean | Form/List/count | PASS | PASS | PASS |
| 社团 club | PR44 历史真实响应回放 | applicant：姓名text、部门select、面试boolean | Form/List/count | PASS | PASS | PASS |
| 健身 fitness-log | 手写Fixture | sessions：日期、动作、分钟number | List/sum/average | PASS | PASS | PASS |
| 学习 learning | 仓库阅读记录Fixture | books/reading-sessions：书目、状态、日期、分钟、摘记 | 2 List/Form/sum | PASS | PASS | PASS |
| 记账 money-app | 手写Fixture | income/expenses：各自日期、金额、备注 | 2 List/2 sum | PASS | PASS | PASS |

真实本地 HTTP /api/ai/generate + Vite proxy，只有上游 fetch 注入，绝不使用原生 Provider。服务器解析 completion envelope，验证 AppSpec 与可操作完整性；客户端验证 ProjectState；进入正式 /ai-create Workshop。每实体在 B 选择列表积木，新增可选字段“验收扩展”并配置展示；C 新增、查看、编辑、删除，数字从 12 改为 24，count/sum/average 按实际记录独立计算断言。学习/记账覆盖两个实体。每实体 B/C 反复切换三次，字段与记录保留。

## 失败矩阵（每场景、每视口）

| 故障 | HTTP / code | 记录及配置 | 证据边界 |
|---|---|---|---|
| 上游503 | 502 AI_UNAVAILABLE | 保留 | 注入上游失败 |
| 非法version999 | 502 AI_INVALID_SPEC | 保留 | 真实校验器 |
| 上游Promise不返回 | 504 AI_TIMEOUT | 保留 | 测试服务端期限500ms |
| 未授权 | 401 UNAUTHORIZED | 保留，Provider调用数不增加 | access seam返回false |
| Provider抛预算耗尽 | 502 AI_INVALID_RESPONSE | 保留 | 仅异常传播；不是实际账本联合测试 |

取消/迟到/卸载：额外运行现有 cancellation.browser.cjs，验证取消保留记录、旧结果不能替换新项目、晚到拒绝被消费、导航取消。证据 cancellation/；该旧脚本视口为1366×900及390×900，不能冒称目标视口证据。主矩阵视口为1440×900和390×844。

成功重生成：表单明示“成功创建后会替换当前应用；失败或取消保留原应用和数据”，只有用户显式点击生成并成功后替换。没有二次确认/项目历史恢复，不能声称成功替换也保留旧项目。刷新不持久化，UI明示刷新清空。失败和取消的保留均已实际验证。

## 测试及环境

Node v24.22.0；Playwright 1.64.1；Chromium 156.0.8078.4；macOS arm64。两个SHA的统一命令均通过：

| 命令 | 结果 |
|---|---|
| npm test | 205/205 |
| npm run test:generation | 34/34 |
| client-boundary.test.cjs | 11/11 |
| npm run test:workshop-export | 9/9 |
| paid-gateway security/model/audit | 20/20，合成临时账本及Mock |
| npm run build | exit 0 |
| real-loop.browser.cjs | 10/10场景，50次本地注入Provider，0真实调用 |
| real-loop-zip-build.mjs | 五样本实际UI下载ZIP，仓库外独立npm ci/tsc/Vite，5/5 |

每轮28张截图，fullPage文件高度会大于上下文视口。初始缺typescript、harness定位器调整、并发端口冲突是setup问题；最终串行统一入口全部exit 0，端口失败原始日志在latest-main/port-collision.txt。所有最终日志可下载，不把前轮失败改写为产品缺陷。

ZIP：真实受控loopback local-export UI下载；独立ZIP reader检查CRC和central directory，断言当前编辑记录/字段/版本保留。所有可执行/config文件逐字节匹配仓库固定builtin导出模板，只有JSON数据/provenance/README可变化，再在仓库外安装并构建。无模型TSX执行。zip-sample-builds.json保存命令及输出；十份桌面/手机ZIP留存。额外现有Workshop export浏览器及固定builtin/reading/mixed仓库外dev/production runtime已通过，日志见export-browser.txt及zip-independent-build.txt。AppSpec v2、非空宿主状态等不受支持，不能声称任意ZIP可构建。

## 缺陷/阻塞及复现

### P0-01 BLOCKED：实时生成完整证据缺失

只有离线注入，没有安全调用许可，也没有Core唯一远端精确候选。生产可信身份、持久预算与部署组合未被本轮验收。离线PASS不解除实时闭环NO-GO。此条是发布验收阻塞，不宣称代码漏洞。

### P2-01 VERIFIED：390px记账表格可读性

复现统一入口，查看money-app-income-390-c.png及money-app-expenses-390-c.png。扩展字段后，日期/中文列名逐字折行，金额标签纵向排列。CRUD仍可用，未发现数据丢失。建议Workshop owner单独调整小屏表格最小列宽/滚动；QA不改产品。

### P2-02 VERIFIED（main）：预算code被泛化，Core新HEAD待复验

复现mode=budget注入Provider抛BUDGET_EXHAUSTED，main的v1 route归为502 AI_INVALID_RESPONSE，记录保留。browser-report.json保存每场景HTTP/code。不能据此宣称实际ledger与HTTP组合通过。Core/Gateway应提供精确候选验证503 BUDGET_EXHAUSTED、504 AI_TIMEOUT与真实临时账本的reserve/settle/halt/锁生命周期。Gateway在#57称本地候选已处理，QA尚未独立验证，不代签。

### 信息：PR44工具与main不同

main未包含tools/real-deepseek/evaluate.mjs，直接运行PR的REUSE命令会MODULE_NOT_FOUND；工具在PR44存在。先前“PR缺脚本”的口头判断已纠正。此次补丁自带最小入口和原样样本，不依赖旧Provider分支。

## 复现步骤

1. 在目标精确SHA独立checkout安装锁文件依赖：npm ci。
2. 单独准备Playwright（不改产品manifest）：npm install --prefix /tmp/blockcraft-qa-browser --no-save playwright@1.64.1。
3. 安装匹配Chromium：/tmp/blockcraft-qa-browser/node_modules/.bin/playwright install chromium。
4. 运行：NODE_PATH=/tmp/blockcraft-qa-browser/node_modules node tests/generation/real-loop-qa.cjs。
5. 打开docs/acceptance/real-loop-qa/commands.json、browser-report.json和SCREENSHOTS.md。

只串行运行入口，固定loopback端口5195；占用时应失败。可设GENERATION_QA_OUTPUT分离证据目录、PLAYWRIGHT_CHROMIUM_EXECUTABLE指定匹配浏览器。依赖下载涉及npm网络，绝不涉及模型调用。每阶段失败即停并记录exit code。

## 后续与权限

已ACK #57 Supervisor DECISION 6268988241。只拥有tests/generation/real-loop*与docs/acceptance/real-loop-qa/**，不改src/server。下一阶段待Core唯一远端HEAD：独立checkout重跑同入口，并新增实际合成临时ledger的503/504、reserve/settle/halt、断连与关闭联合测试，不能继续只注入预算异常。Gallery #55验收由Workshop负责，本报告不代签其选择/确认/取消流程。

通过只证明受测版本可消费这些AppSpec，不证明模型语义理解、新请求生成成功率或供应商在线可用性。没有接通本QA会话的自动轮询/唤醒；正常任务边界主动检查#57并[REPORT]，不承诺后台无人值守。合并、部署、付费、真实账本/密钥/权限变更均未授权也未执行。
