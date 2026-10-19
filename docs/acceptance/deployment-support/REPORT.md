# 魔塔冻结候选：独立部署支持 QA

检查日期：2026-10-19（Asia/Shanghai；原始日志使用 UTC）。

- 产品 SHA：`4a95cae50f772cd242d932cdbd93366381d1df74`，未混入 Draft #54/#55/#56/#61。
- 独立源码快照：GitHub API 精确 SHA zipball；本机 git fetch 遇连接重置，未切换或改动任何已有工作树。
- 本地环境：Windows、Node v24.19.0、npm 11.17.0、Chromium 153.0.8010.12；viewport 1440x900 / 390x900。
- 原部署 Owner 保留 Dockerfile/.dockerignore/ms_deploy.json/workflow/交接文档及魔塔环境所有权；本提交仅新增独立测试与证据。
- 边界确认请求已发 #57 issuecomment-6270178810；Supervisor 已在 issuecomment-6270371611 的 D4 明确授权上述新增目录及冻结 SHA 离线检查。Owner 的活跃 branch/worktree、编辑文件与部署资料尚待回复；这不阻塞已授权离线检查。未接管部署权限。

## 结果

| 项目 | 本地/CI 状态 | 实际证据 | 魔塔公网状态 |
|---|---|---|---|
| 干净依赖安装、TS/Vite 生产构建 | PASS | commands.json、install.log、build.log，退出码 0 | BLOCKED：无地址/平台构建日志 |
| 后端/主测试/生成测试 | PASS | server.log 37/37；root.log 205/205；generation.log 34/34 | NOT TESTED |
| Linux Docker 构建及运行 | PASS | Run 39273438702 精确产品 SHA；docker/* 日志 | BLOCKED：无平台实例 |
| 运行时打包 | PASS | docker/esm-resolution.log：15 files；最终镜像模块实际导入 | NOT TESTED |
| health/SPA/静态资源/端口 | PASS | Docker health=healthy；0.0.0.0:7860；7 个同源资源；SPA 刷新；路径穿越400，未知资源404 | BLOCKED |
| 编辑器、Mochi、核心 UI | PASS | browser-report.json；editor-1440.png、editor-390.png；实际生产构建、本地 HTTP | BLOCKED |
| 已验证离线番茄钟 | PASS | 双尺寸 B 选择/Inspector、C 开始/暂停/重置、3次 B/C 切换；runtime-*.png | BLOCKED |
| 刷新、重访与基本失败处理 | PASS | 双尺寸2次刷新后重入；实际401保留原应用；denied-*.png | BLOCKED |
| 明显运行时错误 | PASS（本次覆盖范围） | pageerror=0，非预期HTTP/console错误=0；唯一预期401来自显式拒绝测试 | BLOCKED |
| 默认付费调用防护 | PASS（本次入口） | v1/v2匿名及伪造Bearer/同源/转发头均401；Mochi status disabled、analyze503；egress.log为空；服务端fetch尝试0 | BLOCKED |
| 真实付费模型/可信身份/持久预算 | NOT TESTED | 未授权，不发起；不得把离线通过当在线AI上线证明 | NOT TESTED |
| 文档与实际部署入口一致性 | FAIL | server/README.md仍称仅127.0.0.1/无认证/缺key503，实际生产0.0.0.0与默认401；根README缺失 | NOT TESTED |
| 公网HTTPS、平台路由/iframe、平台重启与回滚 | NOT TESTED | 没有公网地址和实例证据 | BLOCKED |

浏览器直接访问实际本地服务，未 Mock API 响应；显式生成失败请求实际返回401。服务端从白名单环境启动，只注入合成假密钥，并预加载 deny-egress.mjs 阻断/记录 fetch。离线流程 generation POST=0；每个尺寸随后单独执行一次预期401测试，验证原番茄钟仍在。浏览器所有非本地请求均阻断，实际外部请求=0，服务端fetch尝试=0，真实模型调用=0。此结论不覆盖未来更改或魔塔平台配置。

刷新验证的是入口仍正常、可以重新加载离线示例，不声称应用状态跨刷新持久化。番茄钟 ZIP 导出明确不支持，错误反馈已验证；不是ZIP成功验收。Gallery、任意TSX、真实Mochi修改能力均不在此次验收范围。

## Docker 可验证证据

Run：https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39273438702

Artifact：https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/39273438702/artifacts/12196241754

workflow_dispatch 只执行已有验收工作流；未部署、推镜像到魔塔或修改源码。运行完成于2026-10-19 22:57:05 Asia/Shanghai。Artifact有平台保留期限，本提交保存其原始文件。docker/summary.txt绑定SHA。没有把历史PR CI结果冒充当前候选。

## 正确的冻结候选启动条件

- 构建用完整根依赖：`npm ci && npm run build && npm --prefix server run build`；不要在构建前省略devDependencies中的TypeScript/Vite。server无需单独npm install。
- 已有Dockerfile使用Node24 bookworm-slim；启动命令 `node server/index.mjs`，`NODE_ENV=production`，`PORT=7860`，监听0.0.0.0。Docker构建已包含server/.generated及静态dist。
- 离线展示不需要真实密钥、身份服务或付费账本。不要通过设置密钥来修复预期的401。
- `PUBLIC_ORIGIN`仅接受不带路径/末尾斜线的精确HTTP(S) origin；当前关闭的生成路径并不需要它来完成离线演示。魔塔实际反代/子路径/iframe行为仍待公网验证。
- 本地开发Vite默认代理127.0.0.1:3001；不要把Vite开发服务或npm preview当作已验证的魔塔生产启动方案。

## 阻塞、复现与交接

1. **公网 BLOCKED**：Owner最新汇报public_url=NONE。请提供实际地址、部署SHA/image digest、脱敏构建/启动摘要、回滚目标。地址交付后从独立浏览器复验表中7项公网要求；当前无法出具公网PASS。
2. **Owner 资料待补充**：请确认当前活跃branch/worktree与正在编辑的文件。D4 已明确授权 Support 的新增测试/证据目录，无需等待此回复才继续离线检查；未修改其任何部署文件，产品文档修复仍待具体文件交接。
3. **文档 FAIL**：对比精确SHA的server/README.md第4、21、35行附近与server/index.mjs的authorizeGeneration和CLI入口。建议文档Owner统一Node24/生产启动/401默认关闭说明并补根部署入口。
4. **交接提交不可公开复现**：`gh api repos/Nanmuxxx/BlockCraft-AI/commits/5936f91c309aa268f79d79b315bea58c147948a9`返回422 No commit found。Owner请发布该交接提交/PR或提供可读取的不可变证据；不据此否定其本地工作。
5. **付费研发环境**：身份服务、单实例POSIX持久卷、0700/0600、跨重启保存与账本生命周期仍需相应Owner和独立QA证明；无需因此阻塞离线展示。PR#61生命周期由Core/Gateway原QA负责，此次未重复审核。
6. **Tech Lead**：明确初赛是否包含ZIP导出。当前生产服务故意不开放本地ZIP接口，番茄钟v2本身明确拒绝导出；若演示脚本需要ZIP，应由原Owner提供已验证且获批准的方案。

本轮没有发现需要立即修改冻结产品代码的安装/构建/启动故障；仅新增证据，无产品修复、无合并、无部署、无预算/真实账本/密钥读取或变更。

## 重现

先分别准备精确产品 SHA 的独立检出及本证据 PR 的检出。以下在产品检出目录运行；测试脚本使用证据检出的绝对路径，因此无需改动产品检出：

```powershell
npm ci --no-audit --no-fund
npm run build
npm --prefix server test
npm test
npm run test:generation
# 测试工具依赖：Playwright及Chromium应安装在独立工具目录；不修改产品lockfile。
$env:QA_SOURCE_DIR = (Get-Location).Path
$env:QA_PLAYWRIGHT_MODULE = 'C:/path/to/separate-tools/node_modules/playwright'
$env:DEPLOYMENT_QA_EVIDENCE = 'C:/path/to/output'
node 'C:/path/to/evidence-checkout/tests/deployment-support/production-qa.cjs'
```

保持本机17860端口空闲。此脚本仅启动/结束其自身的本地子进程。测试所需Playwright不是仓库声明依赖，本次复用了已有独立工具目录。commands.json记录实际安装/测试命令和退出码；截图索引见SCREENSHOTS.md，文件校验见SHA256SUMS。
