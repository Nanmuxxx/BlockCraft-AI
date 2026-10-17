# BlockCraft AI 组件接口协议

本文档是四人协作时的公共边界。当前项目由主程序统一持有 `AppConfig`；组件只通过 Props 和回调读写数据，不在各自组件内建立第二套全局状态。

## 模块和数据模型

公共类型位于 [`src/model/appConfig.ts`](../src/model/appConfig.ts)。模块 ID 固定为：

| ID | 含义 |
| --- | --- |
| `tasks` | 任务管理 |
| `courses` | 课程安排 |
| `stats` | 学习统计 |

`AppConfig` 分成两部分：

- `data`：`tasks`、`courses` 和由任务状态计算出的 `stats`，属于软件功能配置与状态。
- `blockPositions`：`Record<ModuleId, BlockPosition>`，属于 B 模式画布布局；`x`、`y` 为画布内的 0 到 1 归一化坐标。

移动积木只能更新 `blockPositions`，不得修改任务、课程或统计数据。任务使用 `StudyTask`，其中 `priority: 'high' | 'medium' | 'low'` 已为 Mochi 的优先级建议预留。

```ts
interface AppConfig {
  idea: string
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

公共组件应接受 `BlockCanvasProps`：

```ts
interface BlockCanvasProps {
  positions: Record<ModuleId, BlockPosition>
  selectedModule: ModuleId | null
  onSelectModule: (moduleId: ModuleId) => void
  onMoveModule: (moduleId: ModuleId, position: BlockPosition) => void
}
```

- 点击积木时调用 `onSelectModule(moduleId)`。
- 拖动结束或位置改变时调用 `onMoveModule(moduleId, position)`。
- 画布不得直接维护一份全局模块配置；位置由主程序回写。
- 现有 `Workshop` 内部的 pointer 拖动实现可继续使用，接入协议时保持上述回调语义即可。

### MochiPanel

负责组员：Mochi 交互负责人。

```ts
interface MochiPanelProps {
  suggestions?: MochiSuggestion[]
  onSendMessage: (message: string) => void
  onConfirmSuggestion: (suggestionId: 'enable-task-priority') => void
}
```

- 用户发送内容时调用 `onSendMessage(message)`；MochiPanel 不直接修改 `AppConfig`。
- 用户确认建议时调用 `onConfirmSuggestion('enable-task-priority')`。
- 修改任务优先级前必须经过主程序确认流程；建议 ID 不得使用显示文案代替。
- 本轮只建立接口，未要求开发聊天或 AI 行为。

### ClarificationStep

负责组员：需求澄清负责人。

```ts
interface ClarificationStepProps {
  onComplete: (choice: 'tasks' | 'courses' | 'both') => void
}
```

`onComplete` 只能返回三个稳定值：`tasks`、`courses`、`both`。主程序收到选择后再决定如何更新 `AppConfig`；澄清组件不持有全局配置。

## 职责和修改范围

| 组员 | 负责内容 | 可修改范围 | 对外边界 |
| --- | --- | --- | --- |
| 主负责人 | `AppConfig`、状态编排、页面组装、合并和验收 | `src/App.tsx`、`src/model/appConfig.ts`、组件组装处、公共样式与文档 | 维护唯一状态源，向各组件传 Props 和回调 |
| B 模式负责人 | 积木画布呈现、选中和拖动交互 | `src/components/BlockCanvas.tsx` 及其专属样式（如创建） | 通过 `onSelectModule`、`onMoveModule` 上报 |
| Mochi 负责人 | Mochi 小窝、建议展示和确认交互 | `src/components/MochiPanel.tsx` 及其专属样式（如创建） | 通过 `onSendMessage`、`onConfirmSuggestion` 上报 |
| 需求澄清负责人 | 澄清步骤和选择呈现 | `src/components/ClarificationStep.tsx` 及其专属样式（如创建） | 通过 `onComplete` 返回三种选择 |

## 公共文件和变更规则

以下文件属于公共文件，只有主负责人直接修改：

- `src/model/appConfig.ts`
- `src/App.tsx`
- `src/components/Workshop.tsx` 的状态编排、Props 组装和模式切换部分
- `src/styles.css`、`src/components/workshop.css` 中被多个组件共享的规则
- `docs/INTEGRATION.md`

组员如需公共协议变化，应先提出接口变更说明，由主负责人统一修改类型和文档，再由各组件适配。组员不得在组件内复制 `AppConfig`、模块 ID 或另一份任务/课程全局状态。

当前已有 `Workshop` 尚未拆出独立的 `BlockCanvas`、`MochiPanel` 和 `ClarificationStep` 文件；本协议先提供兼容接口，后续拆分时无需改变主程序的数据契约。

