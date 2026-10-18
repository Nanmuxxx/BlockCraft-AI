# 验证记录

## 当前正式 Workshop 聊天接线

最新实现与验证以 [WORKSHOP-INTEGRATION.md](WORKSHOP-INTEGRATION.md) 为准：混合 custom 上下文现已使用可信只读投影，正式面板与服务端路由已接线但默认禁用，新增持久费用适配器硬门禁。Mochi AI 40/40、专项合集 291/291、npm test 158/158、server 23/23、TypeScript 与构建通过。桌面/手机模拟浏览器证据见新报告；下方 #26 尚未接线的结论是历史记录，已被本次接线替代。真实付费调用仍为 0。

## #24/#25 合并后的 Ready 复核

2026-10-18：安全合入 `origin/main@94262b3307274b2bae0ad5f7782cd7088228574f`（包含 #24/#25/#27），保留原 PR 提交历史，自动合并无文本冲突。生产 Workshop、Mochi Host、动画、Runtime、CustomProjectV2 owner 与服务端入口相对该 main 均零改动。只新增回归与说明。

| 检查（本轮重跑） | 结果 |
| --- | --- |
| `node --test tests/mochi-ai/*.test.mjs` | 32/32，全部离线 |
| `npm test` | 158/158 |
| `node --test tests/custom-block-workshop/*.test.cjs tests/custom-block-bc/*.test.cjs` | 87/87 |
| `npm run test:mochi-host` | 24/24 |
| `npm --prefix server test` | 23/23，注入 fetch |
| `node --test tests/mochi-motion/geometry.test.cjs` | 3/3 |
| `./node_modules/.bin/tsc -b --force` | 通过 |
| `npm run build` | 通过（TypeScript + Vite） |
| `git apply --check docs/mochi-ai/patches/server.patch` | 通过；未应用 |
| `git diff --check`（含暂存合并结果） | 通过 |

真实 #25 Host 回归在 builtin-only 项目中完成聊天、定位、主动选择事件与清理，断言同一 `runtime.customProject` 的身份和快照不变。新增混合上下文测试通过同一 owner 安装惰性 fixture artifact，分别选择内置与 custom：桥接均在请求前拒绝 `INVALID_INPUT`，API 调用为 0，owner/快照/授权不变；不伪造 relation 或宣称混合 v2 AI 可用。新增实际 integration 装配 + localhost HTTP 测试：有测试 grant/key 仍默认 disabled，即便显式 enabled 但没有可信 resolver 仍返回 503，真实模型 fetch 为 0。所有测试均未读取生产密钥或调用真实 DeepSeek。

权限部署和持久人民币预算尚不具备生产支持；`modificationsEnabled=false`，无代码修改接线。本轮不修改生产 UI，因此未重跑正式 Workshop 浏览器验收；下方独立离线浏览器证据是历史记录。当前没有正式 AI Workshop 端到端证据。完成本轮检查后按用户授权转 Ready for review，等待 Tech Lead；不合并、部署或启用付费 API。

## Tech Lead 反馈后的兼容复核

2026-10-18：通过 GitHub 读取最新 `main@2678c5e9c8dca05b79a45f37f0c4104b9cfc5cdc`（已包含 #27），校验签名提交 SHA 后导入既有 worktree 并合入 PR 分支，无文本冲突。未合并 PR 至 main。具体语义冲突与权限阻塞见 [COMPATIBILITY.md](COMPATIBILITY.md)。

| 检查（同步 main 后重新运行） | 结果 |
| --- | --- |
| `node --test tests/mochi-ai/*.test.mjs` | 30/30，全部离线 |
| `npm test` | 157/157，包含现 main 的动画 UI 断言 |
| `npm run test:mochi-host` | 24/24 |
| `npm --prefix server test` | 23/23，注入 fetch |
| `node --test tests/mochi-motion/geometry.test.cjs` | 3/3 |
| `npm run build` | 通过（TypeScript + Vite） |
| `git apply --check docs/mochi-ai/patches/server.patch` | 通过；未应用 |
| `git diff --check` | 通过 |

新增 3 项有行为意义的回归：实际 main 的 host/Runtime 对接独立 conversation（聊天、定位、主动选择事件、忽略锚点/模式通知、卸载、零 Runtime 写入）；缺少部署 resolver 时客户端伪造权限仍返回 503；自报身份不能认证或越过可信项目绑定（401/409），均零上游调用。独立聊天、去重、冷却、隐私、预算、取消、错误及默认禁用的原有测试继续通过。修改能力始终 false。

本轮没有 UI 产品接线或生产代码变更，未重新运行生产页面浏览器验收；下述原始离线浏览器证据保留，不能冒充最新正式 Workshop/v2 端到端证据。未运行动画浏览器脚本，动画仅做上述现有单测和构建回归。真实 DeepSeek 请求 0；没有合并、部署或生产启用。

## 首轮离线证据（历史记录）

初始基线：`main@2d8ffe18f8c4fad787549c8998fc6175c7d9ebdc`，2026-10-18。以下为首次交付记录，不代表当前 main 未变化。

| 检查 | 结果 |
| --- | --- |
| `node --test tests/mochi-ai/*.test.mjs` | 27/27 |
| `npm test` | 157/157 |
| `npm run test:mochi-host` | 24/24 |
| `npm --prefix server test` | 23/23 |
| `npm run build` | 通过（TypeScript + Vite） |
| 两份 `git apply --check` | 通过；未应用 |
| `git diff --check` | 通过 |

浏览器：Codex 内置浏览器，独立 localhost 离线验收页；使用真实 client → HTTP → service → Provider 请求构造/校验代码，上游 fetch 明确替换成 fixture。

- 聊天：输入应用优化问题，收到带 blockId / 理由 / 优先级 / 操作标记的建议；点击定位 form。
- 继续交流：用户追问进入下一次聊天，重复建议去重。
- 主动流程：用户勾选开关后，新增结构字段事件触发新建议；不是定时轮询。
- 忽略后卡片移除，关闭主动模式；服务失败展示安全错误，禁用后发送不可用。
- 本次证据包含 4 次 fixture 调用（聊天、追问、事件、模拟失败），真实调用 0 次；`browser.json` 中业务记录/密钥哨兵均不存在。
- 三张截图使用完整页面截图，包括页面的离线标记和交互结果。

限制：未验证真实 DeepSeek 可用性、真实模型建议质量、生产认证或正式 Workshop 接线；生产保持禁用。新 React 面板通过编译，浏览器行为证据对应独立客户端验收页。旧 Workshop Patch 已移除；将来批准接线后仍需正式 Workshop/v2 浏览器验收。
