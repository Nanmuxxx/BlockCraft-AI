from pathlib import Path
import concurrent.futures, hashlib, json, subprocess, urllib.request, argparse, os, shutil
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).parent
parser = argparse.ArgumentParser()
parser.add_argument('--commit', default='064f23eb6bb5a53495f2e54fdeb1472b735869c8')
SHA = parser.parse_args().commit
PREFIX = 'competition-delivery-20261020/delivery-assurance/'
BASE = 'https://raw.githubusercontent.com/Nanmuxxx/BlockCraft-AI/' + SHA + '/' + PREFIX
OUT = ROOT / 'remote-readback'
OUT.mkdir(exist_ok=True)
manifest_bytes = urllib.request.urlopen(BASE + 'package-manifest.json', timeout=40).read()
expected = {x['path']: x for x in json.loads(manifest_bytes)}
names = list(expected)
names += ['SHA256SUMS.txt', 'package-manifest.json']

def check(name):
    data = urllib.request.urlopen(BASE + name, timeout=40).read()
    target = OUT/name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    matched = (len(data) == expected[name]['bytes'] and digest == expected[name]['sha256']) if name in expected else (data == manifest_bytes if name == 'package-manifest.json' else True)
    return {'path': name, 'bytes': len(data), 'sha256': digest, 'matches_manifest': matched}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(check, names))
report = {'checked_at': datetime.now(timezone(timedelta(hours=8))).isoformat(), 'commit': SHA,
          'method': 'actual HTTP downloads from exact remote commit; manifest bytes/hash verification',
          'files': results, 'all_match': all(x['matches_manifest'] for x in results)}
ff = os.environ.get('BLOCKCRAFT_FFMPEG') or shutil.which('ffmpeg') or r'F:\BlockCraft-AI\bp-redesign-build\video-deps\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
decoded = subprocess.run([str(ff), '-v','error','-xerror','-i',str(OUT/'BlockCraftAI-OFFLINE-FALLBACK-105s-R01.mp4'),'-f','null','-'],capture_output=True,text=True,encoding='utf-8',errors='replace')
report['downloaded_fallback_full_decode_exit'] = decoded.returncode
report['downloaded_fallback_decode_errors'] = decoded.stderr
(ROOT/'REMOTE-TRANSFER-VERIFICATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'files':len(results),'all_match':report['all_match'],'decode_exit':decoded.returncode,'commit':SHA}))
assert report['all_match'] and decoded.returncode == 0
