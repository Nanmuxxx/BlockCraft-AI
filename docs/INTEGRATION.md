# BlockCraft AI 组件接口协议

本文档是五人协作时的公共边界。当前项目由主程序统一持有 `AppConfig`；组件只通过 Props 和回调读写数据，不在各自组件内建立第二套全局状态。

## 模块和数据模型

公共类型位于 [`src/model/appConfig.ts`](../src/model/appConfig.ts)。模块 ID 固定为：

| ID | 含义 |
| --- | --- |
| `tasks` | 任务管理 |
| `courses` | 课程安排 |
| `stats` | 学习统计 |

`AppConfig` 保存原始创意和澄清偏好，并将功能数据与布局分开：

- `idea`：首页提交的创意，沿用原有首尾空白清理逻辑。
- `clarificationChoice`：`'tasks' | 'courses' | 'both' | null`，未完成澄清时为 `null`。阶段 1 只记录偏好，不据此删减模块或生成新功能。
- `taskPriorityEnabled`：任务优先级功能开关，默认 `false`，只在当前页面组件状态中保存；刷新恢复关闭。
- `data`：`tasks`、`courses` 和由任务状态计算出的 `stats`，属于软件功能配置与状态。
- `blockPositions`：`Record<ModuleId, BlockPosition>`，属于 B 模式画布布局；`x`、`y` 为画布内的 0 到 1 归一化坐标。

移动积木只能更新 `blockPositions`，不得修改任务、课程或统计数据。任务使用 `StudyTask`，其中 `priority: 'high' | 'medium' | 'low'` 启用后直接用于显示和编辑，不新增另一套优先级数据。

```ts
interface AppConfig {
  idea: string
  clarificationChoice: 'tasks' | 'courses' | 'both' | null
  taskPriorityEnabled: boolean
  data: {
    tasks: StudyTask[]
    courses: Course[]
    stats: StudyStats
  }
  blockPositions: Record<ModuleId, BlockPosition>
}
```

## 组件接口

### B 模式积木画布

负责组员：B 模式积木画布负责人。

现有组件接受 `src/components/blocks/contract.ts` 定义并由 `BlockCanvas.tsx` 导出的 `BlockCanvasProps`，Workshop 当前使用固定的三个功能 ID：

```ts
interface BlockCanvasProps {
  modules: readonly BlockModuleData[]
  positions: Readonly<Partial<Record<ModuleId, BlockPosition>>>
  selectedModuleId: ModuleId | null
  onSelectModule: (moduleId: ModuleId) => void
  onMoveModule: (moduleId: ModuleId, position: BlockPosition) => void
  examples?: readonly VisualExample[]
}
```

- 点击积木时调用 `onSelectModule(moduleId)`。
- 拖动结束或位置改变时调用 `onMoveModule(moduleId, position)`。
- 画布不得直接维护一份全局模块配置；位置由主程序回写。
- 当前 Workshop 直接组装已有 BlockCanvas，拖动与拼接仅调整布局；两个展示积木不写入业务数据。
- 组件另有可选的 `builder` 扩展接口，本阶段不接入功能增删、配置或组合命令。`appConfig.ts` 中旧版 `selectedModule` 接口暂保留兼容，本轮不迁移 B 模式协议。

### MochiPanel

负责组员：Mochi 交互负责人。

```ts
interface MochiPanelProps {
  selectedModuleId: ModuleId | null
  messages: MochiMessage[]
  suggestions?: MochiSuggestion[]
  onSendMessage: (message: string) => void
  onConfirmSuggestion: (suggestionId: 'enable-task-priority') => void
}
```

