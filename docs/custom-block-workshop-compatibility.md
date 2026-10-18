# PR #25 最终合并兼容记录

2026-10-18 核实 main 为 `2678c5e9c8dca05b79a45f37f0c4104b9cfc5cdc`，已包含 #27。#24 仍 open，准确 head 为 `55fe03765da93582ec4d5878bcf860e32428a138`；已在 #24 留言协调先人工合并，尚未收到回复。本分支显式纳入其准确提交作为审核依赖，没有合并 GitHub PR。应先审核并人工合并 #24，再处理 #25。

## 原子边界

- 产品会话直接使用 #24 的 `createProjectRevisionOwner`，其 `owner.ts` 与 #24 原文件一致。原 Runtime 仅保留冻结的 v1 只读投影；没有第二份可写项目。
- `compareAndSwap(expected, next, authorization)` 同步返回。最终独占边界检查当前可写、授权对象身份（代际）、expected 快照身份及安全整数 revision，随后同步持久化并发布。没有授权检查后 await 再发布的路径。
- 异步 digest、registry、`parseCustomProject` 为提交前准入。产品 wrapper 在 CAS 前同步检查结构和已准入制品的 props/state Schema、实体 capability 引用。未通过准入的新 artifact 仅绑定到候选，CAS 成功才登记；失败不更新 registry/history/receipts。
- builtin CRUD、命令、布局及 custom 参数、混合布局、导入最终进入同一 owner。文件草稿、Inspector 草稿、拖拽起点、microtask 布局批次、planner preview 都保留原授权代际；撤销再授权不复活旧任务。权限变化通知不增加 revision，Mochi 会取消旧 provider/preview。
- B/C 仍使用同一项目和精确 `definitionId + versionDigest`。C 保持 unavailable；没有开放源码执行、Viewer 或付费 API。

## #27 保留

没有修改 #27 的 Overlay、动画控制器、动画 CSS 或锚点定位实现。只将其浏览器脚本的旧 `module:` 测试选择器适配为产品 `builtin:`，并把新证据输出到 checkout 外，保留既有历史截图。真实浏览器验证连续位移、快速重选、滚动锚点、resize、pointer cancellation、无落点遮挡、点击原聊天、reduced-motion 和手机低资源触摸拖动。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 158/158 |
| `npm --prefix server test` | 23/23 |
| `npm run test:mochi-host` | 24/24 |
| 协议、adapter、产品 owner、编译、隔离、生成、Mochi motion 专项 | 460/460，0 失败、0 跳过 |
| `node node_modules/typescript/bin/tsc -b --force` | 通过 |
| `npm run build` | 通过 |
| 真 `/ai-create` Chromium 151.0.7922.34，1366×900 / 390×900 | 两种尺寸均通过 |
| Mochi host、#27 motion、#24 B/C Chromium 回归 | 三组各两种尺寸均通过 |

专项命令：

```sh
node server/custom-block/build-protocol.mjs
node --test tests/custom-block-workshop/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block/*.test.cjs src/integrations/mochi/host.test.cjs tests/ai-quality/*.test.cjs tests/custom-block-compiler/*.test.mjs tests/custom-block-generation/*.test.mjs tests/custom-block-sandbox/*.test.mjs tests/generation/*.test.mjs tests/mochi-motion/*.test.cjs
```

新增生产 owner 的 14 项测试覆盖：参数/布局等待准入期间撤销及撤销再授权；导入撤销后不登记；导入与参数/布局竞争的两种胜出顺序；只读 builtin CRUD/命令/布局拒绝且不写 history/receipt；缺失/伪造授权与同 revision 外来快照；文件草稿、排队布局与 planner 的旧代际拒绝；Mochi 仅权限变化时取消待处理计划及预览。

浏览器生成响应使用离线 HTTP 夹具，外网请求被拦截，付费调用 0。编译专项仅可信 catalogue 测试输入；没有执行生成源码。产品回归包含内置 CRUD、混合拖动、版本切换重新准入、无效摘要、并发导入/布局、过期草稿、旧 Demo、品牌字体/Logo/Mochi 和无横向溢出。

新证据单独归档，不覆盖以前截图：

- [产品报告](custom-block-compat-audit/product-report.json)、[授权 B/C 报告](custom-block-compat-audit/atomic-bc-report.json)
- [Mochi host 报告](custom-block-compat-audit/mochi-report.json)、[#27 动画逐帧报告](custom-block-compat-audit/mochi-motion-report.json)
- [桌面 B](custom-block-compat-audit/workshop-b-1366.png)、[手机 B](custom-block-compat-audit/workshop-b-390.png)
- [桌面 C](custom-block-compat-audit/workshop-c-1366.png)、[手机 C](custom-block-compat-audit/workshop-c-390.png)
- [Mochi 桌面](custom-block-compat-audit/mochi-motion-1366.png)、[Mochi 手机](custom-block-compat-audit/mochi-motion-390.png)

当前会话仍只在内存保存。#24 的同步 persist 契约不承诺跨进程事务或异步远端存储。仅提交兼容修复供代码审核，不自动合并或部署。
