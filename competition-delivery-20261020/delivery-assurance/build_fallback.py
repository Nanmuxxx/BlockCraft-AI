from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
import subprocess,json,hashlib,urllib.request,os,shutil
ROOT=Path(__file__).parent
FF=os.environ.get('BLOCKCRAFT_FFMPEG') or shutil.which('ffmpeg') or r'F:\BlockCraft-AI\bp-redesign-build\video-deps\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
RAW=str(ROOT/'sources/B-mode-original.webm')
ASSETS=ROOT/'sources'
FONT=r'C:\Windows\Fonts\msyh.ttc';BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
def f(n,bold=False):return ImageFont.truetype(BOLD if bold else FONT,n)
BG='#fcf7ef';FG='#273a35';ACC='#d96c32';MUT='#68756f'
def txt(d,xy,s,size=38,color=FG,bold=False):d.text(xy,s,font=f(size,bold),fill=color)
def card(name,title,lines,image=None,tag='离线演示 · 字幕版 · 2026-10-20'):
 im=Image.new('RGB',(1920,1080),BG);d=ImageDraw.Draw(im)
 txt(d,(90,55),'BlockCraft AI',38,bold=True);txt(d,(90,140),title,66,bold=True)
 txt(d,(90,1000),tag,25,MUT)
 if image:
  pic=Image.open(image).convert('RGB');pic.thumbnail((1100,650));im.paste(pic,(90+(1100-pic.width)//2,295+(650-pic.height)//2))
  x,y,size=1240,315,31
 else:x,y,size=100,335,43
 for line in lines:txt(d,(x,y),line,size);y+=80 if not image else 70
 im.save(ROOT/(name+'.png'));return ROOT/(name+'.png')
gallery=ROOT/'gallery-offline-source.png'
url='https://raw.githubusercontent.com/Nanmuxxx/BlockCraft-AI/dc064a929cc7946749b29d625a73b3e213c257ca/docs/acceptance/gallery-qa/screenshots/club-registration-1440-gallery.png'
if not gallery.exists():urllib.request.urlretrieve(url,gallery)
assert hashlib.sha256(gallery.read_bytes()).hexdigest()=='5d84acdd17984110d3c9ca54192b96967909dcbaaf27a216ac011222bcdec6c7'
intro=card('01-intro','把想法，搭成自己的软件。',['面向编程零基础用户的可视化软件创造平台','本片展示已留存的离线验收素材','真实 DeepSeek 与公网闭环：尚未通过验收'])
scope=card('02-scope','先看清来源，再看产品行为。',['以下 B/C 为真实界面操作录屏，使用固定 AppSpec Fixture','来源基线 7e94dc9；零真实模型调用','不作为当前 main、公网部署或真实 AI 生成通过的证明'])
gcard=card('08-gallery','Demo Gallery · 六组离线样例',['固定 AppSpec Fixture','历史独立 QA 截图','受测代码 a5392394','桌面 / 手机共 12 例','报告：12/12 PASS','未合并 / 未公网验收'],gallery)
mcard=card('09-mochi','Mochi · 从反馈走向陪伴',['历史受控链路截图','基础反馈已实现','正式 Provider 未启用','自由增删与主动建议','仍属研发规划','此图不是在线 AI 证据'],ASSETS/'mochi-chat.png')
slot=card('10-real-slot','真实 DeepSeek 生成片段 · 待验收',['此处保留 12 秒录屏替换窗口','本版未取得真实公网生成证据，不展示模拟生成过程','仅在 Lead 确认真实验收通过后，替换为原始录屏'])
end=card('11-end','让创造更直观，也让证据更清楚。',['已展示：离线 B/C 配置、拖动、录入与同会话状态保留','待验收：真实生成、公网闭环与正式 Mochi Provider','本片为可播放保底候选；最终冻结与正式提交由负责人执行'])
clips=[];srt=[];t=0;timeline=[]
def tc(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def run(cmd):
 r=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
 if r.returncode:raise RuntimeError(r.stderr)
def add(name,duration,caption,path=None,start=None):
 global t
 out=ROOT/(name+'.mp4')
 args=[FF,'-y','-v','error']
 if start is None:
  args+=['-loop','1','-framerate','30','-i',str(path)]
 else:
  overlay=Image.new('RGBA',(1920,1080),(0,0,0,0));d=ImageDraw.Draw(overlay)
  d.rectangle((0,0,1920,100),fill=BG);d.rectangle((0,950,1920,1080),fill=BG)
  txt(d,(65,22),'BlockCraft AI | 本地固定 Fixture · 非真实 DeepSeek',38,bold=True)
  txt(d,(65,977),caption,36)
  overlay.save(ROOT/(name+'-overlay.png'))
  args+=['-ss',str(start),'-i',RAW,'-i',str(ROOT/(name+'-overlay.png')),
   '-filter_complex','[0:v]scale=1512:850,pad=1920:1080:204:100:color=0xfcf7ef[v];[v][1:v]overlay=0:0']
 args+=['-t',str(duration),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',str(out)]
 run(args);clips.append(out)
 srt.append(f'{len(srt)+1}\n{tc(t)} --> {tc(t+duration)}\n{caption}\n')
 timeline.append({'name':name,'output_start':round(t,2),'output_end':round(t+duration,2),'source_start':start,'caption':caption})
 t+=duration;print(name,'done',flush=True)
add('01-intro',10,'产品目标与当前状态；全片为字幕演示，无旁白',intro)
add('02-scope',8,'B/C 源录屏：固定 AppSpec Fixture；非真实模型生成',scope)
add('03-overview',4.1,'B 模式：表单、名单与人数统计',start=7)
add('04-inspector',6.9,'Inspector：新增邮箱字段并勾选展示',start=11.1)
add('05-drag',5.5,'拖动人数积木，调整可视布局',start=18)
add('06-runtime',10.2,'C 模式：填写报名记录，名单出现数据，人数变为 1',start=23.5)
add('07-roundtrip',8.2,'同一会话内 B/C 往返，字段与业务记录仍保留',start=33.7)
add('08-gallery',14,'Gallery：历史独立离线 QA 截图；未合并、未公网验收',gcard)
add('09-mochi',12,'Mochi：历史受控链路；正式 Provider 未启用',mcard)
add('10-real-slot',12,'真实生成待验收；本段仅为诚实状态说明与替换窗口',slot)
add('11-end',14.1,'保底视频候选；真实生成与公网验收仍待完成',end)
(ROOT/'concat.txt').write_text('\n'.join("file '"+p.name+"'" for p in clips),encoding='utf-8')
output=ROOT/'BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4'
run([FF,'-y','-v','error','-f','concat','-safe','0','-i','concat.txt','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','105','-c:v','copy','-c:a','aac','-b:a','96k','-movflags','+faststart',str(output)])
(ROOT/'BlockCraftAI-OFFLINE-FALLBACK-105s-R01.srt').write_text('\n'.join(srt),encoding='utf-8')
(ROOT/'fallback-timeline.json').write_text(json.dumps(timeline,ensure_ascii=False,indent=2),encoding='utf-8')
run([FF,'-v','error','-xerror','-i',str(output),'-f','null','-'])
audit={'file':output.name,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'duration_seconds':105,'full_decode_exit':0,'audio':'Intentional silent AAC; no narration','native_player_review':'NOT VERIFIED: computer control stopped by policy','real_model_calls':0,'status':'OFFLINE FALLBACK CANDIDATE / NOT SUBMITTED'}
(ROOT/'fallback-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(audit,ensure_ascii=False),flush=True)
