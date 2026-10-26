# BP 原件跨电脑交接 — 2026-10-20

来源：BP Agent 本地 Mac /Users/nanmuxun/BlockAI/competition-delivery-20261019。仅此目录内明确列出的非敏感 BP 原件与审核材料；非产品代码、非部署包。

## 候选选择

本包是 Mac 的 BlockCraftAI_Final_BP.pdf/.pptx 原件（10月19日技术状态最小更新，15页），推荐作为已审计、可追溯的审核候选，**不擅自指定为唯一比赛终稿**。负责人指定名称 BlockCraftAI_BP_Final_Redesign.pdf/.pptx 对应另一台 Windows 的独立原件（对方报告567735/2243606 bytes）；本机未取得其字节，不声称检查过或与本包等价。请 Lead 比较真实原件后指定唯一候选。本包不重命名为Redesign、不覆盖另一套、不混用页码或PowerPoint验收记录。

## 验证和阅读顺序

1. 下载本目录原件及SHA256SUMS，在Mac/Linux使用 shasum -a 256 -c SHA256SUMS，Windows使用 Get-FileHash -Algorithm SHA256 对照。
2. FINAL-SPRINT-BP-ORIGINAL-REVIEW-20261020.md 含P5/P7/P9/P10/P13直接提取的实际全文及拟微调映射；JSON保留原件提取和大小/hash。全部15页PPTX/PDF文字字符计数一致。
3. rendered-oct19-r3/contact-sheet.jpg 与RENDER-CHECK.md 是历史相同字节的渲染检查，不是本轮重新渲染或原生PowerPoint测试。本套原生PowerPoint尚未验收。
4. P0-LIVE-BP-CORRECTION-20261020.md 与最终冲刺页码核对优先于10月19日排期。真实DeepSeek非预设需求→合法AppSpec→魔塔公网B/C是必须P0，尚待独立真实验收；Fixture/Mock/历史回放不能替代。任意TSX运行仍NO-GO。本包成品未写入后续拟替换文案。

## 截止与权限

Supervisor新安排：北京时间2026-10-20 16:00冻结、17:00授权人提交、18:00截止；官方格式/大小/视频限制仍待核实。未提交比赛。无付费、Secret、部署、预算、权限或合并批准。

## 恢复点

交接分支 handoff/bp-originals-20261020，基于4a95cae50f772cd242d932cdbd93366381d1df74，正常push，不改main。BP原件已保存在本包；本地其他构建中间件未全量上传，后续如需改稿应先选择唯一原件，避免重开矛盾版本。下一步：独立下载/打开审核、Lead指定候选、仅证据驱动状态微调。剩余依赖：真实公网验收、最终成片审听、官方规则、团队收片确认。
