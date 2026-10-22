# BlockCraft 项目包 v1

此格式用于离线恢复项目。在项目页选择“下载项目 ZIP”，将原始 ZIP 复制到另一浏览器，在创建页选择“导入项目文件”，即可继续编辑并进入 C 模式运行。导入失败保留当前项目；替换现有项目仍使用原有本地备份与版本复核流程。

## 目录和版本

```text
manifest.json
project.json
assets/<resourceId>.<png|jpg|webp|gif>
```

`manifest.json` 字段全部必需，未知字段拒绝：

```json
{
  "format": "blockcraft-project-package",
  "formatVersion": 1,
  "metadata": {
    "id": "project-id",
    "name": "项目名称",
    "revision": 7,
    "appSpecVersion": 2,
    "projectFormatVersion": 2
  },
  "project": {
    "path": "project.json",
    "byteLength": 123,
    "sha256": "<64位小写十六进制>"
  },
  "resources": [{
    "id": "photo",
    "path": "assets/photo.png",
    "mimeType": "image/png",
    "byteLength": 75,
    "sha256": "<64位小写十六进制>"
  }]
}
```

示意长度与哈希为占位符。实际可导入样本见同目录 `example.zip`。

`project.json` 是 `{format:"blockcraft-package-project",formatVersion:1,project,artifacts}`。`project` 保留主线 CustomProject v2 的记录、布局、计时状态、renderOrder、组件引用等数据。唯一存储差异是 `project.base.assets[id]` 的 `dataUrl` 替换成 `resourcePath`；保留 `id/name/mimeType/altText`。`artifacts` 携带项目引用的精确组件版本，仍由主线 digest/registry 校验。

资源 ID 必须匹配 `[A-Za-z][A-Za-z0-9_-]{0,127}`，排除原型危险键。文件扩展名、MIME、签名、ID、声明路径、长度、SHA256 必须一致；PNG/JPEG/WebP/GIF 对应 png/jpg/webp/gif。gallery 的 imageIds 仍指向既有 ID。未被当前 gallery 引用的项目资源也予保留；清单外文件拒绝。

导入在内存验证 ZIP、项目哈希、资源哈希及引用；浏览器还使用原生解码器拒绝无法解码的图片，重建既有 ProjectAsset `dataUrl` 后调用主线 `parseProjectJson`。声明式运行时不增加 ZIP 专用字段，不读取外部图片，不执行导入源码。

## ZIP 和安全边界

- 仅接受 UTF-8 路径的 STORE ZIP，输出时间固定为 1980-01-01；相同项目与组件生成相同字节。
- 禁止路径穿越、绝对路径、反斜杠、Unicode 路径、重复/大小写碰撞、额外文件、软链接、目录和特殊文件。
- 禁止压缩、加密、ZIP64、多卷、descriptor、extra、comment、尾随数据；核对连续覆盖、local/central header 一致性及 CRC32。不落盘解包。
- JSON 严格 UTF-8，拒绝重复键（含转义等价键）、原型危险键、超深或超节点结构，沿用主线文本/结构限制。
- 拒绝可识别的凭据字段、常见令牌、源码凭据赋值、URL 用户名/密码及敏感查询参数。图片二进制可读元数据也扫描。错误文本不回显输入。

| 限制 | 上限 |
| --- | ---: |
| ZIP 输入 | 5,200,000 字节 |
| ZIP 文件数 | 34 |
| ZIP 单文件 | 4,000,000 字节 |
| ZIP 文件内容总计 | 5,100,000 字节 |
| 图片数量 | 32 |
| 单图片 | 512 KiB |
| 图片总计 | 1 MiB |
| 主线 JSON | 4,000,000 字节；文本累计 2,000,000 字符 |

## 兼容和错误

继续接受原 `blockcraft-project` JSON v1，包括内嵌图片和精确组件版本。裸 ProjectState AppSpec v1/v2 使用主线迁移；裸 CustomProject v2 只在其引用无需缺失组件版本时可恢复。不静默丢弃组件或资源。不支持的未来版本拒绝。原“源码 ZIP”保持独立，其内容不是可恢复项目包。第三方重新压缩后的项目包会报不支持，请保留原始 ZIP。

| 错误码 | 含义 |
| --- | --- |
| PACKAGE_INVALID | JSON/ZIP 结构不合法或元数据不一致 |
| PACKAGE_VERSION / UNSUPPORTED_FORMAT | 不支持的项目版本 |
| PACKAGE_LIMIT / LIMIT | 大小、数量或结构超限 |
| PACKAGE_PATH | 非法、重复或未声明路径 |
| PACKAGE_UNSUPPORTED | 不支持的 ZIP 特性 |
| PACKAGE_INTEGRITY | CRC32、SHA256 或长度不一致 |
| RESOURCE_MISSING | 资源或引用目标缺失 |
| RESOURCE_INVALID | 图片类型、签名或映射不一致 |
| PACKAGE_SECRET | 可能包含凭据 |
| VERSION_MISSING / DIGEST_MISMATCH | 主线组件版本缺失或摘要不一致 |

## 已知限制

SHA256 用于检测损坏，不证明来源身份。通用格式层沿用主线图片签名校验；浏览器导入/ZIP 导出另经 createImageBitmap（或 Image 回退）验证可解码性，并释放临时资源。无原生解码 API 的 Node 调用保留签名和完整性校验，不等同于浏览器解码门禁。固定 PNG 的实际解码、预览、恢复运行，以及重算哈希后仍无法解码的损坏包拒绝，由端到端测试验证。没有引入杀毒器。安全扫描是保守规则，可能拒绝名为 token/password/secret 的业务字段，也不能证明任意编码或隐写内容完全无敏感信息。资源/项目上限和 STORE 子集是 v1 的兼容约束。

测试、基线和剩余风险见 [QA.md](QA.md) 与 [PLAN.md](PLAN.md)。此任务只产生本地改动，未部署、推送或调用真实 AI。
