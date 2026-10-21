from pathlib import Path
import os,subprocess,tempfile,json
out=Path(__file__).parent
snap=Path((out/'SNAPSHOT_PATH.txt').read_text())
env={'PATH':os.environ['PATH'],'HOME':tempfile.mkdtemp(prefix='bc-qa-home-'),'TMPDIR':tempfile.gettempdir(),'NODE_OPTIONS':'--import='+str(out/'deny-external.mjs')}
commands=[('gateway-full',['node','--test',*map(str,sorted((snap/'tests/paid-gateway').glob('*.test.mjs')))]),('launcher-unit',['node','--test',str(snap/'tests/generation/local-owner-launcher.test.mjs')]),('generation-full',['node','--test',*map(str,sorted((snap/'tests/generation').glob('*.test.mjs')))])]
results=[]
for name,cmd in commands:
 with (out/(name+'.log')).open('w') as f:
  p=subprocess.run(cmd,cwd=snap,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 results.append({'name':name,'exit':p.returncode});print(results[-1],flush=True)
for view in ['desktop','mobile']:
 e={**env,'QA_VIEWPORT':view,'QA_EVIDENCE':str(out/view)}
 with (out/(view+'.log')).open('w') as f:
  p=subprocess.run(['node',str(out/'gateway-browser.mjs')],cwd=snap,env=e,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 results.append({'name':view,'exit':p.returncode});print(results[-1],flush=True)
(out/'run-results.json').write_text(json.dumps(results,indent=2))
