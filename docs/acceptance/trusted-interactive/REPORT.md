# P0 可信番茄钟最小技术验证

2026-10-18（Asia/Shanghai）。基线 `7e94dc9568501dd4ad218a43b5aca31026aed2b2`。
工作树 `/Users/nanmuxun/BlockAI/BlockCraft-AI-trusted-interactive-p0`；分支 `spike/trusted-interactive-p0-20261018`。

## 结论与当前集成状态

**离线单番茄钟闭环 GO；真实付费 AI 演示及比赛主线集成尚未验收。** 不需要重新开发通用低代码平台。实现限定为模型选择标题和 1–7200 秒整数时长，宿主可信 React 组件执行开始、暂停、续跑、重置和完成反馈。没有运行模型 TSX、JS、HTML、表达式，也没有 eval/动态执行入口。答题器未实现。

目前证明了真实 HTTP / DeepSeek 请求格式与固定模型响应的端到端链路，没有证明真实 DeepSeek 对自然语言需求的生成质量。所有新测试均注入固定离线响应；付费调用数为 0。不能宣传为“AI 自由编写代码”或“真实模型已验收”。

Tech Lead 临时独占协调后，没有再修改 `CustomBlockImport.tsx`、`AppSpecWorkshop.tsx`、`AiCreate.tsx`。前两者相对基线无 Diff。此前 `AiCreate.tsx` 的本地改动保留但不提交，完整补丁只保留于本地 `coordination/AiCreate.pending.patch`（不进入提交或 PR）：引入 generateInteractiveProject；增加 opt-in checkbox；保存并展示 offline-fixture/deepseek 来源。这是待 P1-B Draft PR 后协调的 UI 候选，不是已集成结果。独立验收入口复用未修改的正式 AppSpecWorkshop。

## 架构差异与协议影响

| 链路 | 最小改动与兼容边界 |
| --- | --- |
| AppSpec | v1 所有原有字段、实体、CRUD 积木与每块一个绑定规则保留。v2 才允许 `pomodoro`；该积木没有实体绑定，字段严格为 id/name/type/protocolVersion/durationSeconds。积木 protocolVersion 固定 1；标题 1–120 字；时长整数 1–7200 秒。v1 中出现该类型必拒绝。 |
| Schema | `src/model/trustedInteractive.schema.json` 是首发生成子集（一个番茄钟、无 entities/relations）的公开 JSON Schema；服务器 assertInteractiveSpec 和客户端都对完整 AppSpec 及单番茄钟子集复验。标准 Schema 之外，全局 ID 唯一、引用等语义约束由共享验证器完成。未知字段、脚本/表达式、错误版本/绑定、越界时长均拒绝。 |
| 状态 | 只在 v2 ProjectState/base 中允许可选 timers：`{ [blockId]: { remainingMs, startedAt } }`。完整结构校验覆盖 timer ID、键、数值范围与合法时间戳；模型不能提供状态。没有第二个项目 owner。 |
| Runtime / CAS | timerAction 复用原 mutate → commitBuiltin → CustomProjectSession → owner.compareAndSwap；保持 revision、授权撤销、只读拒绝、订阅、历史边界。保留 CRUD records、自定义 props/state、精确制品版本、布局和 renderOrder。 |
| React | 独立 Pomodoro.tsx；权威时间锚点来自 owner，100ms interval 仅触发重绘，不提交每个 tick。剩余值由时间差计算，暂停落盘当前剩余值；B/C 切换不创建新 Runtime。完成由锚点派生，按钮显示完成；不发消息、不写完成记录。 |
| B / C | 现有画布目录识别番茄钟；Inspector 展示标题/时长/协议和导出限制；正式 C renderer 路由到可信组件。Mochi 可选择/投影其元数据，但 timer 的 AI 修改计划明确拒绝，不制造实体绑定。 |
| 生成 | 继续使用 `/api/ai/generate`；只有显式 `protocol: trusted-interactive/1` 才走新提示词和校验。复用原 DeepSeek endpoint/model/key/fetch、大小、速率、并发、超时限制。legacy 请求仍输出 v1，其模型提示词从共享类型源码投影 v1，不广告 v2 行为。 |
| 权限与付费 | 新协议默认关闭；需服务器可信注入 enabled、批准记录、到期时间、调用上限、resolveAccess、allowedOrigin、持久费用预留适配器。会话必须明确可写；读者/body/env 不能授予权限。预算拒绝、错误、超时及未认证均不会进入 upstream。没有新增无认证端点或 CLI/env 开关。测试专用许可只存在 tests/。 |
| 来源 | 新回复含 protocol/spec/provenance；默认真实 fetch 标记 deepseek，注入 fetch 标记 offline-fixture。Fixture 明确固定 JSON，不根据文本声称真实 AI 推理。旧响应形状不变。 |
| ZIP / #31 | 现有模板不会渲染番茄钟，本轮选择明确拒绝而不扩建导出器。UI、capture、纯 exportProjectZip 都拒绝 v2 (`UNSUPPORTED_APP_SPEC`)，不返回 ZIP。旧 v1 exportProjectState 也禁止 v2 降级 (`LOSSY_EXPORT`)。原 v1 ZIP 产物和安全门禁通过回归。 |
| 隔离 Viewer | 无修改。自定义源码仍是 inert/pending-build，执行拒绝策略保持原样。 |

