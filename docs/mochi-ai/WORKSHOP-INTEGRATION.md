# Mochi Workshop 正式聊天接线

基线 main `85d4d5de016a2f424cbd49efb6312377dcdc4deb`。本次接线覆盖正式 `/ai-create`，不启用付费请求或应用修改。

## 用户交互与边界

B 模式选中内置或自定义积木后，在原 Mochi 侧栏下方使用“和 Mochi 聊聊”。部署通过可信权限、真实 Provider 和持久金额预算审核后，用户主动发送问题可获得结构化建议；建议卡片显示理由、优先级和操作标记，可定位、追问、忽略。模型不能创建执行计划或调用 Runtime。

当前真实部署缺少认证/项目 ACL 与持久费用适配器，界面显示“可信会话认证与项目权限尚未配置”，聊天和主动建议关闭。检查连接只查询状态，不调用模型；连接失败后可重试，禁用原因不会因选中积木消失。

“主动建议”需要显式开启，开关本身不分析。之后的结构变化或稳定选择可触发一次去抖事件；服务与客户端各自节流/去重。锚点、记录值修改、拖拽布局和 B/C 切换不触发分析。关闭、取消、切换上下文或卸载会中止请求，丢弃过期回复。

保留既有动画/情绪/本地建议/Phase A 预览确认 UI。旧修改输入仍显示未接通；新聊天页脚明确只解释、建议和定位。`modificationsEnabled=false`，不存在建议直接修改源码的通道。

## 正式上下文与启用契约

完整接口与隐私边界见 [README](README.md) 和 [兼容报告](COMPATIBILITY.md)。核心是同一 owner 的精确不可变引用 → 结构 allowlist；custom 没有虚构实体 relation；同一 host 的 setSelection 是唯一定位动作。

服务端最小接线已落入 `createAppServer({ mochi })`。`mochi` 仅由可信部署注入 origin、resolveAccess、enabled、approval 和 reserveBudget；key/model/fetch 与既有服务器共享。没有浏览器开关、环境开关或生产固定身份可绕过门禁。

当前不实现生产认证或账本。部署 reserveBudget 必须对 approved model 的最坏费用做共享持久原子预留，返回严格 true 才调用 Provider；异常、拒绝、5 秒超时或取消零模型 egress。内存 token 限额不等于人民币限额。真实 Provider/权限未验证、没有 Tech Lead 单独批准次数/金额/期限时不得启用。多进程的 consent/并发限制和其他生成接口总费用仍须统一审核。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| `node --test tests/mochi-ai/*.test.mjs` | 40/40，离线 |
| `npm test` | 158/158 |
| Mochi AI + Host + CustomBlock + B/C + owner + motion geometry 合集 | 291/291（包含上方 40 项） |
| `npm --prefix server test` | 23/23，离线 |
| `tsc -b --force` | 通过 |
| `npm run build` | 通过 |
| 生产 Workshop 新浏览器回归 | Chromium 1366×900、390×900；全通过 |
| 现有 CustomBlock Workshop 浏览器回归 | 同上两个宽度；含鼠标/触摸拖拽、props、版本、CRUD、B/C、旧 Demo；全通过 |
| 受保护文件 diff / `git diff --check` | 零受保护文件改动 / 通过 |

新脚本：`NODE_PATH=<Playwright 包目录> node tests/mochi-ai/workshop-browser.cjs`；先运行 `npm --prefix server run build`。使用真实产品页面、原 Host/owner、真实 createAppServer 路由与 Provider 请求/响应校验代码，上游 fetch 仅注入固定离线 envelope。夹具不读取 .env，生成接口也用离线响应；缺省状态使用真实默认禁用路由。测试固定身份与 reserveBudget=true 仅为离线 fixture，绝非生产认证/预算实现。

浏览器覆盖：状态失败后重试恢复、禁用原因持续显示、混合项目参数结构隐私、无同意选择/布局/模式零分析、用户聊天、可信定位、追问/忽略、显式 opt-in 后事件、关闭、费用拒绝未触达 Provider、Provider 失败可见、修改输入仍禁用、无页面横向溢出/iframe/未捕获异常。

新浏览器结果有 10 次离线 Provider fetch（含 2 次模拟失败），12 次离线预算尝试，真实付费调用 0，外网请求 0。手机验证为 Chromium 手机视口与触摸模拟，未验证物理手机、Safari 或真实 DeepSeek 质量。

## 浏览器证据

- [结构化结果](workshop-evidence/report.json)
- [桌面聊天面板](workshop-evidence/panel-1366.png)
- [手机聊天面板](workshop-evidence/panel-390.png)
- [桌面完整 Workshop](workshop-evidence/chat-1366.png)
- [手机完整 Workshop](workshop-evidence/chat-390.png)
- [桌面默认禁用](workshop-evidence/disabled-1366.png)
- [手机默认禁用](workshop-evidence/disabled-390.png)
- [既有 CustomBlock 产品回归结果](workshop-evidence/custom-block-report.json)

截图建议中的“离线验证”表示固定测试数据，不是模型生成质量证明。本次仅提交独立 PR 等待审核；未合并、部署或请求真实 DeepSeek。
