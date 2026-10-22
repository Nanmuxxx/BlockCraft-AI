# Mochi 主动建议 v1 — 最终验收报告

代码、离线测试、真实 AI 抽样和安全检查已完成，等待人类最终检查。工作分支为 `feat/mochi-proactive-v1-20261022`，基线 `11cc525`。未执行提交、push、部署或远程资源修改；魔塔链接、部署配置和生产默认开关未改动。

## 已实现的行为

获得同意后，项目打开、结构变化和选中状态稳定事件可触发结构化建议。建议具有去重、节流、10 分钟有效期，以及忽略、拒绝、稍后处理和恢复交互。项目上下文或同意状态变化会使旧建议失效。

“接受并预览”只把有效建议交给现有 Host，生成合法 AppChangePlan 并展示实际差异；该步骤不写项目。用户再点击确认后，沿用既有 CAS、权限、目标范围、冲突和幂等校验执行。请求期间、异步返回后、确认前以及同步观察者回调后均复核可信 guard，防止过期、撤权、晚回复或上下文变化绕过校验。非法或不可执行建议安全拒绝，业务记录保留。

v1 支持绑定实体的表单/列表：增加同实体表单或列表积木、增加可选字段、调整显示字段及受支持的展示属性。模型不持有 Runtime、确认或直接提交权限。

## 文件与接口

| 范围 | 主要文件 | 负责人 |
|---|---|---|
| 事件、建议生命周期 | `src/integrations/mochi-ai/client.{mjs,d.mts}`、`workshop.{mjs,d.mts}` | 事件 Agent |
| 建议面板与交互 | `MochiConversationPanel.tsx`、`conversation.css`、`AppSpecWorkshop.tsx` | UI Agent / 总负责 |
| 结构化建议和计划安全 | `server/mochi-ai/provider.mjs`、`server/mochi-plan.mjs`、`planning.ts`、`httpPlanProvider.ts` | Provider Agent |
| Host 最后校验、预算、抽样、集成 | `host.ts`、`server/paid-gateway/{ledger,provider}.mjs`、`tools/mochi-proactive/` | 总负责 |
| 回归与证据 | `tests/mochi-proactive/`、既有相关测试、本文档目录 | 各 Agent / 总负责 |

接口变化：新增可选的 `requestPlan(advice)` 预览桥接、`planningEnabled`、`snooze/resume/reject/refreshSuggestions`；增加本地闭包 `TrustedPlanGuard`；计划请求可选携带 `reservedIds`，仅包含全项目结构 ID，无业务记录。模型/HTTP 无法重建可信 guard。服务端 `modificationsEnabled:false` 仍保留。预算 ledger/transport 可注入可信 pricing/policy/clock，原有默认安全限制保留。完整共享接口与职责见 [PLAN.md](PLAN.md)。

## 测试证据

| 验证 | 结果 | 证据 |
|---|---|---|
| 全部离线 Node 测试清单 | 83 文件；1328 通过，0 失败、0 跳过 | [汇总与完整命令](evidence/offline-tests.json)、[清单](evidence/offline-inventory.json)、[完整 TAP](evidence/offline-tests.tap) |
| 生产构建 | `npm run build`，exit 0 | [build.log](evidence/build.log) |
| 主动建议浏览器 | 1440px / 390px 均通过；项目事件、忽略/拒绝、稍后自动恢复、过期预览拒绝；分析/预览零写入，确认一次写入；无页面错误、无外网请求 | [报告](evidence/proactive-browser.json)、[窄屏预览](evidence/mobile-preview.png) |
| 既有相关浏览器回归 | Mochi 2、field-plans 6、project-json 7、layout-order 2、workshop-presentation 4 个 case 通过 | [命令、版本与结果](evidence/browser-regressions.json) |
| 最终离线抽样 | `node tools/mochi-proactive/sample.cjs --offline --project=reading`，exit 0 | [offline-sample.log](evidence/offline-sample.log) |
| 敏感信息检查 | 最终扫描通过，0 发现；检查范围与文件数见报告 | [security.json](evidence/security.json) |

新增安全测试覆盖 TTL、异步晚回复、撤权/重新同意、项目切换、只读模式、CAS/冲突、危险命令、范围/能力不符、全局 ID 冲突及费用预留失败。全部离线清单包含旧项目和既有 Mochi 测试。浏览器仅声明上表 6 套（含新增主动建议）相关测试通过，不声称运行仓库所有浏览器脚本。

运行环境：macOS 26.6、Node 24.22.0、npm 11.19.1、TypeScript 5.9.3、Vite 8.3.4、Playwright 1.62.1、Chromium 151.0.7922.34。

## 真实 AI 抽样与费用

