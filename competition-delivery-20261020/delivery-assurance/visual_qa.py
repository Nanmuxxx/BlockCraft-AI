from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import subprocess,json
R=Path(__file__).parent
FF=r'F:\BlockCraft-AI\bp-redesign-build\video-deps\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
movie=R/'BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4'
timeline=json.loads((R/'fallback-timeline.json').read_text(encoding='utf-8'))
sheet=Image.new('RGB',(1920,4*390),'#ffffff');d=ImageDraw.Draw(sheet)
for i,item in enumerate(timeline):
 t=(item['output_start']+item['output_end'])/2
 p=R/(item['name']+'-review.png')
 subprocess.run([FF,'-y','-v','error','-ss',str(t),'-i',str(movie),'-frames:v','1',str(p)],check=True)
 im=Image.open(p).resize((640,360));x=i%3*640;y=i//3*390;sheet.paste(im,(x,y));d.text((x+10,y+362),f'{t:.2f}s  '+item['name'],font=ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc',18),fill='black')
sheet.save(R/'fallback-contact.png')
probe=subprocess.run([FF,'-hide_banner','-i',str(movie)],capture_output=True,text=True,encoding='utf-8',errors='replace')
(R/'fallback-probe.txt').write_text(probe.stderr,encoding='utf-8')
print('\n'.join(l for l in probe.stderr.splitlines() if 'Duration:' in l or 'Stream #' in l))
