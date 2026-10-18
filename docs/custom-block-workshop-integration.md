# CustomBlock v2 Workshop 产品接线

本轮将 PR #23 的适配层接入真实 `/ai-create` Workshop。2026-10-18 核实 #23 已合并，最新 main 为 `2d8ffe18f8c4fad787549c8998fc6175c7d9ebdc`；本分支直接基于该提交，无需改写历史。独立工作树为 `BlockCraft-AI-custom-block-workshop`，分支为 `feature/custom-block-workshop`。

## 唯一状态与接线

`createAppRuntime` 在创建会话时建立唯一 `CustomProject` v2 owner。原 v1 Runtime API 读取冻结的 `{revision, ...project.base}` 投影；内置结构命令、CRUD、布局和 custom 参数/布局共享 revision、通知与原子提交边界。不存在第二套可写 v1 项目。history/receipts 只存事务元数据；custom 写入使旧全量 undo 失效，保留幂等 receipts。

`customProjectSession.ts` 的公开 CAS 重新解析完整 v2，异步校验前复制候选，前后检查快照身份与 revision。builtin 同步提交保留 custom 数据，校验全局 ID 与 renderOrder。registry 只保存已重算摘要、不可变的制品输入，不是项目状态源。会话仍为内存会话，刷新清空，未增加跨刷新存储承诺。

Workshop 使用 PR #23 的 `CustomBlockCanvas`、`CustomBlockInspector`、`CustomBlockRunSurface`。B/C 均按同一 renderOrder 组合 builtin/custom。C 的内置插槽使用抽取的 **BuiltinBlockRenderer 单块渲染器**，不会每块重复挂载完整 AppRenderer；原 AppRenderer 保留组合入口。内置 Inspector 沿用原组件。

Mochi 选择集合与锚点扩展到 custom，但 custom 修改计划仍拒绝 `CUSTOM_SCOPE_UNAVAILABLE`。epoch/revision 失效与单 host 生命周期保留。手机窄画布发现导入新卡片后贪心布局碎片导致卡片丢失，现只在有卡片未放置时按原 stack 顺序回退单列；不改原拖拽 hook，不在 resize 时写业务坐标。

## 制品导入和版本生命周期

B 模式新增“导入自定义积木”JSON 文件入口，输入形状：

```ts
{ instance: { id, definitionId, versionDigest, props }, artifact: RegisteredArtifact }
```

源码作为惰性 JSON 字符串登记。文件读取前捕获 baseRevision 与原精确引用；用户明确确认添加或替换后，唯一 owner.install 校验普通 JSON、严格键、摘要、完整项目、props/state，再原子发布。4 MB 上限。新建不能覆盖已有 ID；替换需要旧 definitionId/versionDigest 匹配。校验期间发生任何 builtin/custom 提交均拒绝，不能部分登记。换 definition/digest 清除旧 custom state。

`useWorkshopAdapter` 以精确 reference 集合建立准入签名。会话中新 definition 或版本变更会隐藏旧 adapter、重新准入 Manifest，取消过期 effect；准入期间 revision 改变则重试当前快照。普通同版本编辑复用 adapter。Inspector 草稿过期需重新载入，不自动改 baseRevision。

## C 模式与隔离 Viewer 依赖

本轮没有接入执行后端。产品 C 显示精确 definitionId + versionDigest 对应的 **unavailable / 运行暂不可用**。PR #23 的 pending-build 观察值协议及伪 runnable 拒绝继续保留；产品没有可信构建状态服务，因此不伪造 pending/runnable。

