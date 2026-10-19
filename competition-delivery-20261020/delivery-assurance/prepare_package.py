from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).parent
names=['DELIVERY-CHECKLIST.md','BP-FOCUS-REVIEW.md','VIDEO-SCRIPT.md','VIDEO-R02-INDEPENDENT-REVIEW.md','PUBLIC-SMOKE.md','REMOTE-HANDOFF.md',
 'BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4','BlockCraftAI-OFFLINE-FALLBACK-105s-R01.srt','fallback-audit.json','fallback-timeline.json','fallback-contact.png','fallback-probe.txt',
 'artifact-audit.json','received-audit.json','bp-current-text.txt','bp-mac-text.txt','build_fallback.py','gallery-offline-source.png','gallery-qa-REPORT.md','gallery-qa-SCREENSHOTS.md',
 'sources/B-mode-original.webm','sources/mochi-chat.png','bp-windows-candidate/BlockCraftAI_BP_Final_Redesign.pdf','bp-windows-candidate/BlockCraftAI_BP_Final_Redesign.pptx']
names += [f'bp-p{i:02}.png' for i in [5,7,9,10,13]] + [f'bp-mac-p{i:02}.png' for i in [5,7,9,10,13]]
names += [f'video-owner-r02/contact-{i}.jpg' for i in [1,2,3]] + ['video-owner-r02/probe.txt','video-owner-r02/audio-volume.txt']
names += ['prepare_package.py','audit_received.py','visual_qa.py','verify_remote_transfer.py','REMOTE-TRANSFER-VERIFICATION.json','POWER-LOSS-HANDOFF.md']
manifest=[{'path':name,'bytes':(ROOT/name).stat().st_size,'sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest()} for name in names]
(ROOT/'SHA256SUMS.txt').write_text(''.join(f"{x['sha256']}  {x['path']}\n" for x in manifest),encoding='utf-8')
(ROOT/'package-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
bundle=ROOT.parent/'BlockCraftAI-Delivery-Assurance-20261020.zip'
with zipfile.ZipFile(bundle,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name in names+['SHA256SUMS.txt','package-manifest.json']:
  z.write(ROOT/name,'delivery-assurance/'+name)
with zipfile.ZipFile(bundle) as z: assert z.testzip() is None
(ROOT/'bundle-local-audit.json').write_text(json.dumps({'file':bundle.name,'bytes':bundle.stat().st_size,'sha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'zip_crc':'PASS','remote_status':'LOCAL_ONLY; individual curated files have separate remote handoff'},indent=2),encoding='utf-8')
print(json.dumps({'files':len(manifest)+2,'bytes':sum(x['bytes'] for x in manifest),'bundle_bytes':bundle.stat().st_size,'bundle_sha256':hashlib.sha256(bundle.read_bytes()).hexdigest()}))