- 用户发送内容时调用 `onSendMessage(message)`；MochiPanel 不直接修改 `AppConfig`。
- 用户确认建议时调用 `onConfirmSuggestion('enable-task-priority')`。
- 修改任务优先级前必须经过主程序确认流程；建议 ID 不得使用显示文案代替。
- `appConfig.ts` 定义基础回调，组件补充 `selectedModuleId` 和 `messages`。阶段 2 由 Workshop 将现有 MochiPanel 组装到右侧，传入 B 模式选中的模块 ID，并持有聊天消息。发送后保存用户消息及对应模块的本地 Mock 引导，不调用真实 AI。
- MochiPanel 始终挂载，B/C 切换保留聊天、选中上下文和组件已有的建议确认/拒绝状态。任务优先级建议沿用组件的每会话一次展示逻辑；拒绝仅关闭建议，不调用配置回调。Workshop 根据 `taskPriorityEnabled` 传入可用 `suggestions`，已启用时传空数组，避免再次推荐。
- 确认 `enable-task-priority` 时，Workshop 通过现有 `onConfigChange` 将公共 `AppConfig.taskPriorityEnabled` 设为 `true`，并追加启用成功提示。会话请求去重与配置 updater 的已启用检查共同保证重复确认幂等。
- 启用前 C 模式保留原任务交互，不显示优先级控件；启用后每项任务（含已完成任务）显示高/中/低优先级选择框，修改直接写回该任务现有 `priority`。新增任务默认中优先级。
- 开关启用不改写任务、完成状态、课程、统计或 B 模式坐标；优先级编辑仅更新目标任务，完成切换和新增任务仍沿用 `withTasks` 计算统计。B/C 切换保留开关与任务优先级。

### ClarificationStep

负责组员：需求澄清负责人。

```ts
interface ClarificationStepProps {
  idea: string
  onComplete: (choice: 'tasks' | 'courses' | 'both') => void
  onBack: () => void
}
```

接口统一定义在 `appConfig.ts`，由 `ClarificationStep.tsx` 引用并重新导出。`idea` 接收首页提交的原始创意。Mochi 提问及三个选项沿用现有组件。

`onComplete` 只能返回三个稳定值：`tasks`、`courses`、`both`。主程序将选择写入 `AppConfig.clarificationChoice` 后进入 Workshop；该回调不修改 `data` 或 `blockPositions`。`onBack` 返回首页，首页以 `AppConfig.idea` 初始化输入框，允许修改后再次澄清。澄清组件不持有全局配置。

## 阶段 1 页面流程

- `App` 持有 `home | clarification | workshop` 页面状态：Home → ClarificationStep → Workshop。
- Home 保留原 UI、输入校验、示例创意与加载反馈；新增 `initialIdea: string` 属性用于返回时恢复输入。
- 首页提交时仍按原逻辑创建本地 Mock 配置，澄清选择初始为 `null`；三个选择均保留任务、课程和统计模块。
- Workshop 接收完整 `AppConfig`，现有 B/C 切换、任务与统计逻辑通过展开当前配置保留澄清选择。Workshop 的首页按钮也恢复创意输入。
- 状态只保存在当前页面会话中，刷新恢复示例；不接入真实 AI；阶段 2、3 的扩展见 MochiPanel 交互说明。

## 职责和修改范围

| 组员 | 负责内容 | 可修改范围 | 对外边界 |
| --- | --- | --- | --- |
| 主负责人 | `AppConfig`、状态编排、页面组装、合并和验收 | `src/App.tsx`、`src/model/appConfig.ts`、组件组装处、公共样式与文档 | 维护唯一状态源，向各组件传 Props 和回调 |
| B 模式负责人 | 积木画布呈现、选中和拖动交互 | `src/components/BlockCanvas.tsx` 及其专属样式（如创建） | 通过 `onSelectModule`、`onMoveModule` 上报 |
| C 模式负责人 | 应用预览、任务和课程呈现、统计交互 | `src/components/Workshop.tsx` 的 `StudyPreview` 与专属样式，公共文件改动由主负责人统一落地 | 接收 `AppConfig.data`，通过主程序回调更新任务及派生统计 |
| Mochi 负责人 | Mochi 小窝、建议展示和确认交互 | `src/components/MochiPanel.tsx` 及其专属样式（如创建） | 通过 `onSendMessage`、`onConfirmSuggestion` 上报 |
| 需求澄清负责人 | 澄清步骤和选择呈现 | `src/components/ClarificationStep.tsx` 及其专属样式（如创建） | 接收 `idea`，通过 `onComplete` 返回三种选择，通过 `onBack` 返回首页 |

