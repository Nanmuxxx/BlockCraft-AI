# AI 生成质量离线验收

目标：让不同需求产生不同的业务数据模型，避免只改应用标题，或用表单、列表名称冒充未实现的行为。此目录不调用 DeepSeek，不读取密钥，不修改 Onboarding、模型、服务端或业务组件。

## 文件与接入

- `cases.cjs`：5 条完整自然语言需求；业务对象、字段别名、类型、必填要求、单选选项；模块及绑定要求；操作数据与统计期望；已支持/待支持能力及降级方式。
- `fixtures/*.json`：5 个静态合法 **AppSpec v1 根对象**，共 9 个实体、39 个字段、26 个积木（18 个表单/列表、8 个统计）。仅用于离线验收，不是正式生成器、关键词生成逻辑或生产降级结果。不包含额外验收元数据或假业务记录，可直接交给 `initializeGeneratedProject()`。
- `evaluate.cjs`：可复用的结构、业务覆盖与跨案例同质化检查器。
- `quality.test.cjs`：合法/变体/错误响应、缺失业务对象、空模型、错误引用、字段及模块退化、能力冒充、同质化、离线 CLI。
- `business.test.cjs`：9 个实体的真实 Runtime CRUD、输入边界、统计联动、失败原子性；5 个 v1 能力限制复现。
- `model.cjs`：沿用项目现有测试方式，在内存中编译 TypeScript，复用真实校验器、生成结果初始化器及 Runtime；不复制 schema，也不生成服务端编译文件。
- `check.cjs`：仅检查本地文件并输出 JSON 报告，成功退出 0，失败退出 1。

在已安装项目依赖的仓库根目录运行：

```sh
# 只跑本目录
node --test tests/ai-quality/quality.test.cjs tests/ai-quality/business.test.cjs

# 通过现有 npm test 接入，追加文件即可，无需改 package.json
npm test -- tests/ai-quality/quality.test.cjs tests/ai-quality/business.test.cjs

# 验收随附参考模型
node tests/ai-quality/check.cjs

# 验收主 Codex 已保存的输出（不会自动生成或调用接口）
node tests/ai-quality/check.cjs /absolute/path/to/local-outputs
```

输出目录需有 `club-registration.json`、`fitness-plan.json`、`reading-log.json`、`event-registration.json`、`personal-tasks.json`，分别保存对应 `cases.cjs` 提示词的一次 AppSpec 输出。缺文件、坏 JSON 或根对象错误均失败；不允许只提交部分案例取得全绿。可以检查历史捕获或本地 stub 的结果，本轮没有采集付费模型输出。

**默认的裸 `npm test` 不会自动发现本目录**：项目脚本目前显式列举测试文件。主 Codex 可使用上面的追加命令接入 CI；如需永久接入，可另行把这两个文件路径追加到原有 `scripts.test`，保留开发中的其他测试路径。本任务按目录限制没有修改 `package.json`。

