# Mochi 可控修改闭环

基线：2026-10-23，main `c0948722a5105a663ab1b57de80df1840a54f8bd`。原主动建议魔搭部署已单独验收；本阶段先在独立分支完成修改闭环，本文的离线验证不代表新代码已经部署。

## 基线能力与复用

| 项目 | 实际已有能力 | 本阶段处理 |
| --- | --- | --- |
| 内置积木 | form、list、gallery、pomodoro、metric；metric 对应 count/sum/average 能力 | 复用现有类型、能力 ID、schema 和渲染器 |
| 自定义积木 | 按 definitionId、versionDigest、props/state schema 和受信制品注册表准入，没有固定类型枚举 | 保留准入、运行、状态、资源与 ZIP；不开放通用模型改写 |
| 原 Mochi 操作 | addField、configureBlockFields、configureBlockPresentation、configureGallery、addBlock、removeBlock；生产入口主要覆盖表单、列表、图库 | 补 configureMetric 和 reorderBlocks，统一进入现有 Planner/Runtime |
| 原预览与确认 | Host 预览、显式确认、过期拒绝、幂等回执、授权校验、运行时事务 | 预览扩展为完整混合项目，并与提交共用确定性投影 |
| 原撤销与排序 | 基础命令历史及项目 owner 的混合布局顺序 | 历史改为完整项目快照；新增正式 Workshop 撤销按钮 |
| ZIP | 完整项目 ZIP 保存配置、资源、制品、混合顺序；另有源码 ZIP 导出 | 复用完整项目 ZIP，验证修改后的项目导出/导入一致 |

运行时另有记录、计时器、资源、字段更新/删除等命令；运行时能力不等于模型已获授权。自定义源码版本修改有独立历史路径，本阶段没有把它包装成统一积木修改。

## 最小闭环与契约

用户在 Workshop 选中积木后表达意图，HTTP/模型 Provider 只生成现有 `AppChangeCandidate` JSON。项目 owner、Host、Planner 和 Runtime 继续持有全部权限；模型回复不构成执行授权。

1. 使用现有 requestId、baseRevision、项目 ID、积木 ID、协议与 schema 校验候选操作。
2. Planner 通过既有 `processCommand` 在隔离快照上模拟，调用 `projectBuiltinChange` 得到完整 `afterProject`。
3. Host 展示真实前后配置、增删积木、共享实体影响与完整混合顺序；确认前项目不变。
4. 用户确认原计划后，再校验项目 ID、revision、完整 beforeProject 及 owner 授权。Runtime 使用同一操作及投影逻辑，经 owner compare-and-swap 原子发布。
5. Workshop 的“撤销结构修改”恢复完整操作前快照；revision 仍单调递增，旧计划不会因此重新有效。

| 操作 | 沿用/新增命令 | 约束 |
| --- | --- | --- |
| 修改配置 | configureBlockFields、configureBlockPresentation、configureGallery、configureMetric | 只修改直接授权目标；count 禁止 fieldId，sum/average 必须引用所绑定实体的 number 字段 |
| 新增 | addBlock，必要时携带既有 dataBinding | 复用已有实体/资源和能力 ID；全局结构校验拒绝 ID 冲突，不新增实体；AI 不新增 pomodoro/custom |
| 删除 | removeBlock | 删除选中积木及对应绑定/位置，保留实体、业务记录和资源；清理 Host 中已删除的选中项 |
| 排序 | reorderBlocks | 当前批次执行到该处后的全部内置 ID 的完整唯一排列；仅移动选中或本批新增积木，其他已有积木相对顺序不变；自定义插槽保留 |

新增位置坐标不隐式授予排序权限：结构命令保持已有顺序并默认追加新积木，意图排序必须显式提交 reorderBlocks。原手动拖动仍可按坐标重排。

网关只接收项目标识、revision、内置顺序、占用 IDs、选中积木配置及必要字段/资源元数据，不传记录、自定义 props/state/源码或资源 bytes。现有模型超时、响应大小、网关费用和密钥策略不变。本轮全部模型回复使用离线夹具。

## 失败与撤销边界

- 过期项目、目标缺失、非法配置、错误排列、越权或执行时授权撤回均拒绝，不发布任何部分结果。
- 完整 beforeProject 检查也覆盖自定义状态变化；确认不自动刷新版本、不自动重试旧计划。
- 确认结果等于预览的完整 afterProject；幂等重复确认返回原回执。
- 撤销覆盖内置配置、资源、自定义实例及状态、计时器、位置和混合顺序。后续数据/布局事务会按原规则清除结构历史；跨刷新/ZIP 不持久化撤销历史。

## 文件归属与集成

| 负责人 | 归属 |
| --- | --- |
| edit_contract | src/model 下的命令、校验、Planner、完整项目投影和 Runtime；contract.test.cjs |
| edit_gateway | planning.ts、modelPlanProvider.ts、httpPlanProvider.ts、server/mochi-plan.mjs；gateway.test.mjs |
| edit_acceptance | 独立 acceptance.test.cjs、正式 Workshop 浏览器夹具与脚本、acceptance.md |
| 主线程（唯一集成负责人） | Host、Workshop UI、旧测试适配、CI、文档整合、统一提交、PR 和合并 |

各 Agent 不自行提交、推送或部署；在唯一工作分支集成，不覆盖其他未完成任务。

## 验证

- 最终离线全量：114 个 src/tests 测试文件，**1607/1607 通过，0 失败、0 跳过**。覆盖本阶段契约、Host、网关及已有主动建议、图库、ZIP 等模块。
- 生产构建：`npm run build` 成功，包含 TypeScript 和 Vite。
- 正式 Workshop Chromium：1440px 与 390px 合计 **14/14 组**，验证修改、增删排序、无写入预览、精确确认、完整撤销、拒绝与 ZIP 恢复。
- 现有主动建议、图库、项目 ZIP 浏览器回归通过；资源原始 bytes、自定义制品摘要和混合顺序另有 Node 断言。
- 本阶段真实 AI 调用 **0 次**。离线夹具不证明线上模型对任意自然语言的理解质量。

可复现入口：

```sh
npm run test:controlled-edit
npm run build
# 浏览器测试使用已安装的 Playwright；可通过 NODE_PATH 指向其安装目录。
npm run test:controlled-edit:browser
npm run test:mochi-proactive:browser
npm run test:project-package:browser
```

更完整的测试范围、证据目录与已有图库回归命令见 [acceptance.md](./acceptance.md)。Docker acceptance CI 已增加本阶段、项目 ZIP 和主动建议回归；浏览器测试在本地验收，仓库未新增 Playwright 依赖。

## 尚未覆盖

- pomodoro 的直接 AI 参数/行为修改及新增删除；现有运行、排序保留与 ZIP 能力继续有效。
- custom 的统一参数/schema/源码修改、实例增删及直接排序；本阶段只验证其数据在通用事务、撤销及 ZIP 中完整保留。
- 列表的全部字段编辑组合未在新增浏览器套件逐一重测，沿用现有配置契约和自动化回归。
- 动画积木、账户、作品社区、多用户冲突解决和跨会话操作历史不在本阶段范围。

合并与线上发布分别记录：通过离线和 CI 验证后按已有权限合并；此文不新增魔搭部署、额度调整或密钥修改授权。