## 公共文件和变更规则

以下文件属于公共文件，只有主负责人直接修改：

- `src/model/appConfig.ts`
- `src/App.tsx`
- `src/components/Workshop.tsx` 的状态编排、Props 组装和模式切换部分
- `src/styles.css`、`src/components/workshop.css` 中被多个组件共享的规则
- `docs/INTEGRATION.md`

组员如需公共协议变化，应先提出接口变更说明，由主负责人统一修改类型和文档，再由各组件适配。组员不得在组件内复制 `AppConfig`、模块 ID 或另一份任务/课程全局状态。

三个功能 PR（#1 MochiPanel、#2 ClarificationStep、#3 BlockCanvas）均已合并。阶段 1 统一澄清接口并接入页面流程；阶段 2 接入 MochiPanel 的上下文、会话聊天和建议请求记录，保留现有 B/C 功能与各组件内部实现。阶段 3 接通建议确认、公共配置与 C 模式任务优先级编辑；BlockCanvas 的 builder 业务闭环仍未接入。


## 阶段 A：独立 AppSpec v1（尚未接入 UI）

旧 `AppConfig` 及上面的学习管理 Demo 协议不变。新协议不等同于旧画布的 `BlockEdit` / `BlockRelation`，本阶段没有转换器或 UI 接线，也不包含 AI、后端、动态代码执行、实体间外键或工作流。

### 公共入口

| 文件 | 导出接口 |
| --- | --- |
| `src/model/appSpec.ts` | `FieldSpec`, `EntitySpec`, `BlockSpec`, `RelationSpec`, `AppSpec`, `FieldValue`, `EntityRecord`, `ProjectState`, `AppCommand`, `CommandRequest` |
| `src/model/appSpecValidation.ts` | `assertAppSpec(unknown)`, `assertProjectState(unknown)`, `assertCommandRequest(unknown)`, `AppSpecError` |
| `src/model/appCommands.ts` | `createCommandSession(ProjectState)`, `processCommand(CommandSession, unknown)`, `CommandSession`, `CommandResult` |
| `src/model/appSpecExamples.ts` | `clubRegistrationSpec`, `readingLogSpec`, `createClubRegistrationExample()`, `createReadingLogExample()` |

所有输入是普通 JSON 数据；校验器拒绝未知属性、未知类型和隐式类型转换，成功返回 `void` 并收窄类型，失败抛出带 `code/message` 的 `AppSpecError`。不要传入函数、访问器、循环对象或 JS 类实例。显示名称和记录文本只是数据，不作为脚本或 HTML 执行。

### 数据与绑定约束

- `AppSpec = { version: 1, id, name, entities, blocks, relations }`。
- `EntitySpec = { id, name, fields }`；字段是 `{ id, name, type, required }`。`type` 为 `text | number | boolean | date | select`，仅 `select` 额外要求非空且不重复的 `options: string[]`。
- `BlockSpec` 使用稳定的实例 `id` 与独立的 `type`，同类可以多实例。`list/form` 必须配置非空、不重复的 `fieldIds`；`metric` 配置 `aggregation: 'count'`，或 `aggregation: 'sum' | 'average'` 加一个数字字段 `fieldId`。本阶段只定义与校验配置，不计算或渲染统计结果。
- `RelationSpec = { id, type: 'dataBinding', blockId, entityId }` 是积木唯一的数据来源。每个积木必须且只能有一条绑定；多个积木可绑定同一实体。字段引用必须属于该绑定实体。表单必须包含实体所有必填字段。
- App、实体、字段、积木、关系的 ID 在整个 spec 内全局唯一。ID 由调用方生成，格式为 ASCII 字母开头、后接字母/数字/下划线/连字符，长度 1–128；禁用 `constructor/prototype/__proto__`。显示名称变化不改变 ID。
- `ProjectState = { revision, spec, records, blockPositions }`。`revision` 是非负安全整数。`records` 为实体 ID 到 `{ id, values: Record<fieldId, string | number | boolean> }[]` 的映射；记录 ID 在所属实体内唯一。未出现的实体键视为空记录集。缺失的非必填字段允许，`null/undefined` 不作为字段值；必填字符串不能全空白；数字必须有限，日期必须是实际存在的 `YYYY-MM-DD`，select 必须匹配选项。
- `blockPositions` 按积木实例 ID 存储 `{ x, y }`，坐标范围 `[0,1]`；允许缺省位置，不允许悬空位置。业务记录与布局独立。