## 可重复演示与证据

在该独立工作树安装依赖后：

```sh
npm run dev:trusted-fixture
```

打开终端输出的 `http://127.0.0.1:5198/tests/trusted-interactive/index.html`。这是显式离线测试入口：不读 .env，使用固定 25 分钟 JSON，使用服务器内存中的测试许可与假预算适配器，不授予生产权限，不连接 DeepSeek。输入需求后点击“生成可信配置”，在正式 B/C 工坊操作。刷新会清空会话数据；不是后台常驻计时器或持久化服务。

浏览器记录 `browser-results.json`：Chromium 151.0.7922.34；桌面 1440×1000、手机 390×844；两个视口分别验证生成配置、B Inspector、C 开始/暂停/续跑/重置/完成、B/C 锚点和 revision 保持、失败生成保留 owner、明确拒绝 ZIP、计时器适配宽度。8 次 Fixture 请求、0 次付费请求、0 pageErrors。完成行为用合法的独立 1 秒配置检验。手机为 Chromium 手机视口，并非真实 iPhone/Safari 实机。

- `desktop-b.png` / `mobile-b.png`：正式 B 画布与番茄钟配置。
- `desktop-c-running.png` / `mobile-c-running.png`：真实点击后运行中的可信计时器。
- `legacy-generation-browser.log.txt`：原 7 类 CRUD 应用、B 属性/C 数据编辑、删除、5 类失败保留旧应用及重试；13 次真实本地 HTTP、0 次付费。
- `legacy-export-browser.log.txt`：旧 ZIP 桌面/手机、下载、拒绝路径和生产预览边界；errors 为空。
- `legacy-mochi-browser.json`：旧 Mochi 桌面/手机真实 Workshop，取消/过期/重复确认/拖拽/记录/只读/权限场景；errors 为空。

## 验证与已有测试的调整

生产 build 成功。测试共 651 项通过：基础 192、原 server 23、generation 24、Mochi host 55、Mochi AI 40、CustomBlock/B-C/Workshop/制品/ZIP 306、本轮新增 11。详见 `validation-results.json`。

旧“version=2 必拒绝”测试升级为“version=3 必拒绝”，新增 v1+timer 必拒绝与 v2 严格字段校验；能力目录断言加入实际实现的 pomodoro。没有删除原 CRUD/权限/CAS/ZIP 断言。

两个已有浏览器 harness 已落后于主线：generation 仍定位旧“功能积木画布”，现改为正式 v2 画布名称并允许 worktree 依赖真实路径；mochi 的 configFile:false 未加载 #31 虚拟导出模块，现补入同一现有插件（默认无导出授权）。这些只修测试环境接线，不改变生产门禁。

可执行验证命令：

```sh
npm run test:trusted-interactive
npm run build
# 如 Playwright 不在本项目依赖中，按已有仓库约定通过 NODE_PATH 提供。
npm run test:trusted-interactive:browser
npm test
npm --prefix server test
npm run test:generation
npm run test:mochi-host
```

## 比赛前是否建议集成

建议在 P1-B Draft PR 后做小范围集成评审：优先合入独立协议、可信组件、验证和拒绝导出的安全边界，统一处理 AiCreate 入口，不直接覆盖三份临时独占文件。只集成番茄钟，不扩大为答题器/表达式/任意源码执行平台。

当前不建议把它宣布为已完成的真实 AI 演示。尚需：P1-B 协调后统一 UI Diff、主线全量回归、部署方可信访问与持久预算适配器配置，以及 Tech Lead 单独批准真实付费请求之后的一次真实需求→配置→B/C 验收。没有自动合并、部署、付费请求或密钥提交。
