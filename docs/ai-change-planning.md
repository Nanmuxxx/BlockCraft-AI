# AI change planning — Phase A

本阶段仅新增纯本地能力目录及计划引擎。没有聊天 UI、网络请求、DeepSeek 计划接口或 AppSpec v1 扩展。现有生成链路保持原样。

## 能力目录

`src/model/appCapabilities.ts` 导出冻结的 `APP_CAPABILITIES`、`getAppCapability(id)` 和 `getBlockCapabilityId(block)`。

| 类别 | ID | 实际能力 |
| --- | --- | --- |
| primitive / supported | form | 校验并创建实体记录 |
| primitive / supported | list | 展示、新增、编辑、删除实体记录 |
| primitive / supported | metric-count | 全部记录条数 |
| primitive / supported | metric-sum / metric-average | 全部记录指定 number 字段合计 / 均值 |
| semantic / supported | registration-management | 报名表、名单、记录数的业务组合 |
| semantic / supported | workout-record-management | 手动记录日期、动作、时长，展示记录及数值统计 |
| semantic / supported | exercise-library | 独立动作资料录入和管理 |
| semantic / unsupported | workout-timer / calendar / automatic-workout-planning / completion-rate / checklist | 有明确缺失原因，不能成为可确认计划 |

语义模块的 supported 表示其列出的有限组合能由现有 primitive 实现，且必须满足 prerequisites；不是新积木类型，也不承诺该业务名称下的所有功能。仅能在已有实体上添加积木，实体创建不属于本阶段命令权限。没有去重人数、连续打卡、跨实体关联、条件聚合或自动编排。UI 应从目录展示实际行为与限制，不能将模型提供的积木名称或 capabilityIds 当作完整业务实现的证明。

## 输入和宿主权限

`createAppChangePlanner(runtime)` 返回 `preview / confirm / cancel / getStatus`，一个 Runtime 实例持有一个 planner。生命周期结束时一同释放；计划及去重信息仅存在内存中，不跨刷新恢复。

模型适配器将 JSON 作为 unknown 交给 preview，结构必须精确为：

```ts
interface AppChangeCandidate {
  request: {
    requestId: string
    baseRevision: number
    commands: AiChangeCommand[]
  }
  capabilityIds: string[]
}
```

命令仅允许 addField、configureBlockFields、addBlock、removeBlock。字段、积木、绑定和位置复用现有协议的精确键名与验证规则。支持五种字段类型 text/number/boolean/date/select。所有新增 ID 必须与原始快照及本批次 ID 均不冲突，删除后不能复用 ID；新增积木的字段直接放入 addBlock，不允许同批再以其为目标配置或删除。输入限制为最多 100 条命令、JSON 深度 32、节点数 10000、单个字符串 4000 字符。拒绝非 JSON 值、存取器、隐藏属性、循环、额外属性、脚本/HTML 标记和常见可执行表达式；字符串只按普通文本处理，绝无脚本执行入口。

capabilityIds 可为空（字段或展示修改不需要能力声明）；addBlock 必须声明对应 primitive 或包含它的 supported semantic。未知或 unsupported 声明导致整批拒绝；例如不能把声明为 workout-timer 的列表当成可用计时器。通过改标题无法增加任何底层执行能力，后续 UI 应以目录为准介绍能力。

宿主代码独立传入 AppChangeScope，绝不能从模型响应展开、合并或接受权限：

```ts
const scope = {
  selectedBlockId: 'registration-form', // 未选中时明确传 null
  allowedBlockIds: ['registration-form', 'applicant-list'],
  allowedEntityIds: ['applicants'],
}
```

- configureBlockFields / removeBlock 要同时拥有目标 block 及其绑定 entity 的权限。
- addField / addBlock 要拥有已有 entity 的权限。
- selectedBlockId 必须有效、具有唯一绑定，并位于授权 block/entity 范围；不按名称猜测绑定。
- entity 权限允许 schema 变化影响所有共享该实体的积木，包括直接 block 权限外的兄弟积木。这些影响完整列在 sharedEntityImpacts 中；若产品不允许此类影响，宿主不授予该 entity 权限。
- 权限快照随计划冻结；选择、授权或应用实例切换时，宿主应取消待确认计划，不应把旧计划挂到新的交互上下文。此 API 是可信前端宿主的边界，不是针对恶意客户端的服务端鉴权系统。

## 预演、确认、取消