### 受控命令

AI 提案与用户操作未来必须提交同一 `CommandRequest`，不提供绕过校验的来源特权：

```ts
interface CommandRequest {
  requestId: string
  baseRevision: number
  commands: AppCommand[]
}
```

| type | 参数 | 语义 |
| --- | --- | --- |
| `addBlock` | `block, binding, position?` | 原子添加实例和绑定；binding 必须指向新增实例 |
| `removeBlock` | `blockId` | 删除积木及其关系、位置，保留实体、字段与全部业务记录 |
| `addField` | `entityId, field` | 新增字段；不自动填充或迁移记录 |
| `updateField` | `entityId, fieldId, field` | 完整替换字段定义，不是 partial patch；ID 不可变；现有记录和引用必须继续合法 |
| `removeField` | `entityId, fieldId` | 仅可删除无积木引用且没有记录值的字段，否则 `FIELD_REFERENCED` |
| `configureBlockFields` | `blockId, fieldIds` | 配置 list/form 的字段及顺序；metric 使用 addBlock 时声明的聚合配置 |
| `undo` | 无 | 单独一个命令请求，撤销最近一批成功编辑，无 redo |

`commands` 非空，按顺序作用于副本，最后统一验证整个项目；因此同一批次可以同时新增必填字段并更新表单（但已有记录缺少该值仍会拒绝）。任一命令或最终状态非法，整个批次回滚，包括历史、去重收据与 revision。成功批次只增加一次 revision，并记录一个撤销快照；撤销恢复 spec、records、positions，但 revision 在当前值上递增，永不退回旧版本。revision 耗尽时拒绝新提交。

`processCommand` 返回判别联合：

```ts
// success
{ ok: true, session, duplicate: boolean, committedRevision: number }
// failure: session 为原输入对象，未发生写入
{ ok: false, session, error: { code: string, message: string } }
```

`CommandSession = { state, history, receipts }` 由 `createCommandSession` 创建（验证并复制初始状态）。它是宿主持有的可信会话，不是 AI 输入。调用方应将其视为不可变值，串行以最新 session 调用处理器；成功后一次性替换整个 session，不能只替换 state。无隐藏全局状态，无时间戳或随机 ID。该纯处理器不实现跨进程锁或后端存储。

去重以成功请求为准，使用包含 `baseRevision` 和命令的规范化 JSON 指纹（对象属性顺序无关，数组顺序有关）。同 `requestId` 同载荷先于 revision 检查命中，返回当前 session 与原 `committedRevision`，不重复执行；同 ID 不同载荷报 `REQUEST_ID_CONFLICT`。新请求的旧 revision 报 `REVISION_CONFLICT`。失败请求不占用 requestId，修正后可重试。撤销不删除已成功请求的收据，旧重试不会重新应用已撤销操作。

其他错误码：`VALIDATION`（结构/引用/记录/约束非法）、`FIELD_REFERENCED`、`NOTHING_TO_UNDO`。失败消息供诊断；调用方逻辑应依赖错误码，不匹配消息文本。历史与收据本阶段只存在调用方内存，未限制长度；重新创建 session 会丢失撤销和去重历史。未来若持久化，须一起保存会话并验证可信来源，不能将未经校验的外部 session 直接传入。

