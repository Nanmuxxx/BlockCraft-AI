from pathlib import Path
import hashlib,json,zipfile,subprocess
from datetime import datetime,timezone,timedelta
from pypdf import PdfReader
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).parent
FF=Path(r'F:\BlockCraft-AI\bp-redesign-build\video-deps\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe')
report={'checked_at':datetime.now(timezone(timedelta(hours=8))).isoformat(),'files':{}}
for name in ['bp-mac-candidate/BlockCraftAI_Final_BP.pdf','bp-mac-candidate/BlockCraftAI_Final_BP.pptx','video-owner-r02/VIDEO-B-105-FINAL-CUT-R02.mp4']:
 p=ROOT/name
 item={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 if p.suffix=='.pdf':
  r=PdfReader(p);item['pages']=len(r.pages)
  pages=[page.extract_text() for page in r.pages]
  (ROOT/'bp-mac-text.txt').write_text('\n\n'.join('PAGE '+str(i+1)+'\n'+t for i,t in enumerate(pages)),encoding='utf-8')
  for i in [5,7,9,10,13]:
   result=subprocess.run(['pdftoppm','-f',str(i),'-l',str(i),'-scale-to','1400','-png','-singlefile',str(p),str(ROOT/f'bp-mac-p{i:02}')],capture_output=True)
   if result.returncode: raise RuntimeError(result.stderr)
 elif p.suffix=='.pptx':
  with zipfile.ZipFile(p) as z:
   item['zip_crc_error']=z.testzip();item['slides']=len([n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml') and '/_rels/' not in n])
 else:
  probe=subprocess.run([str(FF),'-hide_banner','-i',str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace')
  (ROOT/'video-owner-r02/probe.txt').write_text(probe.stderr,encoding='utf-8')
  item['stream_summary']=[l.strip() for l in probe.stderr.splitlines() if 'Duration:' in l or 'Stream #' in l]
  decode=subprocess.run([str(FF),'-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True,text=True,encoding='utf-8',errors='replace')
  item['full_decode_exit']=decode.returncode;item['decode_errors']=decode.stderr
  vol=subprocess.run([str(FF),'-hide_banner','-i',str(p),'-af','volumedetect','-vn','-sn','-f','null','-'],capture_output=True,text=True,encoding='utf-8',errors='replace')
  (ROOT/'video-owner-r02/audio-volume.txt').write_text(vol.stderr,encoding='utf-8')
  font=ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc',18)
  samples=list(range(0,105,3))
  for batch in range(3):
   ts=samples[batch*12:(batch+1)*12]
   sheet=Image.new('RGB',(1280,((len(ts)+2)//3)*264),'#12151d');d=ImageDraw.Draw(sheet)
   for j,t in enumerate(ts):
    frame=ROOT/f'video-owner-r02/frame-{t:03}.jpg'
    subprocess.run([str(FF),'-v','error','-y','-ss',str(t),'-i',str(p),'-frames:v','1',str(frame)],check=True)
    im=Image.open(frame);im.thumbnail((424,238));x=(j%3)*426;y=(j//3)*264;sheet.paste(im,(x,y));d.text((x+5,y+239),f'{t:03}s',font=font,fill='white')
   sheet.save(ROOT/f'video-owner-r02/contact-{batch+1}.jpg')
 report['files'][name]=item
(ROOT/'received-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
