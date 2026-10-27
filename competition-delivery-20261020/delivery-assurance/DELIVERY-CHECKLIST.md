# BlockCraft AI 初赛交付保障清单

截止：2026-10-20 18:00 Asia/Shanghai。当前轮：2026-10-20 00:55左右（准确文件检查时间见artifact-audit.json/received-audit.json；协调评论以实际发出时间为准）。仅交Lead/Supervisor，正式提交权属于负责人。

ACK：https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6272119439
P0文件请求：https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6272167315

| 交付物 | 已有实际证据 | 当前状态 | 完成所需/归属 |
|---|---|---|---|
| 魔塔公网链接 | 指定Studio已知；#57最新计划为无密钥main4a95cae包，未实际部署 | NOT DEPLOYED（协调报告）/ NOT VERIFIED（独立验收）；origin/revision缺失 | Lead统筹负责人批准/操作；QA取得实际origin/版本并冒烟。交付保障无部署权。 |
| 演示视频 | 独立下载Video Owner远端FINAL-CUT-R02，105秒9282324bytes，hash一致/完整解码通过；另有本目录105秒OFFLINE-FALLBACK-R01，4620783bytes | 两个候选均有实际文件及画面核对；原生播放器完整审听、最终冻结和正式提交未完成 | Lead安排完整审听/择一最终候选；视频Owner复核字幕50ms重叠、交付报告过时截止时间；真实录屏由授权者交付。 |
| BP | Windows Final_Redesign与Mac Final_BP两套实际文件均取得；各15页/15slides、CRC通过，各五页新渲染检查 | 文件访问已解决；两套不是同一文件；唯一最终候选未定，原生Office本轮打开未验 | Lead选稿；BP Owner最小修正Mac P13过时冻结日期，保持版式；负责人冻结。 |
| 实际提交 | 没有比赛平台回执或已提交截图 | NOT VERIFIED / 未代提交 | Lead确认正式入口/格式/大小限制，负责人上传三项并保存回执；他人转述“文件就绪”不等于提交成功。 |

## 本轮输出

- `BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4`：SHA256 `9167633543ccaf30dd779770abc44cb253b43c0efdf3368f6ab0a4782c8381f2`。105秒/1920×1080/30fps/H264/AAC静音字幕片。明确Fixture、历史Mock、未验真实生成；78.90–90.90秒预留真实片段。全片解码通过不等于原生播放器全片观看。
- 同名`.srt`、`fallback-timeline.json`、`VIDEO-SCRIPT.md`、`fallback-audit.json`、`fallback-contact.png`、重建脚本。
- `BP-FOCUS-REVIEW.md`、`bp-current-text.txt`、`bp-p05/p07/p09/p10/p13.png`、`artifact-audit.json`。
- `PUBLIC-SMOKE.md`零付费公网验收表。未连接真实origin前不执行/声称通过。
- Gallery精确commit来源报告/截图索引/PNG，Mochi历史fixture原图哈希已核对。

## 交付节奏与Lead待办

| 北京时间10月20日 | 协调目标 | 记录方式 |
|---|---|---|
| 10:00 | 技术状态、可播放视频与BP | 文件可下载位置、版本/hash、独立播放/打开结果 |
| 12:00 | 独立安全建议 | 真实模型入口NO-GO/GO依据；不可拿Mock测试替代 |
| 14:00 | 真实DeepSeek公网片段目标 | 原始连续录屏、origin/revision/SHA、脱敏provenance与QA签认；缺失保留诚实状态卡 |
| 16:00 | 三项冻结 | 唯一文件名/hash、链接、技术口径、授权签认；不是自动达成 |
| 17:00 | 负责人正式提交 | 上传/链接实际回执、时间、截图，留一小时修正 |
| 18:00 | 硬截止 | 逐项记录实际提交状态，不倒填或猜测 |

P0：真实非预设DeepSeek→合法AppSpec→公网B/C仍未验收；公网初次部署未完成；BP/视频尚无唯一冻结与完整审听回执。Mac视频/BP实际字节访问已解决，不再报告不可读。保底片不能消除真实生成P0。

负责人必须亲自完成/授权的事项由Lead统一升级：平台部署/构建操作，任何真实调用及预算授权，三项冻结签认和比赛正式提交。交付保障不合并、不部署、不改密钥、不付费、不代提交。

## 自动交接与恢复

本轮应用工具已成功创建并view确认 heartbeat `blockcraft-ai`，15分钟检查一次，状态ACTIVE；本地配置 `C:\Users\35904\.codex\automations\blockcraft-ai\automation.toml`。尚未观察到首次调度实际执行，不能保证关机/离线仍运行。只在实质变化/P0/需操作时向#57交接；无变化保持安静。现有ACK是维护入口，避免重复评论。

每次：读取#57在上次水位后的评论→核对Lead任务→比较实际文件/链接/hash及独立证据→更新本表和ACK→有新增P0才单独报Lead。上次已读水位6272553245，包含Lead离线交接6272482713、Docker新转运报告6272539506及Tech Lead契约测试复核6272553245；不因此宣称已重跑他人的Mock或CI。若调度不可用，Lead/稳定Supervisor可直接按本文接管；不得声称后台持续运行。截止后只交真实提交状态并暂停自动化，不归档项目或代提交。

本机路径不是跨机可下载链接。Lead取得文件后必须回报“已获取/可播放/可打开”的实际结果；当前不把路径存在当作Lead已收到。远端恢复点/下载回验见 `REMOTE-HANDOFF.md`（建立后补记精确SHA）；正式格式/时长/大小/文件命名限制尚待比赛入口核对。

断电备份已建立 Draft PR #72，首个保存点064f23eb6bb5a53495f2e54fdeb1472b735869c8的41文件已实际逐项下载比对PASS，下载回来的保底片全解码PASS。完整补充提交、最小命令、Git工作区边界和稳定Supervisor接管说明见 POWER-LOSS-HANDOFF.md；最新完整SHA以#57报告为准。

