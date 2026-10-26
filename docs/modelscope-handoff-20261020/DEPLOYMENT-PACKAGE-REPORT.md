# INITIAL-MS-20261020 — 备份工程准备证据

技术准备 Backup Owner：Supervisor。平台授权及实际网页执行人：项目负责人。原部署 Owner 负责已有成果交接，不推断其未工作。

## 不可变首次部署候选

- Source：`https://github.com/Nanmuxxx/BlockCraft-AI`
- Source SHA：`4a95cae50f772cd242d932cdbd93366381d1df74`
- Source tree：`b19a52f8cdc82aa137b57a1396f996b6becfda3f`
- 本轮 `git ls-remote origin refs/heads/main` 仍返回此 SHA。
- ZIP：`BlockCraftAI-main-4a95cae-source-only.zip`，405216 bytes，147 个普通文件，无额外包裹目录。
- ZIP SHA256：`0aa88413cbe9d5611a963f1b8c7ecc87405b2b5586c9ea92a156c30b96b16812`
- 逐文件 Git blob SHA1 / SHA256 / bytes：`MANIFEST.json`；纯 SHA256 清单：`SOURCE-SHA256SUMS`。
- ZIP payload 均由 `git cat-file blob` 读取指定 tree 中对象；没有读取任何工作区 `.env`、真实密钥或账本。

该 ZIP 是上传用**源码包**，不是可直接运行的镜像或静态 dist。若网页不支持 ZIP 自动解包，需在 Owner 本机解压后上传内容，根目录必须直接看到 Dockerfile；不要把 ZIP 当作唯一文件上传。网页上传保留目录树能力仍需 Owner 根据实际 UI 确认。后续 Studio 首次 commit SHA 与 GitHub source SHA 可能不同，应同时记录源 SHA、ZIP hash、平台 commit，不声称相同。

## 文件清单边界

根文件：`Dockerfile`、`.dockerignore`、`ms_deploy.json`、`package.json`、`package-lock.json`、`index.html`、`vite.config.ts`、`tsconfig.json`。

源目录：完整 `src/**`、`public/**`，以及 Docker allowlist 的 `server/package.json`、`server/tsconfig.json`、`server/index.mjs`、`server/ai-abort.mjs`、`server/trusted-interactive.mjs`、`server/aiGenerationPrompt.mjs`、`server/aiGenerationQuality.mjs`、`server/mochi-ai/**`、`server/paid-gateway/**`、`server/project-export/**`。

未打包 `.git`、任何 `.env*`、`node_modules`、`dist`、`.generated`、日志、PEM/KEY、平台认证文件、预算账本、其他 PR 或本地未提交内容。源码中的类型、单元测试和离线示例保持精确原样。`server/project-export/local-http.mjs` 有开发模式下延迟加载工具的代码，但该导出接口在生产路径不安装；Docker 原本也未包含其开发工具。生产实际拒绝已验证；不宣称本包是可运行全部仓库测试或启用 dev:export 的完整检出。

静态检查：0 符号链接、0 绝对/越界路径、0 常见 DeepSeek/OpenAI Key、GitHub PAT、AWS access key 或 private-key header 模式命中。该模式检查不能数学证明所有可能格式的秘密均不存在；未扫描 Owner 环境或平台 Secrets。

## 构建及启动契约

- `Dockerfile` 两阶段 `node:24-bookworm-slim`。
- 构建：`npm ci` → `npm run build` → `npm --prefix server run build`；Vite/TypeScript 是构建必需 devDependencies，不提前裁剪。
- Docker 自行生成前端 `dist` 与 `server/.generated`；无需 Owner 本机构建。
- 生产：`NODE_ENV=production`、`PORT=7860`；`node server/index.mjs`；监听 `0.0.0.0:7860`。
- `USER node`；health 路径 `/api/health`。
- 根 `ms_deploy.json`：Docker、`platform/2v-cpu-16g-mem`、port 7860。平台当前资源可用性/收费与账号资格须网页确认；本准备不授权收费资源。
- 此首次候选**不注入任何 Secret**，不填写 `DEEPSEEK_API_KEY`，不设真实鉴权/session/预算配置；Mochi 在线生成保持默认拒绝。

## 本轮实际执行的无密钥验证

