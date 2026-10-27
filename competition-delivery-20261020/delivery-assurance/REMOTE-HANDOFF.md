# 交付保障独立恢复说明

仅交 Lead / Supervisor。截止：2026-10-20 18:00 Asia/Shanghai。只保存证据与材料，不申请合并或部署。

分支：`handoff/delivery-assurance-20261020`，基于 main `4a95cae50f772cd242d932cdbd93366381d1df74`。本目录应为唯一新增范围 `competition-delivery-20261020/delivery-assurance/**`。精确远端 commit、Draft PR 与下载回验结果以 Issue #57 的 DELIVERY-ASSURANCE 交接评论为准；本文不以本地文件存在自证远端保存成功。

## 恢复和验收

1. 从 Issue #57 取得精确 commit，在授权电脑 fetch/checkout；本目录 `SHA256SUMS.txt` 可核对实际文件字节。
2. `DELIVERY-CHECKLIST.md` 为三项清单；`PUBLIC-SMOKE.md` 为部署后的零付费验收。未取得实际 origin/版本/部署证据前保持 NOT DEPLOYED / NOT VERIFIED。
3. 主视频 Owner 仍持有 `video-delivery/20261020/**`，恢复点 `09d196788fd25d1f9d009184be3a61cbc8e7d554`。先读该处 HANDOFF/来源/时间轴，再读本目录 `VIDEO-R02-INDEPENDENT-REVIEW.md`。本目录抽帧联系表不是连续播放器审听。
4. 独立保底片 `BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4` 是105秒字幕/静音候选，完整解码通过；78.90–90.90秒为真实录屏待验状态卡。它不满足真实生成P0，也不自动获得提交放行。
5. Windows 指定原件在 `bp-windows-candidate/`；Mac 原件位于 #70 `d192d9fa3dfab27dadef5271af86b8dc4bed0ff0` 的 `competition-delivery-20261019/handoff/bp-originals-20261020/`。两套均15页，不能别名化。Lead选唯一稿，BP Owner只做事实/日期最小修正。
6. 完整播放器审听、Office原生打开、官方格式限制、唯一冻结与比赛提交回执仍待Lead协调。只有有权限的负责人提交；我们没有代提交。

`build_fallback.py` 可用 Python+Pillow 和FFmpeg重建（设置 `BLOCKCRAFT_FFMPEG` 或PATH，使用Windows微软雅黑字体）；输入源片/截图在sources和本目录。复现环境与编码器不同可导致输出hash不同，应重新核验，不能覆盖已冻结字节。没有上传运行环境、FFmpeg二进制或私聊视频。

## 责任与主机

交付保障只写本目录，原BP/Video素材保持不变。执行主机：local Windows；预计在线至何时 UNKNOWN。heartbeat `blockcraft-ai` 配置ACTIVE、每15分钟；尚无首次实际调度执行回执，不保证机器关机后运行。后续如不可运行，稳定Supervisor按本说明接管。

增量读取水位见清单。只在交付物实质变化、新P0或Lead新任务时更新 #57；无变化不刷屏。不合并、不部署、不改密钥、不付费、不正式提交。