```ts
import { createReadingLogExample } from '../src/model/appSpecExamples'
import { createCommandSession, processCommand } from '../src/model/appCommands'

let session = createCommandSession(createReadingLogExample())
const result = processCommand(session, {
  requestId: 'edit-001',
  baseRevision: session.state.revision,
  commands: [{ type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title'] }],
})
if (result.ok) session = result.session
```

### 手写示例与验证

- **社团迎新报名**：一个报名者实体，姓名/text、意向部门/select、面试意愿/boolean，报名表、名单、人数计数共三块积木。
- **阅读记录**：书目和每日阅读两个独立实体，包含 text/select/date/number；两个 list 实例分别绑定不同实体，另有录入表和分钟 sum 指标。没有虚构实体间关联。
- 两个工厂都返回 revision 0、示例业务记录和空布局的新对象，可直接送入 `createCommandSession`。
- `npm test` 同时运行 AppSpec 测试与原画布测试；`npm run build` 检查 TypeScript 与生产构建；提交前运行 `git diff --check`。

## 阶段 B1：独立 C 模式渲染与业务运行时

访问 `/app-renderer`（`npm run dev -- --host 127.0.0.1` 后打开 Vite 输出的端口）。根路径 `/` 继续使用原学习 Demo；没有改动 Workshop、BlockCanvas、MochiPanel 或 ClarificationStep。

- `src/model/appRuntime.ts`：每个项目只有一个 runtime；以 `ProjectState.records` 为唯一业务数据源。`dispatch` 新增、整条替换更新、删除记录，克隆后通过 `assertProjectState` 再原子发布；失败不改变快照、revision 或订阅通知。成功增加 revision，深冻结快照，避免组件直接修改记录。统计从当前 records 即时派生，没有统计缓存。
- `src/components/app-renderer/AppRenderer.tsx`：按稳定 block ID 查找 dataBinding；渲染 list、form、metric。输入控件支持 text、number、boolean、date、select，表单提交先转换并校验，再交给统一 runtime。组件的本地状态仅用于未提交草稿、错误与 UI 展开状态。
- list 支持新增、编辑、删除；编辑保留未展示字段，清空可选字段时删除对应值。若 list 未展示实体必填字段，编辑器补充这些字段以保证新建记录有效。boolean 使用可留空的是/否选择，必填 boolean 的 false 是有效值。
- `AppRendererDemo.tsx`：社团报名和阅读记录各自拥有一个 runtime，切换不会串数据；刷新页面恢复原始样例。此轮只做内存运行时，不写入 localStorage 或后端，也未接入 AI。

### 与任务描述的协议差异

实际阶段 A 的 AppSpec v1 **没有 `previewOrder` 属性**，校验器会拒绝此属性；因此保持协议不变，使用 `spec.blocks` 数组顺序。metric 仅定义 `count / sum / average`，没有条件或过滤配置；因此本轮支持数量、求和和平均值，**未实现条件数量**。这两项需要先确定后续协议扩展，当前没有添加私有属性或硬编码业务条件。

### B1 验证

- `npm test`：58 项通过（含 5 项新增运行时测试和既有阶段 A、画布测试）。覆盖原子回滚、共享记录 CRUD、即时统计、五种输入类型、无效日期、false/0、空数据、项目隔离、可选字段清空和快照不可修改。
- `npm run build`：TypeScript 与 Vite 生产构建通过；`git diff --check` 通过。
- 浏览器操作：社团空表单不提交；有效提交后名单新增、人数 1 → 2；列表修改后切换示例再切回仍保留修改；删除后人数 2 → 1。阅读记录新增 20 分钟后流水新增、累计分钟 30 → 50。
- 旧流程浏览器冒烟：根路径首页 → 需求澄清 → Workshop B 功能积木 → 旧 C 学习应用预览均可进入；这不等于完整重测所有拖拽与聊天交互。
- 基线：开始时工作区干净，本地 main 与缓存 origin/main 均为 `bd43b45`。`git fetch origin` 因 github.com DNS 解析失败，无法证明远端最新状态。没有自动提交、推送或合并。