```ts
const planner = createAppChangePlanner(runtime)
const candidate = {
  request: {
    requestId: 'mochi-contact-1',
    baseRevision: runtime.getSnapshot().revision,
    commands: [
      { type: 'addField', entityId: 'applicants',
        field: { id: 'contact', name: '联系方式', type: 'text', required: false } },
      { type: 'configureBlockFields', blockId: 'registration-form',
        fieldIds: ['applicant-name', 'department', 'available', 'contact'] },
      { type: 'configureBlockFields', blockId: 'applicant-list',
        fieldIds: ['applicant-name', 'department', 'contact'] },
    ],
  },
  capabilityIds: [],
}
const preview = planner.preview(candidate, scope)
if (preview.ok) {
  // 保存原始 plan 对象，用 plan.diff 展示预览；此时真实 Runtime 零修改。
  const pendingPlan = preview.plan
  // 只有用户点击确认时：planner.confirm(pendingPlan)
  // 用户取消时：planner.cancel(pendingPlan)
}
```

返回的 plan 深度冻结，包含 version、appId、request、capabilityIds、scope、before、after、diff、unsupportedOperations。diff 包含 addedBlocks、removedBlocks、addedFields、blockFieldChanges、affectedEntityIds、affectedBlockIds、sharedEntityImpacts、recordsPreserved。before/after 完整显示绑定及布局；after.revision 为预期提交版本，不是实时状态。删除积木保留实体及记录。

preview 使用 `processCommand(createCommandSession(snapshot), request)` 处理整批，最终 schema 和所有记录均通过验证才可生成计划。失败返回 `{ok:false,error:{code,message},unsupportedOperations}`；unsupported 声明给出逐项原因。任何失败均没有部分计划或真实写入。已有记录缺少新增必填字段时会失败，本阶段不支持回填记录。

确认只能传回当前 planner 创建的同一个 plan 对象，不能重构、序列化再加载或从另一个 Runtime 搬入，即使 appId 和 revision 相同。内部注册表绑定对象身份；公开投影不是可伪造的授权凭证。

confirm 原样提交预演时的同一个冻结 request 对象给 `runtime.executeCommand`，禁止重新生成命令或刷新 baseRevision。结构、记录和布局共用的 Runtime revision 只要变化，就以 REVISION_CONFLICT 拒绝旧计划。需要重新获取上下文、使用新 requestId 生成预览、再次由用户确认。成功只发布一次 Runtime 更新，现有 B/C 订阅自然同步。

同 requestId、同候选及权限的重复 pending 预演返回同一个 plan；不同 payload 或权限返回 REQUEST_ID_CONFLICT。成功确认后的重复确认返回缓存回执 duplicate=true，不再执行，包括后续 Runtime 已变化的情况。Runtime 自身回执仍是最终去重依据：若 requestId 已被其他入口消费，预演无法读取私有回执，确认时由 Runtime 原子拒绝。取消幂等，取消后不能再确认；stale/rejected 计划也不能再执行。

getStatus 返回 pending / confirming / committed / cancelled / stale / rejected，非当前 planner 对象为 unknown。confirm 返回现有 RuntimeResult；cancel 返回 `{ok:true}` 或 `{ok:false,error}`。UI 应将错误展示给用户，不得静默重试或自动确认。

## 后续接入分工

- Mochi 负责人：从当前 Runtime/选中积木形成上下文；宿主构造权限；保存 pendingPlan 原始引用；展示前后差异、共享实体影响和待支持原因；明确确认/取消；切换上下文时取消旧计划。不要自行修改 spec 或执行模型输出。
- DeepSeek 后端负责人：后续新增独立计划接口，将能力目录和四类命令 schema 提供给模型；返回上述候选 JSON，不返回 JavaScript。沿用现有生成接口，不把计划请求混进生成链路。requestId 和 baseRevision 由宿主确定，并校验响应与所发上下文一致。
- 模型/Runtime 负责人：维护目录与真实执行能力一致，新增 primitive 必须另外评审协议、渲染器和测试。本阶段不实现 timer、calendar、checklist 或任何新协议。

## 验证

`src/model/appChangePlan.test.cjs` 纳入 npm test，覆盖四类命令、隔离预演、单批原子提交、记录保留、取消、不可变请求、去重、共享实体影响、越权/非法输入整批拒绝、版本冲突及同 appId/revision 的 Runtime 隔离。无付费 API 调用。
