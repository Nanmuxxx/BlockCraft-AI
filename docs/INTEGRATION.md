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

