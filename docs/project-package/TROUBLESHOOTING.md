# 脱敏排障记录

本任务不读取认证凭据，不通过试探性远端写入排障。命令均在本地执行。

## 容器根目录不是仓库
- 命令：在工作区容器执行 `pwd && git status --short && git branch --show-current && git log -1 --oneline`。
- 完整错误：`fatal: not a git repository (or any of the parent directories): .git`，退出码128。
- 版本：Git 2.50.1 (Apple Git-155)。
- 只读检查：容器含多个 Git 工作树；实际 main 在 `BlockCraft-AI-project-json-20261022`。确认该工作树日志及状态后，从精确 a77cf25 创建独立分支/工作树。
- 联网：连接搜索服务 transport 不可用；使用 Google 对官方 Git 文档检索，并直接读取官方文档 https://git-scm.com/docs/git ，核对工作目录与 `.git`/GIT_DIR 语义。验证：子工作树 status、log 成功。

## 浏览器测试缺 Playwright
- 命令：`node -e "console.log(require.resolve('playwright'));const {chromium}=require('playwright');console.log(chromium.executablePath())"`。
- 完整错误（路径仅保留工作树相对位置）：
```
node:internal/modules/cjs/loader:1568
  throw err;
  ^
Error: Cannot find module 'playwright'
Require stack:
- BlockCraft-AI-project-package-v1/[eval]
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at [eval]:1:21
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:451:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:449:60)
    at evalFunction (node:internal/process/execution:283:30)
  code: 'MODULE_NOT_FOUND',
  requireStack: [ 'BlockCraft-AI-project-package-v1/[eval]' ]
Node.js v24.22.0
```
- 已确认原因：共享 node_modules 有项目编译依赖但不含 playwright；只读发现同工作区已有 Playwright 和缓存 Chromium。
- 联网：Google 检索 `Node.js MODULE_NOT_FOUND require.resolve NODE_PATH site:nodejs.org`，官方 https://nodejs.org/api/modules.html 核对 CommonJS/NODE_PATH 解析规则。
- 最小修复：测试进程设置 NODE_PATH 指向已存在的 `modelscope-json-release-20261022/node_modules`，PLAYWRIGHT_CHROMIUM_EXECUTABLE 指向缓存 chromium-1248。未下载、安装或修改共享依赖。验证由 QA 浏览器测试完成。

## 已知文件不存在的只读定位
- 新工作树尚无 node_modules；ls 报不存在，退出1。确认源工作树的依赖链接后建立同目标本地 symlink，不修改共享依赖内容。
- 读取 tsconfig.app.json 报不存在，退出1；rg 定位本项目使用 tsconfig.json。并非编译失败。
- Agent 自己的浏览器定位与编译前置失败详见 QA.md；修复后必须保留通过结果。

## 长资源文本扫描停滞
- 命令：`node --test tests/project-package/*.test.cjs`；Node.js v24.22.0。运行 202177ms 后人工中断，退出1；24通过、1取消、0断言失败。
- 中断输出：`tests/project-package/format.test.cjs (202166.515791ms)`，`Promise resolution is still pending but the event loop has already resolved`。此前通过至版本校验组，长资源组未结束；此消息是中断后的测试框架结果。
- 只读核查：仅 format.test 子进程仍运行；安全扫描的无边界 scheme 正则可能在每个 Base64 字母处重新扫描余串。经代码审查确认该路径存在平方级扫描。
- 联网：Google 检索 `site:v8.dev non-backtracking regexp excessive backtracking`，官方 https://v8.dev/blog/non-backtracking-regexp 说明默认 Irregexp 回溯及实验性 fallback 限制；没有启用实验引擎或修改全局运行参数。
- 最小修复：有界 scheme 匹配；合法图片 dataURL 解码后检查二进制元数据，跳过 Base64 文本扫描。补充长文本/资源回归；最终测试结果见 QA.md。

## 发布阶段 GitHub CLI 不可用
- 命令：`gh --version`（前序只读 `git ls-remote origin refs/heads/main` 成功）。
- 完整错误：`zsh:1: command not found: gh`；退出127。
- 环境：macOS arm64，zsh 5.9，Git 2.50.1；gh 未能启动，因此无可报告的 gh 版本。
- 只读检查：`command -v gh` 无结果；已连接 GitHub 工具读取仓库确认 admin/push 权限。
- 官方检索：https://github.github.com/gh-aw/setup/cli/ 及 https://github.com/cli/cli/issues/6619 说明命令缺失/PATH 的区别。未安装 CLI、未读取凭据，改用现有 GitHub 连接器；此前版本已通过该连接器合并。
- 本地整合：`git merge origin/main --no-commit` 退出1为明确的文本冲突，merge-base91bf7c7；保留两边测试脚本及资源/计划能力。属常规合并结果，并非认证问题。
- 提交前 `git diff --cached --check` 首次退出2，指出 security.ts EOF 多一空行；仅收尾空白修复并更新哈希，复查通过。