本次在独立 worktree 使用原有 lockfile 安装依赖并验证，无需额外的 npm 包或 `NODE_PATH`：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm test -- tests/ai-quality/quality.test.cjs tests/ai-quality/business.test.cjs
npm run build
git diff --check
```

只有现有 devDependency `typescript`，无新增依赖。两个测试进程默认把 `fetch` 替换为抛错函数；生成适配器用例只在测试作用域提供本地响应 mock，断言请求文本及语义结果，不连接真实接口。CLI 不导入或启动 server，不使用 `.env`。

## 五类需求的验收设计

完整提示词、各项字段要求和操作数据以 `cases.cjs` 为准。以下 `?` 表示可选；其余字段要求必填。跨实体重复出现的名称字段是独立文本，绝不是外键。

| 需求 | 必要实体与字段 | v1 模块与具体操作 | 待支持能力 |
| --- | --- | --- | --- |
| 社团报名 | 报名者：姓名 text、意向部门 select、联系方式 text、可参加面试 boolean? | 报名表、名单、报名记录 count；新增两人，修改联系方式/面试标记，删除误报名，计数 2→2→1 | 审核工作流、联系方式唯一约束、自动面试通知 |
| 健身计划 | 动作资料：动作名称 text、肌群 select、动作说明 text?；训练计划：计划日期 date、动作名称 text、目标组数 number、每组次数 number、是否完成 boolean?；训练记录：训练日期 date、动作名称 text、实际组数 number、每组次数 number、训练分钟 number | 每实体表单和列表；手动维护动作、计划及完成标记，录入/修正/删除实际记录；分钟 sum 50→60→40、average 25→30→40 | 动作关联、自动编排、训练计时器、日历、完成率 |
| 阅读记录 | 书目：书名 text、作者 text?、阅读状态 select；阅读流水：书名 text、阅读日期 date、阅读分钟 number、摘记 text? | 书架维护与流水录入/编辑/删除；分钟 sum 45→55→40、average 22.5→27.5→40 | 书架关联、自动阅读进度、连续阅读天数 |
| 活动报名 | 活动资料：活动名称 text、活动日期 date、地点 text、参考名额 number?；活动报名：活动名称 text、参与者姓名 text、联系方式 text、报名票数 number、是否签到 boolean? | 活动和报名各有表单/列表；改地点、改票数、手动编辑签到标记、删除误报名；记录 count 2→2→1、票数 sum 3→4→3 | 活动关联、按活动条件统计、名额控制/候补、扫码签到、收款 |
| 个人任务管理 | 任务：任务名称 text、截止日期 date、优先级 select、任务状态 select、预计分钟 number?、备注 text? | 任务表单、清单、全部记录 count；新增、改状态和截止日期、删除；计数 2→2→1 | 提醒、周期任务、看板拖拽/逐项勾选、完成率、待办数量 |

选择项涵盖部门“宣传部/策划部/技术部”、肌群“上肢/下肢/核心”、书目“想读/在读/读完”、任务优先级“低/中/高”及状态“待办/进行中/已完成”。允许已列明的同义选项和额外选项，不能遗漏基本业务状态。

## 自动化通过条件

1. 用当前 `assertAppSpec()` 校验精确协议、全局 ID 唯一性、每积木恰好一个有效绑定、字段归属、表单包含所有必填项、统计只使用本实体数字字段。任何协议错误返回 `INVALID_SPEC`。
2. 在 schema 之外拒绝零实体、零积木、零字段的实体，以及只有统计或完全没有可用入口的实体。初始 **记录为空合法且必须接受**，不能与空业务模型混淆。
3. 按业务名称别名匹配唯一实体与字段，检查字段类型、必要必填项、单选选项和模块暴露字段；必须有对应实体的表单、列表与要求的统计，不能给错实体或数字字段配一个“看起来正确”的指标。
4. 每个实体的两个样例经过真实 `parseFieldDraft()` 和 Runtime 创建；检查列表字段有值；更新首条、删除第二条，验证记录、revision 和聚合数值；清空后统计为 0。缺必填、错误类型、无效日期及非法单选值应失败且原快照不变。
5. 两两比较业务指纹，忽略全部 ID、应用/实体/积木标题、数组顺序和模块配置；保留实体分组、实际字段名/类型/必填/单选选项。相同实体字段只改标题、重新生成 ID 或增减积木，返回 `HOMOGENEOUS_RESULTS`。五个参考模型 10 对组合均不同。
6. 将每个案例模型换到其余四类需求中，20 次交叉替换全部必须失败。字段仅改成通用“描述”、必要实体/模块移除、可选业务字段藏在 schema 中而无表单/列表入口，也必须失败。
7. 积木名称声称计时器、训练日历、完成率、连续打卡、去重人数、扫码签到、名额限制等，返回 `UNSUPPORTED_CLAIM`。这是明确词模式检查；不把积木标题当成行为证据。

不会对真实模型输出做整份 JSON 快照相等断言：合法的不同 ID、标题、顺序、已列别名、额外合法字段/模块、单选扩展都可通过。测试中的 `deepEqual` 只用于本地 CRUD 的数据保持和输入转换，不用于固定生成结果。

## 主 Codex 使用 Fixture

```js
// 当前仓库已有 TypeScript 构建/测试环境时，也可以直接导入实际模型模块。
const { cases, loadFixture, evaluateSpec } = require('./tests/ai-quality/evaluate.cjs')
const { initializeGeneratedProject, createAppRuntime } = require('./tests/ai-quality/model.cjs')
const contract = cases.find(item => item.id === 'fitness-plan')
const spec = loadFixture(contract.id)
const report = evaluateSpec(spec, contract)
if (!report.ok) throw new Error(JSON.stringify(report.errors))
const runtime = createAppRuntime(initializeGeneratedProject(spec))
// runtime 可作为能力目录/修改计划引擎的已有实体输入。
// AppSpec 本体不带 pending、supported、scenario 等验收属性。
```

目录可整体移植到修改计划引擎分支；只引用当前已存在的 AppSpec/Runtime/初始化器，不依赖尚在开发的能力目录，也不修改 Onboarding。健身计划 Fixture 已有动作、计划和训练实体，适用于“只允许修改已有实体”的计划引擎。

## 本轮结果与发现的生成质量风险

2026-10-18，基于 `e26f007` 的 AppSpec v1：裸 `npm test` **92/92 通过**，显式追加本目录两个测试文件后 **175/175 通过**（新增 **83 项**）；无 skip/todo，`npm run build` 与 diff 空白检查通过，无付费 AI 调用。CLI 对五个参考 Fixture 通过，对坏 JSON/缺文件返回失败。此结果证明参考模型及离线门禁可用，**未测真实 DeepSeek 输出的通过率、稳定性或页面交互**；CRUD 在真实 Runtime 中验证，未声称浏览器 E2E 已验收。以上数量属于该分支基线，目标 main 后续合入的其他测试不计入本次结果。

| 风险 | 当前证据 | 对生成/产品说明的要求 |
| --- | --- | --- |
| 协议合法但空应用 | `assertAppSpec()` 可接受零实体、零积木或空字段实体加 count；质量层额外拒绝 | 生成成功不能只看 schema 通过 |
| 同质化/字段装饰 | 同模板换标题/ID、同字段增加列表、隐藏业务字段均被负例拒绝 | 同时检查业务对象、可操作字段和跨案例差异 |
| 泛型统计冒充业务指标 | 重复联系方式两条计数 2；已完成任务依然计数 1；同日阅读可存多条 | count 只能叫记录数，不能叫去重人数、连续天数或待办数 |
| 缺少范围和整数约束 | 训练分钟 -10 被 Runtime 接受且进入 sum | 不能承诺正数、整数票数或合理组次等规则已自动校验；仅 number 类型合法不足以保证业务合理 |
| 缺少实体关联及约束 | 无书目也可写入该书阅读记录；参考名额 1 可报名 100 票 | 说明文本重复录入和人工核对的降级方式，不能声称外键/联动/限额已实现 |
| 能力过度承诺 | 合法 list 改名“训练计时器”仍能过 schema，但被质量层拦截 | 待支持能力应在宿主说明中披露，不能增加未知 AppSpec 属性或假积木 |
| 有限语义识别 | 名称使用可维护别名集合，未调用第二个 AI 做裁判；指纹为确定性字段比较 | 合理但未列出的新同义词/重组模型需人工确认后扩充契约；伪装字段、额外实体或隐晦名称不能保证全部识别 |

`evaluateSpec()`/CLI 是本地结构与覆盖门禁；业务操作用例目前针对随附 Fixture。若引入不同必填字段或重组实体，须补充相应操作样例，不应把静态契约通过当作任意应用业务闭环已验证。真实业务新增约束后，需把这里的限制复现同步升级为正确的拒绝断言。本轮仅通过独立测试分支和 PR 交付；默认 npm test 的永久接入交由 Tech Lead 整合，未修改业务行为或合并 main。
