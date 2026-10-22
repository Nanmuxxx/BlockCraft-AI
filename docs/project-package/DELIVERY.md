# 项目包 v1 本地交付

工作树 `/Users/nanmuxun/BlockAI/BlockCraft-AI-project-package-v1`，分支 `feature/project-package-v1`，固定基线 `a77cf25c9e1547fc1b51f004d20ea6bf47a8a97e`。本文记录初始基线验收；用户随后授权合并与魔搭部署，已整合远端主干 `366133c`，发布验证见 RELEASE.md。`node_modules` 是本地测试依赖符号链接，不属于交付源码。

## 最终行为

项目页新增“下载项目 ZIP”，创建页与项目页共享“导入项目文件”。导出的 ZIP 包含项目、版本/元数据、精确组件版本、图片二进制与 SHA256 清单。干净浏览器仅凭 ZIP 可恢复项目并运行图片、表单、记录和计时器。JSON 下载和旧 JSON/裸项目迁移继续支持。原源码 ZIP 的导出用途和代码保持原有逻辑。

验证在发布当前项目之前完成；非法、损坏、缺失资源、超限和不支持内容均给出固定中文错误，不回显任意输入，不修改当前项目或建立失败导入备份。保留主线项目替换前备份与版本复核流程，备份恢复/下载增加严格 JSON 和凭据检查。

## 文件边界与 Agent 交付

| 责任 | 改动文件 | 验证与接口 |
| --- | --- | --- |
| ZIP/完整性 Agent | `src/integrations/project-package/{zip,errors}.ts`；`tests/project-package/zip.test.cjs` | 11/11；独立手工 ZIP、CRC32 向量、攻击路径、header/特性、边界、逐字节变异；`encodePackageZip/decodePackageZip/PACKAGE_LIMITS` |
| 格式/资源 Agent | `format.ts`、`security.ts`、`format.test.cjs` | 初始10组，通过主线 JSON 校验恢复既有 dataUrl；`createProjectPackage/parseProjectPackage` |
| JSON/安全收尾 Agent | 新 `json.ts`；修改 `format.ts/security.ts/format.test.cjs` | 最终13/13；重复/转义键、旧图片数据与长文本性能；`parsePackageJsonText(text):unknown`，凭据检查独立调用 |
| 端到端/回归 Agent | `tests/project-package/{fixtures.cjs,acceptance.test.cjs,browser.cjs}`；`QA.md`；`tests/gallery/browser.cjs` 的固定 PNG CRC | 固定2×2 PNG、干净浏览器、精确再导出、交互与失败原子性；完整命令与结果见 QA.md |
| 总负责 Agent | `file.ts/download.ts/messages.ts/image.ts`；三个项目 JSON 控件、`AiCreate.tsx`；`file.test.cjs/image.test.cjs`；package.json；文档及示例 | 内容识别/迁移、UI、备份安全、契约和最终集成；项目包合计35/35、最终构建通过 |

所有路径除明确前缀外相对于本工作树。文件/接口边界统一于 [PLAN.md](PLAN.md)，Agent 间共享同一格式、错误码与数据模型；总负责 Agent 完成跨模块接线和最终复核。

## 检查入口

- [FORMAT.md](FORMAT.md)：目录、版本、迁移、错误码、限制与兼容策略。
- [QA.md](QA.md)：测试命令、结果、浏览器隔离与排障记录。
- [example.zip](example.zip)：固定图片项目，无外部图片、真实用户数据或凭据；3096字节。
- [example.manifest.json](example.manifest.json)：样本内清单副本。
- [evidence.json](evidence.json)：基线、测试结果和交付源码/样本 SHA256。
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)：本地依赖定位与长文本扫描修复证据。

样本 ZIP SHA256：`b0e276969ef79042a677f392a8d164edb3ea500752ac53df5648a0d01ebe98da`。

## 剩余风险

只支持原始 STORE/UTF8 项目包；第三方压缩或修改 ZIP 后可能被拒绝。浏览器导入和 ZIP 导出增加原生图片解码门禁，已拒绝重算哈希后不可解码的图片；无原生解码 API 的 Node 调用仅校验签名与完整性。没有引入杀毒器。SHA256 校验不证明来源身份。凭据扫描可识别常见模式与可读元数据，存在保守误报，不能证明任意加密、混淆或隐写内容无秘密。沿用主线受信组件运行边界，不执行导入的任意源代码。

浏览器实测覆盖 Chromium 桌面与移动视口，尚未实测 Firefox/Safari。初始验证针对上述固定基线；后续主干整合回归另行记录于 RELEASE.md。最终人类检查可依次导入样本、进入 C 模式预览图片/提交表单、重新导出 ZIP，再在另一浏览器导入。测试通过后的最终验收由人类完成。
