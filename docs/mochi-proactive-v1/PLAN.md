# Mochi 主动建议 v1 — 共享计划与接口

## 基线和边界
- 工作目录：`BlockCraft-AI-mochi-proactive-v1-20261022`；分支 `feat/mochi-proactive-v1-20261022`。
- 基线：`11cc525`，包含已提交的 Mochi 字段计划、布局和项目 JSON roundtrip。旧主检出 `bed79e2` 不是当前功能基线。
- `BlockCraft-AI-project-json-20261022` 存在其他任务的未提交画廊/展示改动，本任务不复制、不覆盖。最终报告注明这条集成边界。
- 不修改部署配置、魔塔链接、生产环境或远程资源；不 push、不部署。

## 流程与接口（冻结 v1）
1. `createWorkshopMochiConversation` 监听可信 Host 的 project-opened / structure-changed / selection-settled；主动分析必须启用并获得 consent。
2. 模型回复继续使用现有 Advice 协议；模型输出无 Runtime、scope 或 confirm 权限。
3. 客户端持有创建/过期时间与稍后处理状态；项目实例、revision、结构或模式变化使旧建议失效；选择变化的兼容行为要保留。
4. `createMochiConversation` 可选接收 `requestPlan(advice)`，`requestModification(id): Promise<unknown>` 仅请求预览。未提供回调时维持默认拒绝。新增 `snooze(id)`、`resume(id)`、`reject(id)`；`deferredSuggestions` 单独显示，`refreshSuggestions()` 清理过期并唤醒到期项。`planningEnabled` 表示本地桥接存在，服务端 `modificationsEnabled:false` 保留，绝不代表允许直接提交。
5. Workshop 桥接仅把仍有效、kind=design-change、requiresUserAction、存在且支持的 blockId 对应建议交给既有 Host `callbacks.onRequestPlan`。允许因本次定位改变 selection；其他同步上下文改变拒绝。不调用 `onConfirm`。
6. `TrustedPlanGuard` 是可信闭包，只在本地桥接传递；Host 在请求、异步返回、确认及同步观察者之后复查 TTL、项目上下文与同意状态。不能由 HTTP/模型 JSON 重建。
7. 接受建议按钮文案“接受并预览”；Host 原有预览显示真实 diff，用户第二次点击确认才提交；沿用 CAS、授权、冲突、记录保留校验。
8. 服务端表单/列表计划允许现有安全命令增加 form/list 积木、可选字段、显示字段和展示属性；按实际执行能力验证，不扩大 Runtime 权限。计划请求新增可选 `reservedIds`（全项目结构 ID、上限 4096，无记录或其他积木详情），在模型与服务端提前避免全局冲突；Host 仍独立校验。

## 文件归属和状态
| 负责人 | 独占文件 | 状态 |
|---|---|---|
| 事件/生命周期 Agent | `src/integrations/mochi-ai/client.{mjs,d.mts}`、`workshop.{mjs,d.mts}`、`tests/mochi-proactive/lifecycle.test.mjs` | 已完成并通过回归 |
| UI Agent | `MochiConversationPanel.tsx`、`conversation.css`、`tests/mochi-proactive/{fixture.tsx,browser.cjs,ui.test.*}` | 已完成并通过回归 |
| Provider/安全 Agent | `server/mochi-plan.mjs`、`server/mochi-ai/provider.mjs`、`src/integrations/mochi/planning.ts`、`tests/mochi-proactive/provider.test.mjs` | 已完成并通过回归 |
| 总负责 Agent | 本文档、真实调用 ledger/runner、本地 server composition、集成与回归、必要 Host 过期保护 | 已完成；等待人类最终验收 |

所有 Agent 完成时提供文件、命令、结果、未解风险、接口变化。Agent 直接沟通接口与阻塞；仅总负责 Agent 可做真实 AI 调用，禁止访问任何凭据或执行外部写入。

## 验收
- 真实结构事件产生合法结构化建议；去重、节流、过期、ignore/reject/snooze/resume 生效。
- 请求建议、接受、预览均不写项目；只有用户确认后合法 AppChangePlan 执行一次，records 保留。
- 非法目标/命令、过期、上下文变更、CAS 冲突、只读/授权改变拒绝。
- form/list 增加积木与修改字段至少经离线集成验证；旧项目、原 Mochi、JSON roundtrip 回归。
- build、既有离线测试、新安全测试及桌面/窄屏浏览器交互通过；真实 AI 主动建议→预览→确认抽样通过。
- 真实调用总上限 100 次 / CNY 5；实际采用更严的少量采样与预留上界，先写 ledger 再出网，失败不重试，未知费用立即停止。

## 风险
- 本地旧费用批准/定价已过期，必须核验官方现价并使用本任务独立授权 ledger，不能复用过期批准或绕过控制。
- Mochi advice 服务与 plan 服务默认关闭；仅本地显式 composition 启用，不更改部署默认。
- 自定义积木、番茄钟、无绑定目标 v1 默认拒绝自动计划；保留说明和定位。
- 模型建议可能不可执行，最终结构及权限校验在既有 planner/Host；不得降级为直接 command dispatch。
- 用户切换/撤权、snooze、TTL、异步晚回复、预览后过期必须可拒绝。
- 本地新画廊等未提交工作不包含在本任务基线。

## 终端排障记录
- 初次在容器目录执行 `git status --short`，exit 128，完整错误 `fatal: not a git repository (or any of the parent directories): .git`。Git 2.50.1 (Apple Git-155)，macOS 26.6。确认仓库位于子目录；用正确 workdir 只读检查成功。[官方 Git 目录发现与 -C 文档](https://git-scm.com/docs/git/2.45.1.html)。
- 探索中列举不存在的 `src/domain`、`tsconfig.app.json`、检出内 `reports` 得到 rg/cat exit 2/1；已改为实际文件清单，不是构建或业务失败。

## 完成记录
- 最终离线 83 文件、1328/1328 通过；生产 build 通过；相关 6 套浏览器回归通过。
- 真实调用 8 次、估算 CNY 0.024924、累计保守预留 CNY 0.280314；两个示例项目各有端到端成功记录，两次安全拒绝历史已保留。
- 代码与证据已在本分支整合，见 [最终验收报告](ACCEPTANCE.md)。没有部署、push 或远程资源修改。