正式接线依赖见 [原 Viewer 合约](custom-block-bc-integration.md#c-模式与-agent-b-依赖)：可信构建证明、bundleDigest、执行许可、独立跨站 Viewer 与执行隔离、会话绑定、生命周期和经认证消息协议。源码摘要合法不等于允许运行。当前没有动态 import、eval、iframe/srcdoc/blob 或主 React DOM 执行生成源码的路径。测试制品源码为执行即抛错的字符串，始终未执行。

## 验证与证据

| 检查 | 结果 |
| --- | --- |
| `npm test` | 158/158 |
| `npm --prefix server test` | 23/23 |
| 全量专项（下方命令） | 414/414，0 失败、0 跳过 |
| `./node_modules/.bin/tsc -b --force` | 通过 |
| `npm run build` | 通过 |
| 真 `/ai-create` Chromium，1366×900 / 390×900 | 均通过；桌面鼠标、手机 CDP touch 手势 |
| 原 Mochi Chromium，1366×900 / 390×900 | 均通过 |

```sh
node server/custom-block/build-protocol.mjs
node --test tests/custom-block-workshop/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block/*.test.cjs src/integrations/mochi/host.test.cjs tests/ai-quality/*.test.cjs tests/custom-block-compiler/*.test.mjs tests/custom-block-generation/*.test.mjs tests/custom-block-sandbox/*.test.mjs tests/generation/*.test.mjs
NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/custom-block-workshop/browser.cjs
NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/mochi/browser.cjs
```

编译专项只编译已有可信 catalogue 测试夹具，未挂载或执行不可信源码。测试使用本机已有离线依赖，未新增 package/lockfile 依赖。

产品浏览器覆盖：混合选择/拖动与 B/C 位置保留、宿主 props Schema 拒绝/保存、过期草稿、摘要篡改、导入与布局提交并发、挂载后新 definition、同 definition 新 digest/Schema、内置 Inspector 字段编辑、表单/列表创建修改删除与统计联动、每块 builtin 仅渲染一次、精确版本 unavailable、无 iframe/源码执行、Logo/字体/Mochi 与无横向溢出；首页→澄清→旧 Demo→任务新增→B/C 往返也在两种尺寸实际通过。

生成 HTTP 响应为离线 club spec，其他外网/API 请求被拦截，付费调用为 0。这里证明产品接线，不代表 DeepSeek 自创新功能或隔离交互已经交付。Mochi 专项复用受信任的测试 planner，产品入口仍禁用未接入的 AI 修改服务。

证据均为浏览器实际截图，长页使用 fullPage 截图，视口高度仍为 900：

- [产品机器报告](custom-block-workshop-audit/browser-report.json)、[Mochi 报告](custom-block-workshop-audit/mochi-report.json)
- [桌面 B](custom-block-workshop-audit/workshop-b-1366.png)、[手机 B](custom-block-workshop-audit/workshop-b-390.png)
- [桌面 C](custom-block-workshop-audit/workshop-c-1366.png)、[手机 C](custom-block-workshop-audit/workshop-c-390.png)
- [旧 Demo 桌面](custom-block-workshop-audit/legacy-demo-1366.png)、[旧 Demo 手机](custom-block-workshop-audit/legacy-demo-390.png)
- [Mochi 桌面](custom-block-workshop-audit/mochi-integrated-1366.png)、[Mochi 手机](custom-block-workshop-audit/mochi-integrated-390.png)

已检查视觉：奶油橘、Logo、Pixelify Sans、像素猫与桌面/手机布局保留。未改 AppSpecCanvas、AppSpecInspector、useSnapCanvas、品牌资源或旧 Demo 源码。提交仅产品接线、最小布局修复、测试与此处证据；无密钥、dist、node_modules、编译缓存、浏览器 profile 或临时日志。

## 精确变更文件（27 个）

- `docs/custom-block-workshop-audit/browser-report.json`
- `docs/custom-block-workshop-audit/legacy-demo-1366.png`
- `docs/custom-block-workshop-audit/legacy-demo-390.png`
- `docs/custom-block-workshop-audit/mochi-integrated-1366.png`
- `docs/custom-block-workshop-audit/mochi-integrated-390.png`
- `docs/custom-block-workshop-audit/mochi-report.json`
- `docs/custom-block-workshop-audit/workshop-b-1366.png`
- `docs/custom-block-workshop-audit/workshop-b-390.png`
- `docs/custom-block-workshop-audit/workshop-c-1366.png`
- `docs/custom-block-workshop-audit/workshop-c-390.png`
- `docs/custom-block-workshop-integration.md`
- `src/components/app-builder/AppSpecWorkshop.tsx`
- `src/components/app-builder/app-spec-workshop.css`
- `src/components/app-renderer/AppRenderer.tsx`
- `src/components/blocks/blocks.test.cjs`
- `src/components/blocks/snap-layout.ts`
- `src/custom-block/project.ts`
- `src/integrations/custom-block-bc/CustomBlockImport.tsx`
- `src/integrations/custom-block-bc/adapter.ts`
- `src/integrations/custom-block-bc/useWorkshopAdapter.ts`
- `src/integrations/mochi/WorkshopMochi.tsx`
- `src/integrations/mochi/host.ts`
- `src/model/appRuntime.ts`
- `src/model/customProjectSession.ts`
- `tests/custom-block-workshop/browser.cjs`
- `tests/custom-block-workshop/owner.test.cjs`
- `tests/mochi/browser.cjs`