隔离工作目录：`verification-success-candidate/build-input`。环境白名单传递 PATH、独立空 HOME/npmrc/cache；未继承 Owner Key、token、真实预算变量或常规 npm 用户配置。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Node / npm | v24.22.0 / 11.19.1 | node-version.log / npm-version.log |
| 干净 npm ci | exit 0 | npm-ci.log |
| TypeScript / Vite production build | exit 0 | frontend-build.log |
| server model build | exit 0 | server-build.log |
| 按 Docker COPY 规则模拟最终 runtime | 15 个 ESM 文件全部解析/导入 | runtime-results.json |
| 生产 CLI（cwd=/tmp） | health、根页面、双 SPA、入口 assets 200 | runtime-results.json / runtime-stdout.log |
| v1 / v2，匿名与伪造 Bearer / Origin / XFF | 4 次均 401 UNAUTHORIZED | runtime-results.json |
| Mochi status / production export | disabled / 404 | runtime-results.json |
| 子进程 outbound fetch | 0 尝试；预加载 deny-egress 强制拒绝 | runtime-egress-attempts.log 空文件 |
| 真实 Key / DeepSeek | 未注入 / 0 次调用 | 白名单启动、空 key、deny-egress |

第一轮验证脚本曾把 user/global npmrc 都指向 `/dev/null`，npm 因配置重复装载拒绝启动；日志保留在 `verification/`。修正为两个独立空 npmrc 后执行以上全部命令。此为验证脚本配置问题，未修改任何候选源码。

**本机没有 Docker executable，因此以上 runtime 是文件布局模拟，不是独立 Linux 镜像构建，也不是浏览器或魔塔公网验收。** 精确 SHA 的 Docker CI 可另核 run `39273438702`，公网仍待首次部署授权和执行。

## #62 / #65 对照

- PR #62 HEAD `a087a161eee1e12f03b6084f6ed799711751466e`，base 是候选 SHA；测试及证据新增。其 REPORT 记录相同 SHA 的本地生产浏览器验收和 Docker CI；不等于公网 PASS。
- PR #65 HEAD `af770ab9fa1a9e673bcc4d974660a7aeaead3589`，base 是候选 SHA；文档及保存日志，不修改产品/部署配置。无需为首次无密钥部署先合并这两个 PR。
- 当前 main 不含待审 Gallery #55 或安全组合 #61/#63；包不混入这些未验收变更。
- 此候选可用于无密钥离线稳定展示和平台首次构建验证，**不能满足真实 DeepSeek P0**；真实 AI 升级需另一个精确组合 SHA、安全审查、费用/调用次数方案与负责人明确批准。

## 未执行及剩余阻塞

1. 尚未上传、git push 魔塔、触发平台构建、部署、重启、公开切换或修改权限/Secrets。
2. 必须 Tech Lead 独立核验 SHA/ZIP 清单/构建证据，随后负责人一次性明确批准目标 Studio 的首次无密钥部署。
3. Studio 页面上传是否递归/支持解包、实际 Git URL/default branch、Docker 资格/实名认证/阿里云绑定、资源费用均应按实际 UI 核对。不要把猜测的按钮文案写成已验证操作。
4. 首次部署没有历史线上版本，失败时没有“退回上一公网 SHA”。应保留首次失败日志、停止失败构建/实例，再在独立候选上修复；后续重新上传/构建遵守批准范围。
5. 批准后 Owner 执行页面最少操作；QA 再验真正实例：HTTPS 可达、health、同源资源、B/C 离线开始/暂停/重置、刷新/错误保留、无密钥生成拒绝、零真实付费。记录平台 revision、公开 URL 与证据。

## 与完整 main 及另一部署包的明确区分

完整 main tree 有 667 个 tracked files；本最小包 147 个，排除 520 个。被包含文件修改数 0；工作区/非 tracked 新增文件数 0。排除主要为 docs 347、tests 121、tools 22、server 中 Docker 不纳入的16个文件，另含CI/报告/仓库元数据配置。详尽差异清单见 `FULL-MAIN-DIFFERENCES.json`。这是精确 main 的最小 Docker 构建上下文，不是完整仓库副本。

Supervisor 另收到人类报告：郑相包 SHA256 `990bc7b1424cc415dea76233dbb5d0944c5494a6e3e20825bba48890201702dc`，平台 `master` commit `ed01b2a9329b486cfb841615e287c481c8b562fc`，2 rename / 163 add / 0 delete。本工程师未收到该包的字节/逐文件清单，也未读取平台对应 commit，故**不能声称已核验郑相包，不能用本包测试结果替代该包验收**。本备份 ZIP hash 不同，应保持两套来源独立，不覆盖已上传文件、不触发重复构建；由 Supervisor/Tech Lead 收齐证据后明确唯一候选及执行负责人。
