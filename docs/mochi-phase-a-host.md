# Mochi × Phase A：宿主集成准备

## 已核实基线（2026-10-18）

- GitHub main：`ecf7000dcb0015f7d9c2b895f6fdd3957ff70449`。
- Phase A [PR #10](https://github.com/Nanmuxxx/BlockCraft-AI/pull/10) 已合并；文本兼容修复 #12 也已合并。
- Mochi Phase B 原始 [PR #17](https://github.com/Nanmuxxx/BlockCraft-AI/pull/17) 仍 open、未合并；head 为 `e6f94fa591aea3111bbc811c7b20c98a74f45cdf`，1 commit、11 files。当次 GitHub 返回 mergeable=true / clean，这不代表完成集成验收。
- 本分支直接基于上述 main；只读取 Phase B 已提交 Git 对象核对接口，不复制其他 Agent 的未提交源码。未新增或重建 `src/components/mochi-ai/`，未改现有组件、品牌、CustomBlock 引擎或 Docker。

## 本轮实际交付与边界

`src/integrations/mochi/host.ts` 是可订阅的宿主控制器，直接调用真实 `createAppChangePlanner(runtime)`。四个 UI 回调均由宿主提供，组件只能回传指令、planId 或 suggestionId。控制器没有网络、模型调用或自动重试。

`mockPlanner.ts` 是显式注入的固定测试计划：忽略自然语言，在选中 form/list 的已有实体中添加可选的「Mock 备注」字段，并仅在该积木展示。不能据此声称自然语言修改、DeepSeek 计划生成或任意功能已可用。当前生产工坊没有挂载本适配层，等待 #17 合并后接线。

## Phase A 接口审查

| 接口 | 使用约束 |
| --- | --- |
| `preview(candidate: unknown, trustedScope)` | 严格 JSON / 命令 / 能力 / 绑定校验；在隔离 session 预演；真实 Runtime 零写入 |
| `confirm(originalPlan)` | 只接收同 planner 创建的原始冻结对象；原样提交预演请求；revision 冲突拒绝；成功重复确认不执行 |
| `cancel(originalPlan)` | pending → cancelled；取消幂等；不能再确认 |
| `getStatus(originalPlan)` | planner 内部归属与生命周期状态；公共预览不是授权凭证 |

宿主保留原始 plan 引用，外部只获得冻结展示投影。组件传回同形对象、另一个 Runtime 的 planId、取消的 planId 或旧上下文的 planId，均不能触发执行。

## 信任与绑定

`MochiHostContext` 来自宿主的真实 Runtime 快照，包含 appId、随机 instanceId、revision、selectedBlockId、blocks、relations、entities。它是 #17 `MochiHostContext` 的结构兼容投影；本轮不引入未合并类型依赖。UI context 不含业务记录。未来 provider 接口有完整只读快照，网络适配必须另外选择必要数据，不能直接外发全部记录。

- selectedBlockId 只能经宿主 `setSelection()` 更新，先用 Phase A 的唯一绑定解析函数校验；未选择则不生成可确认计划。
- `onRequestPlan(prompt, componentContext)` 的第二参数完全忽略，不能用它或模型返回值构造、合并权限。
- 固定最小范围为 `allowedBlockIds=[selectedBlockId]`、`allowedEntityIds=[绑定实体]`。不能直接配置/删除同实体的兄弟积木，也不能操作其他实体。
- 实体授权允许添加 schema 字段，可能间接影响共享该实体的所有积木。预览逐项列出 `sharedEntityImpacts`、直接范围外积木和保留记录数。此适配策略明确接受这些间接影响；若产品要求完全隔离实体 schema，必须另行收紧宿主策略。
- host requestId 由随机实例 ID + 单调序号构成。provider 必须原样返回 requestId 与 baseRevision；Phase A 校验 unknown JSON 后再比对，宿主不重写候选的版本号。
- 每次新请求、选择变化、B/C 切换、Runtime revision 更新、dispose 都推进 epoch 并撤销 pending plan、abort 在途请求。选择 A→B→A 也不能恢复旧授权。
- 异步响应即便忽略 AbortSignal，仍需通过 epoch 检查；旧成功/旧失败都不能覆盖新预览、busy 或 error。
- anchor 是宿主测量并转换到 overlay 定位容器的 CSS 像素矩形，不进入 planner、权限或 provider。`BoundAnchor` 绑定 instanceId + revision + selectedBlockId + epoch；布局/选择/模式变化后清空，拒绝迟到测量和非有限坐标。
- `onConfirm` 在 Runtime 同步通知之前锁定 entry，拦截重入。重复已成功确认直接返回，不再次执行；取消幂等；ignore 只记录建议隐藏状态，不等同确认或取消另一计划。
- provider/校验/执行失败只更新宿主错误状态，不清空 Runtime 或最后成功回执，不用初始应用覆盖已确认应用。Runtime 仍负责原子事务。

这属于可信前端宿主边界，不是针对可任意执行前端代码的恶意客户端的服务端鉴权。

## #17 合并后的接线方案

1. 在生成应用生命周期创建一个 host，持有现有同一个 Runtime。所有权位于 B/C 模式之上；替换应用或真正销毁时 `dispose()`，不能每次切模式创建 Runtime/host。
2. 用 `useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)` 获取稳定快照。React effect 订阅的 setup/cleanup 必须成对创建/销毁 host，兼容 StrictMode 的重放，不能把已 dispose 的 memo 实例重新使用。
3. 在选择、B/C 按钮事件中同步调用 `host.setSelection(id)` / `host.setMode(mode)`，随后更新原工坊选择/模式；避免仅在延迟 effect 中撤销旧授权。B/C 都继续读取同一个 Runtime。
4. 只挂载一次 #17 的 `MochiAssistant`，不要同时挂载底层 `MochiAiAssistant`。宿主 props 映射如下（接线示意，当前生产入口尚未改动）：

```tsx
<MochiAssistant
  context={view.context}
  preview={view.preview}
  anchor={view.anchor}
  showOverlay={view.mode === 'blocks'}
  emotion={view.error ? 'error' : view.busy ? 'thinking' : 'idle'}
  messages={messages}
  suggestions={suggestions.filter(s => !view.ignoredSuggestionIds.includes(s.id))}
  {...host.callbacks}
/>
```

5. messages / suggestions 来自宿主；只有 callback resolve 后才可写成功消息，catch 时保留用户草稿/显示错误。host.error 应作为具体错误文字展示；不得把 callback 拒绝吞掉后显示成功。建议不得伪称存在未支持的 primitive。生产 provider 未提供前保留明确的 Mock 标识，不能默认启用固定测试计划。
6. #17 的 overlay 默认 `position:absolute`，不是 fixed。宿主必须确定包含画布的实际定位容器；按真实 block ID 找 DOM，读取双方 `getBoundingClientRect()`，再转换成该容器坐标，例如 `x = block.left - container.left - container.clientLeft + container.scrollLeft`（y 同理）。不能直接把 viewport 坐标传给绝对定位 overlay。若助手 sidebar 建立了其他定位上下文，先由宿主安排正确的共同定位容器；本轮不改组件/CSS。滚动、resize、拖拽和模式变化时重新测量，调用 `setAnchor({instanceId, revision, selectedBlockId, epoch, rect})`。捕获测量时的绑定信息，不能把旧矩形贴上新 epoch。390px 和 corner 使用 #17 自带 fixed 降级策略，仍需浏览器验收。
7. 用 Mock 先做真实浏览器验收：选中 → 请求 → 预览 → 确认/取消 → B/C 切换，核对共享数据、390px 视口、拖拽事件隔离、滚动定位、减少动画、StrictMode 清理与错误展示。

## 测试与依赖

- `npm run test:mochi-host`：24/24。真实 Phase A + AppRuntime，不 mock 执行器；涵盖确认前无写入、单次提交、B/C 实际组件的服务端渲染、records 保留、跨积木/实体、ID/版本篡改、旧计划、取消、重入确认、迟到响应、anchor 和 dispose。
- `npm test`：144/144（新增 24 项已加入默认测试命令）。
- `npm run build`：TypeScript + Vite 通过。
- 当前 B/C 检查是共享 Runtime 与实际组件渲染测试；尚未完成 #17 组件挂载后的真实浏览器交互验收。
- 适配代码只依赖已合并 Phase A，可独立评审；生产 UI 接线依赖 #17 合并并保持其单一入口/回调契约。#17 的合并顺序不改变本分支文件，两者无组件文件修改重叠。
- 下一阶段需要产品确认上述共享实体影响策略，并提供独立自然语言 change-plan API；沿用严格候选 schema，不混入现有整应用生成接口，不允许返回 JavaScript。

本轮不自动合并，不部署。
