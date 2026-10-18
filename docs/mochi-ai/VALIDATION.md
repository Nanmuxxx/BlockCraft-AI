# 验证记录

基线：`main@2d8ffe18f8c4fad787549c8998fc6175c7d9ebdc`，2026-10-18。提交前通过 GitHub 再次核对 main 未变化。

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

限制：未验证真实 DeepSeek 可用性、真实模型建议质量、生产认证或正式 Workshop 接线；生产保持禁用。新 React 面板通过编译，浏览器行为证据对应独立客户端验收页。集成负责人应用 Patch 后仍需正式 Workshop 验收。
