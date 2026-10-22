# Mochi 可控修改独立验收

## 基线盘点（2026-10-23）

- 内置协议类型：表单 form、列表 list、图库 gallery、番茄钟 pomodoro、指标 metric（count/sum/average）。
- 自定义积木通过版本摘要、受限 props/state schema 和制品注册表准入；没有固定种类枚举。旧 Mochi 修改入口不接受 custom。
- 原 Mochi 计划白名单覆盖新增字段、显示字段、展示属性、图库资源配置、新增和删除积木。运行时另有字段更新/删除、资源增删、记录操作、计时器操作；这些不等于已开放给模型。
- 原 Host/Planner 已有无写入预览、用户确认、过期计划拒绝、幂等回执、权限校验和 Runtime 事务；原完整项目 ZIP 已包含资源、制品及混合 renderOrder。
- 原排序属于混合项目 owner 机制；新增通用计划排序需展示实际混合顺序并让撤销恢复完整项目。

## 本阶段验收边界

先复用表单与图库，再增加现有指标积木的 count/sum/average 配置。独立测试使用正式 Planner、Runtime、Owner、Workshop 和 HTTP Provider，模型响应使用固定离线 JSON，真实 AI 调用为零。

- Node：修改/新增/删除/排序，确认前无写入、确认后与完整预览相同、幂等确认。
- 拒绝：过期计划、目标缺失、非法资源/数值字段/排列、包含有效前序操作的失败事务、执行时权限变化。
- 撤销：除递增 revision 外，完整项目（含资源、custom props/state、位置、混合插槽）恢复。
- ZIP：修改后导出并导入，检查资源原始 bytes、完整配置、制品引用、混合 renderOrder；重新创建 Runtime 后一致。
- Chromium：正式 UI 输入意图、查看实际差异、确认、撤销，以及 ZIP 下载/导入。

## 实测结果（2026-10-23）

独立验收使用 Node v24.22.0、Chromium 151.0.7922.34；以下命令均退出 0。浏览器依赖使用工作站已安装的 Playwright：

```sh
export NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
node --test tests/controlled-edit/acceptance.test.cjs
node tests/controlled-edit/browser.cjs
node tests/mochi-proactive/browser.cjs
GALLERY_SCREENSHOT_DIR=.cache/controlled-edit/gallery-regression node tests/gallery/browser.cjs
node tests/project-package/browser.cjs
```

| 验收 | 结果 | 证据与实测范围 |
| --- | --- | --- |
| 独立 Node 闭环 | 10/10 | 表单、图库、指标、增删排序、stale/missing/invalid/权限失败原子拒绝、完整 undo、真实 PNG bytes + admitted custom + mixed order ZIP 往返 |
| 新增正式 Workshop UI 闭环 | 14/14 组 | 1440px/390px 各 7 组；六种操作逐项经真实输入、HTTP Provider、预览、确认、撤销，再执行拒绝及 ZIP 下载/导入；`.cache/controlled-edit/browser/report.json` |
| 现有主动建议 UI | 桌面/手机通过 | 开启、结构事件触发、稍后与恢复、忽略与拒绝、接受并预览、失败及过期拒绝；`.cache/mochi-proactive/browser/report.json` |
| 现有图库 UI | 桌面/手机通过 | 上传、Mochi 配置/新增/删除、预览弹窗与焦点、JSON 恢复、React ZIP 导出；每种尺寸 4 个离线 Mochi 计划；`.cache/controlled-edit/gallery-regression/` |
| 现有项目 ZIP UI | 4 组通过 | 干净手机 context 导入、图片解码、完整重导出、表单/计时器运行、恶意或损坏输入保持当前项目、旧 v1 JSON 迁移 |

新闭环浏览器逐步比较独立计算的完整项目目标，预览前后项目精确相等，确认结果与目标精确相等；撤销比较除递增 revision 外的整个项目。ZIP 浏览器从真实下载文件恢复后再次比较整个项目，Node 另验证 PNG 原始 bytes、custom 状态、制品摘要及混合插槽。错误、外部请求与真实 AI 调用均为零。截图已检查桌面指标 diff、手机排序 diff 和 ZIP 恢复运行态；两个尺寸无横向溢出。证据目录为本地测试输出，不是提交内容；可用上述命令重建。

本轮 UI 验收发现并推动补齐了“撤销结构修改”入口；修复后全流程通过。当前离线验收证明确定性契约与执行链路，不声称已验证线上模型自然语言理解质量或线上部署。

## 未覆盖或尚未开放

- 本阶段新增接入指标的 count/sum/average 与数值字段配置；本独立浏览器直接验证 sum，其他聚合由契约测试验证。
- 列表沿用现有字段/展示配置，没有新增列表行为，也没有在本独立浏览器用例里重新覆盖全部字段编辑组合。
- 内置番茄钟保留既有运行及 ZIP 恢复能力；未向 Mochi 开放参数/行为修改和直接新增删除。排序保持其存在，不等于参数修改支持。
- 自定义积木保留既有导入准入、运行、props/state、资源与 ZIP；本轮验证通用事务/撤销不会破坏它们，未开放 Mochi 修改源码/props/schema 或自定义实例增删排序。
- 不含动画积木、账户系统、作品发布/社区、多用户协作冲突解决、ZIP 内执行历史持久化。

## 环境问题记录

图库旧浏览器测试初次执行退出 1，命令为 `NODE_PATH=<已安装 Playwright 路径> GALLERY_SCREENSHOT_DIR=.cache/controlled-edit/gallery-regression node tests/gallery/browser.cjs`，Node v24.22.0。完整脱敏错误如下：

```text
Error: Cannot find module './.generated/custom-block/index.js'
Require stack:
- <workspace>/server/custom-block/protocol.mjs
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at Module.require (node:internal/modules/cjs/loader:1674:12)
    at require (node:internal/modules/helpers:157:16)
    at file://<workspace>/server/custom-block/protocol.mjs:5:25
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '<workspace>/server/custom-block/protocol.mjs' ]
}
```

先只读核对 `server/custom-block/protocol.mjs`、`build-protocol.mjs`、`tsconfig.json` 和已有 `docs/project-package/QA.md`，再用脱敏关键词联网查询 Node 官方维护的 [CommonJS 模块文档](https://github.com/nodejs/node/blob/main/doc/api/modules.md)。官方说明相对路径不存在会抛出 `MODULE_NOT_FOUND`；本仓库缺少的文件恰是 trusted protocol 的生成输出，已确认是测试前置构建缺失。唯一集成负责人顺序完成 `node server/custom-block/build-protocol.mjs` 与 `node tools/project-zip-export/prepare.mjs` 后，原图库命令重跑退出 0；无需更改产品代码、凭据或证书设置。
