# 项目包 v1 集成计划与契约

## 基线与边界
- 独立工作树 `BlockCraft-AI-project-package-v1`，分支 `feature/project-package-v1`；精确基线 `a77cf25`（已包含 #80 JSON 往返及 gallery stage 1）。源工作树先前的暂存变更已由其所有者提交；本任务不修改源工作树。
- 实现只涉及 `src/integrations/project-package/`、现有项目 JSON 控件、测试与文档、package.json 测试脚本。保留原源码 ZIP 导出链路。不修改部署、魔塔链接、服务端或远程状态。
- 总负责 Agent 负责契约、UI、跨模块集成及最终验收；ZIP Agent 独占 zip.ts/errors.ts 与 zip.test.cjs；格式 Agent 独占 format.ts 与 format.test.cjs；回归 Agent 独占 browser.cjs、fixtures.cjs 及审查报告。所有 Agent 必须报告文件、命令、结果、风险和接口变化。

## 冻结接口
- `errors.ts`: `ProjectPackageError(code: string, message?: string)`，稳定 `code`，不把原始输入/路径/资源内容写入错误。
- `zip.ts`: `PACKAGE_LIMITS`（maxFiles=34、maxFileBytes=4_000_000、maxTotalBytes=5_100_000、maxZipBytes=5_200_000）；`encodePackageZip(files: {path:string, data:Uint8Array}[]): Uint8Array`；`decodePackageZip(bytes:Uint8Array): Map<string,Uint8Array>`。只接受 manifest.json、project.json、assets/<合法ID>.<png|jpg|webp|gif>。v1 STORE/UTF8，无 ZIP64、加密、压缩、软链接、目录、extra/comment、多卷、重复/大小写冲突路径；严格核对 local/central headers、CRC、边界和连续覆盖，拒绝额外内容。
- `format.ts`: `createProjectPackage(project:CustomProject, registry:ArtifactRegistry): Promise<Uint8Array>`；`parseProjectPackage(bytes:Uint8Array):Promise<RestoredProject>`；`parseProjectFile(file: {size:number,arrayBuffer():Promise<ArrayBuffer>}):Promise<RestoredProject>` 由总负责 Agent 实现独立 file.ts，按 ZIP 魔数/JSON 内容检测。

## 包格式
- 根目录 manifest.json + project.json + assets/ 下二进制本地图片。
- manifest `{format:'blockcraft-project-package',formatVersion:1,metadata:{id,name,revision,appSpecVersion,projectFormatVersion},project:{path:'project.json',byteLength,sha256},resources:[{id,path,mimeType,byteLength,sha256}]}`。sha256 为小写 64 位 hex。元数据与项目必须一致。
- project.json 为 `{format:'blockcraft-package-project',formatVersion:1,project,artifacts}`，保留 CustomProject v2 全部内容及精确组件版本；base.assets 条目使用 resourcePath 替代 dataUrl，其余字段保留。导入验证后将二进制重建为既有 ProjectAsset dataUrl，再走原 parseProjectJson，运行时与声明式底座不新增资源契约。
- 每个资源的 id、路径、MIME、扩展名、长度、哈希与项目引用必须一一对应；允许保留未被 gallery 使用但属于项目的资源。禁止未列出的 ZIP 条目。图片沿用主线：PNG/JPEG/WebP/GIF，32 个、单个512KiB、合计1MiB。
- 旧 blockcraft-project JSON v1 继续支持；裸 ProjectState（AppSpec v1/v2）经 migrateProjectState + 空 registry 严格迁移，裸 CustomProject v2 仅无外部缺失组件版本时支持。不支持的未来版本明确拒绝；旧源码 ZIP 不能假装可恢复项目包。
- 限制资源与 JSON 总体积，所有 JSON 使用严格语法/重复键检查与现有防原型污染/深度/节点限制；禁止凭据键、常见 token/key/secret 值及 URL userinfo/敏感 query。导入导出拒绝风险内容，不静默剥离用户数据；不记录原文。对字段/源码误报是已知风险，测试覆盖。

## 错误码
`PACKAGE_INVALID` 结构损坏；`PACKAGE_VERSION` 不支持格式版本；`PACKAGE_LIMIT` 超限；`PACKAGE_PATH` 非法路径/条目；`PACKAGE_UNSUPPORTED` ZIP 特性不支持；`PACKAGE_INTEGRITY` CRC/哈希/长度错误；`RESOURCE_MISSING` 缺失；`RESOURCE_INVALID` MIME/格式/引用不一致；`PACKAGE_SECRET` 可能包含凭据。原组件 VERSION_MISSING/DIGEST_MISMATCH 等语义保留。

## 验收与顺序
1. 固定 PNG + gallery + 记录/布局/计时器及精确组件版本往返，资源/JSON完全一致。
2. 新浏览器上下文，无存储恢复并在 C 模式显示图片、交互运行；不请求真实 AI，阻断所有外网。
3. 缺失/损坏/超限、恶意路径、重复条目、header 分歧、CRC/hash 不符、非法文件/版本/图片、凭据拒绝；失败保持当前项目且不写备份。
4. 旧 JSON/裸 v1迁移；主线 JSON、gallery、layout、AppSpec、runtime、原源码 ZIP 等回归；构建通过。
5. 输出格式文档、Agent报告、脱敏测试证据和风险，所有门禁通过后请求人类最终检查。

## 初始风险
- 容器根目录不是 Git 仓库：初始 git status 命令退出128，完整错误 `fatal: not a git repository (or any of the parent directories): .git`；Git 2.50.1 (Apple Git-155)。只读核查找到子工作树，使用 git 的工作目录选项解决；子工作树状态/日志成功。联网检索服务不可用；通过 https://git-scm.com/docs/git 官方文档验证 .git/GIT_DIR/工作目录语义。未读取凭据。
- 通用格式层沿用主线文件签名校验；最终集成在浏览器导入和 ZIP 导出增加原生实际解码门禁，拒绝重算哈希后仍无法解码的图片。Node 无解码 API 时仅执行签名及完整性校验；不提供杀毒或来源认证。
- v1 有意只支持自有 STORE ZIP；第三方重新压缩的 ZIP 明确报不支持，不执行解压到磁盘。
- SHA256 检测损坏，不提供来源真实性；不执行导入组件源码，不改变既有受信运行策略。
- 主线可能继续变化，交付固定基线，不自动合并未知并行工作。