仅总负责 Agent 在本机执行真实 AI。模型 `deepseek-flash`；依据 [官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 于 2026-10-22 核验的缓存未命中/峰时保守单价计算，输入 2 元 / 百万 token、输出 8 元 / 百万 token。

- 用户上限：5 元 / 100 次；本次采用更严的 1 元预留 / 8 次硬上限。
- 实际 **8 次调用**，全部结算；按 token 估算 **0.024924 元**，累计保守预留 **0.280314 元**。估算不等于供应商账单。
- 持久 ledger 在每次出网前先预留，限制模型、URL、重试和并发；未知用量拒绝继续。8 次额度已用完，本任务不再调用真实 AI。
- 凭据仅在根 Agent 本机进程加载；未要求其他 Agent 访问或传递，也未写入报告。统计见 [AI-USAGE.json](AI-USAGE.json)。

真实例子均使用真实示例 AppSpec、Workshop、Host、Runtime 和 HTTP provider，模型请求基于项目结构；确认动作由验收 harness 在独立第二步模拟。

| 抽样 | 结果 |
|---|---|
| 社团报名 | 建议增加手机号/邮箱，生成新增可选字段和显示字段计划；预览前后 0 写入，重复确认后总共执行 1 次，revision 0→1，记录保留 |
| 读书记录，初次 | Host `INVALID_TARGET` 拒绝，0 写入。代码检查确认候选碰撞全局结构 ID 的拒绝路径；未保留候选，具体 ID 无法确定 |
| 读书记录，第二次 | `FIELD_PLAN_FAILED` 拒绝，0 写入；未保留候选，具体模型失败原因未确定 |
| 读书记录，最终 | 增加可选书名字段，使用未占用 ID `book-title-new`，2 条命令通过校验；预览 0 写入，重复确认后总共执行 1 次，revision 0→1，记录保留 |

完整成功与拒绝历史见 [REAL-SAMPLES.json](REAL-SAMPLES.json)。社团成功样本早于最终 reservedIds / prompt 收紧，读书最终样本在最终实现上通过；最终离线测试同时覆盖表单和列表。两次历史拒绝保留，不能将这组小样本解释为模型成功率保证。

## 排障与安全边界

终端报错按工作区规则保留脱敏命令、错误、退出码和版本，先查官方资料与只读状态再修复。离线依赖缓存缺失、历史测试时钟、投影断言更新见 [离线审计](evidence/offline-audit.md)；浏览器共享 Vite 缓存 504、字体 allowlist 和状态 fixture 问题见 [浏览器排障](evidence/browser-troubleshooting.md)。已复制证据中的最终文件对应为 `offline-tests.json`、`offline-inventory.json` 和 `offline-tests.tap`；早期详细日志仍在本检出的 `.cache/mochi-proactive/`。

真实抽样排障另参考 [DeepSeek JSON mode 官方说明](https://api-docs.deepseek.com/guides/json_mode)。官方检索连接器曾返回 HTTP transport 错误；本机 Python urllib 读取官方文档也曾退出 1，错误类别为 `ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed`（本地证书链不受信任）。该证书问题的具体环境根因未确定；没有关闭证书验证或修改认证设置。后续使用系统 curl 8.7.1 / SecureTransport，以 HTTPS 和正常证书验证读取官方资料成功。未因排障读取凭据。

安全扫描在不输出任何值的进程内，对本机环境文件中敏感配置值做精确比对，并检查常见密钥格式和含凭据 URL；扫描本次修改/新增文本及本任务缓存文本。日志和报告只保留允许的用量、结构诊断与合成示例项目内容。没有 API Key、Token、Secret 或含凭据 URL 发现。

## 剩余限制

- 自定义积木、番茄钟、无实体绑定目标不在 v1 自动计划范围，默认拒绝。
- 模型仍可能提出不可执行方案，由服务端和 Host 安全拒绝；不保证每条建议都可接受。
- `reservedIds` 超过 4096 项或请求超过 64KB 时拒绝，不扩大最小投影范围。
- 面板按 15 秒刷新清理/唤醒；所有动作及确认即时校验有效期。
- AI 服务默认关闭，仅本地显式组合启用。报价有效期为 2026-10-23 00:00（上海时间）；过期不自动续期。生产启用和部署不属于本次变更。
- 当前依赖链接环境下，既有浏览器 runner 共享 Vite 默认缓存，应顺序执行。
- 其他检出内未提交的画廊工作未纳入本任务。

## 人工最终检查

可先阅读真实样本、窄屏截图和测试报告，再运行 `npm run test:mochi-proactive`、`npm run test:mochi-proactive:browser` 或上述离线 sample。离线浏览器 fixture 使用真实 Workshop/Host/Runtime 和模拟 API，不需要凭据或新增费用。

检查建议出现后项目未变化；点击“接受并预览”仍未变化，确认后仅执行一次且记录保留；检查忽略、稍后/恢复和预览过期拒绝。真实抽样证据已经完成，勿重置 ledger 或扩大调用上限来复跑。跨模块集成已由总负责完成，待人类最终验收。
