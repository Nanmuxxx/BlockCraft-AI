# NIGHT AGENT A — AI 核心阶段报告

阶段检查点：2026-10-19 02:30 左右（Asia/Shanghai），持续开发中。约 01:48 开始；尚未经过六小时，不将本检查点称为完整六小时成果。

## 1. 实际完成的功能

- 恢复并核对 v1 AppSpec、trusted-interactive v2、生成服务、Artifact Installer、CustomBlock、Mochi、Runtime owner/CAS 的真实状态，详见 [差距矩阵](AI-CORE-GAP-MATRIX.md)。
- 生成客户端限制响应字节、严格 UTF-8、截止时间和主动取消；v1/v2 响应边界及来源分别验证，保留 #39 离线来源说明。
- 生成、Mochi、CustomBlock Provider 拒绝错误/工具调用/截断等非预期 completion 包络；取消不再依赖上游遵守 AbortSignal，迟到响应体被释放。
- 实际本机 HTTP 服务 Fixture → 客户端严格验证 → 原有 Runtime → Mochi 预览/确认/CAS → B/C 同一项目状态。编辑案例为受控表单增加可选备注字段；没有声称按钮任意样式或任意 TSX 编辑已完成。
- 新增选中上下文模型计划适配器：限制出站 UTF-8 JSON，排除业务记录、完整快照与授权；保留现有 Host/Planner/确认/CAS。正式修改入口仍禁用，没有隐式联网。
- Mochi 源码计划在 provider、注册表和全项目验证等待期间可及时取消；修复同步 abort 重入对新请求所有权的干扰，历史不被迟到请求覆盖。
- Mochi 建议服务取消后释放并发；可信交互鉴权/费用准入有截止时间，并响应断连。客户端响应流、严格解码及会话取消/重入另有复现回归。
- CustomBlock 参数、重新安装、布局与 B/C 往返经过正式页面桌面/移动视口验证；pending-build 和 execution denied 保留。

## 2. Diff 与 Commit

- 基线 main：`4044fb185a2720eead0dc6710b0d38a215439b98`。HTTPS fetch 已尝试但凭据不可用；通过连接的 GitHub 工具核对 main SHA，未声称 fetch 成功。
- 分支：`agent-a/ai-core-night-20261019`；隔离 worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-agent-a`。
- 本地精确提交列表：[LOCAL-COMMITS.txt](docs/agent-a-night/LOCAL-COMMITS.txt)。运行 `git diff --stat 4044fb1...HEAD`、`git diff 4044fb1...HEAD` 审查代码变化。
- 首次发布的 16 个远端提交与本地文件树逐一校验一致；Git-data API 创建导致提交 SHA 不同，[COMMIT-MAPPING.json](docs/agent-a-night/COMMIT-MAPPING.json) 保留对照。后续提交持续同步，不能把未同步的本地 HEAD 说成远端 HEAD。
- 最近独立提交：`5ac2d22`（源码注册表取消）、`49627e8`（建议客户端传输/UTF-8）、`baeffb1`（会话取消与重入）。

## 3. Draft PR

[PR #40](https://github.com/Nanmuxxx/BlockCraft-AI/pull/40)，保持 Draft。禁止合并与部署；本任务均未执行。

## 4. 测试命令及退出码

逐条命令、参数、退出码和原始日志见 [TEST-COMMANDS.md](docs/agent-a-night/TEST-COMMANDS.md) 与 [commands.jsonl](docs/agent-a-night/logs/commands.jsonl)。保留修复前失败，没有删除失败证据或关闭校验。

本检查点最近结果：源码规划 39/39；建议客户端/会话/Workshop 25/25；安装与源码 63/63；HTTP/服务 23/23；扩展核心回归 622/622；生产构建退出码 0。此前完整核心回归 568/568、安全/编译/质量 187/187、默认 npm test 192/192。它们覆盖的是各记录当时的代码，不能相加为最新一次全量通过数；后续修改仍按相关回归验证。

## 5. 真实模型调用

**REAL_MODEL_CALLS=0**。所有本次服务测试显式注入固定离线 Fixture；归档 Artifact 的历史 deepseek 来源不是本次调用。未读取生产密钥，未执行付费模型调用。

## 6. 浏览器证据

[browser 目录](docs/agent-a-night/browser) 含各次报告；[文件大小及 SHA-256 清单](docs/agent-a-night/browser-inventory.json) 对应本地截图/报告。覆盖正式 `/ai-create`、可信离线入口、生成 Fixture、安装/替换竞态、CustomBlock Workshop、Mochi 模型计划 Fixture 与只读建议。桌面宽 1366、移动宽 390；移动为 Chromium 视口/触摸模拟，不冒充真机。

`mochi-model-final` 和 `mochi-advice-final` 两次复跑退出码 0。建议客户端修改后正式页面首次并发运行在初始输入框超时，串行重跑通过（browser-advice-client-retry）；不能将缓存竞争猜测当作已确认根因。部分历史报告含脚本原有旧 baseline 字段，不能据此宣称最新 HEAD 已验证。

## 7. 新发现的问题

- AbortSignal 不是取消完成保证：fetch、响应流、provider、注册表及费用/鉴权适配器可能忽略它。已对可撤销的请求等待补上竞态退出和迟到错误消费。
- abort 监听器同步重入可损坏新请求所有权；已分别修复源码计划和建议会话，并保留失败复现。
- 默认 UTF-8 替换解码会接受损坏 JSON 字符串；相关边界已改为 fatal 解码。
- v1 质量评估曾因共用支持 v2 的 schema 接受 v2，现明确拒绝。
- 确认安装期间的短租约仍需保持原子性；不以提前解锁规避 CAS。版本历史长期保留可能增长，需要另行设计保留策略。

## 8. 下一阶段最有价值的工作

Artifact prepare取消已在a0c8eec完成；继续审计文件读取与参数持久化边界，完善生产页面回归证据。随后按[接口契约](docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md)接入具有可信鉴权、持久预算、明确用户确认的生产修改接口；真实模型语义验收须另获付费授权。

## 9. 其他 Agent 配合

- Agent B 负责 React ZIP 模板/导出器，本分支不修改其文件；参数/版本导出需按接口契约共同验收。
- Viewer/隔离后端需要独立安全验收；本任务不执行不可信 TSX、不跳过 Viewer。
- PR #35 Docker、#36 Mochi Host 测试文件均避开；部署、冻结视频与商业材料均未修改。

## 10. 产品真实 AI 闭环判断

受控 AppSpec 的服务协议、验证、项目创建、B 模式编辑和确认式修改已经有离线端到端证据。生产 DeepSeek 语义生成尚未在本次验证；正式 Mochi 修改接口未启用；任意 TSX 的安全隔离运行与独立 ZIP 闭环未完成。CustomBlock 只到受验证的 pending-build 数据安装。该判断以可观察行为划分，不给出主观完成百分比。

最新同步：本地 `031eac6b301292bc8379106916eaf715af2a4f80` 与远端 `a638a31df15ccde8562807682244959380843ed9` 的树均为 `dea84c657f92973c2acfdd6db7455f9898362290`。本报告后续文档提交另行同步。
