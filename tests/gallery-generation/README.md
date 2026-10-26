# 图库单张离线闭环验收

本套验收只使用 Canvas PNG。运行时创建独立浏览器上下文，拦截全部外网和 `/api/` 请求，不启动模型服务，不访问使用者的 Chrome 配置或 IndexedDB。不代表真实 AI 图像生成、供应商计费或线上部署验收。

## 运行

依赖项目已有依赖、Playwright 和 Chromium。若 Playwright 不在项目依赖中，可通过当前进程的 `NODE_PATH` 指向已有安装；`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可指定本机 Chrome。不要把密钥作为参数。

```powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node --run test
node tools/project-zip-export/prepare.mjs
node --test tests/project-json/*.test.cjs tests/project-package/*.test.cjs tests/custom-block-bc/*.test.cjs tests/workshop-export/*.test.*
node --run test:gallery-offline:browser
node tests/project-package/browser.cjs
```

CI 使用 Node 24 和 Playwright 1.62.1。无现成 Playwright 时，在独立临时目录安装测试工具，不改变项目依赖和锁文件（首次安装需要网络）：

```powershell
$galleryTools = Join-Path $env:TEMP 'blockcraft-gallery-browser'
npm install --prefix $galleryTools --no-package-lock --ignore-scripts playwright@1.62.1
$env:NODE_PATH = Join-Path $galleryTools 'node_modules'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --run test:gallery-offline:browser
```

没有本机 Chrome 时，执行 `node "$env:NODE_PATH/playwright/cli.js" install chromium`，并省略 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。Linux CI 的完整安装及测试命令见 [离线验收工作流](../../.github/workflows/offline-gallery.yml)。

如果沙箱禁止回环地址，需要允许测试进程连接本机 `127.0.0.1`。不需要联网调用任何模型。

默认证据目录是 `.cache/gallery-offline-evidence/browser`，可通过 `GALLERY_EVIDENCE_DIR` 指定独立输出目录。包含 `report.json`、JSON 快照、真实下载和重新导出的 ZIP、PNG 截图、两份 Playwright 轨迹。最终退出码为 0 才代表本次运行通过。失败时未执行行标为 NOT RUN。

## 实际操作与回放

`browser.cjs` 自动在桌面宽度和 390px 移动宽度执行以下界面操作，不依赖手动复制项目内部对象来完成主流程：

1. 打开 `/ai-create`，选择“图库单张练习（离线，不调用模型）”，点击“打开离线图库”。
2. 点击“生成一张离线示例”，查看实际可解码图片；导出 JSON 验证项目未改变。
3. 点击“放弃预览”，验证原项目不变；重新生成一张候选。
4. 点击“确认采用并保存”；检查 B 模式图库勾选和 C 模式真实图片，比较项目及持久化记录。
5. 刷新页面，验证最新保存的完整作品、图片和引用不变。
6. 点击“下载项目 ZIP”，关闭原浏览器上下文。
7. 在全新隔离上下文导入 ZIP，重新导出后逐字节比较；点击“保存到本机”，再刷新验证图片。

回放轨迹可用已有 Playwright CLI：

```powershell
node "$env:NODE_PATH/playwright/cli.js" show-trace .cache/gallery-offline-evidence/browser/demo-2.trace.zip
```

`demo-2.trace.zip` 记录生成、采用、保存、刷新和导出；`demo-3.trace.zip` 记录隔离导入、再次保存和刷新。轨迹包含操作及页面截图，未生成 MP4；机器未安装 Playwright 视频编码器。

## 矩阵及证据边界

| ID | 离线实际执行内容 |
|---|---|
| M00 | 完整 HEAD、分支、工作区状态、本机服务地址和实际加载的控制器源码 |
| M01 | 单张候选、确认前 revision/assets/imageIds 不变、放弃预览后不变 |
| M02 | 原生解码、PNG 字节、尺寸、SHA-256、目标图库、截图 |
| M03 | 一次采用同时写资源和引用，持久化收据、B 配置和 C DOM 一致 |
| M04 | 页面刷新恢复当前已保存作品，完整快照与保存记录相同 |
| M05 | 全新浏览器上下文 ZIP 导入，图片成员哈希一致，重导 ZIP 逐字节相同；JSON 保持可用 |
| M06 | 替身生成/取图失败、坏签名、解码失败、格式和容量失败不改原作；真实计费分项 NOT RUN |
| M07 | 真实 IndexedDB 事务中的 quota/abort 注入保留旧版本，提交后激活失败恢复已保存版本 |
| M08 | 并发确认、重复确认、刷新后原收据重试、提交响应丢失及核实读取失败 |
| M09 | 预览后编辑、删除目标、释放旧工作区、撤销再授予权限，以及生成期间撤销权限 |
| M10 | 不响应的离线 Provider 取消/超时后只调用一次，晚到结果无效；真实费用未知分项 NOT RUN |
| M11 | 无 assets、空 assets、已有图片的保存/JSON/ZIP 恢复；坏引用拒绝；IndexedDB v1→v2 保留并解析旧备份 |
| M12 | 实际可解码 PNG 的 512KiB、总 1MiB、32 张及超限；未引用资源计入；JSON/ZIP 字节边界及大业务文本组合 |
| M13 | 同一浏览器上下文中的两个真实页面争用存储，只有一方提交，另一方 STORAGE_CONFLICT |

M06–M13 的故障与边界由 `browser-cases.js` 在真实浏览器中调用生产模块、原生图片解码和 IndexedDB 执行，不是点击 UI 的视频演示；主闭环 M01–M05 通过实际页面按钮和下载/上传完成。M12 的 ZIP 容器边界另按容器 API 验证，不宣称任意最大容器同时满足项目资源限制。

## 兼容性和保存语义

- 保持 AppSpec 1/2、CustomProject 2、项目 JSON 1、项目 ZIP 1，以及既有 `ProjectAsset`、`gallery.imageIds` 格式，不新增视觉协议。
- 复用已有 JSON/ZIP 编解码、图片解码和资源限制。ZIP 是可回导的项目包；React 源码 ZIP 保持原有独立入口与限制。
- `blockcraft-project-backups` 升级为 IndexedDB v2，保留 `projects` 备份存储，新建 `current-workspace`。新版本会要求关闭占用数据库的旧页面，不覆盖旧备份。
- 当前作品仅保存到当前浏览器、当前站点来源。确认采用会同时保存；其他编辑需点击“保存到本机”。跨浏览器通过 JSON/ZIP 转移，不提供账号云同步。
- 工作区先完成 IndexedDB 事务，再发布同一 owner 的快照。失败前保留旧作品；提交成功后激活失败或确认结果未知时锁定进一步写入，提示恢复，不能宣称回滚。
- 采用收据保留在本机当前作品记录，不写入便携项目包。导入为新工作区后图片数据保留，旧工作区确认令牌不作为新项目授权。
- 限制为每个工作区最多 128 条采用收据；达到限制时要求先导出、再导入为新项目，不静默丢弃幂等记录。
