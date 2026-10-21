from pathlib import Path
import os,subprocess,tempfile,json
out=Path(__file__).resolve().parent
snap=Path(os.environ.get('QA_SNAPSHOT') or (out/'CURRENT_SNAPSHOT_PATH.txt').read_text())
env={'PATH':os.environ['PATH'],'HOME':tempfile.mkdtemp(prefix='bc-qa-home-'),'TMPDIR':tempfile.gettempdir(),'NODE_OPTIONS':'--import='+str(out/'deny-external.mjs'),'QA_SNAPSHOT':str(snap)}
commands=[('current-frontend-build',['npm','run','build']),('current-server-build',['npm','--prefix','server','run','build']),('current-protocol-build',['node','server/custom-block/build-protocol.mjs']),('current-targeted',['node','--test','tests/generation/local-owner-launcher.test.mjs','tests/paid-gateway/principal-smoke.test.mjs','tests/paid-gateway/smoke-profile.test.mjs','tests/paid-gateway/principal-runtime.test.mjs']),('current-gateway-full',['node','--test',*map(str,sorted((snap/'tests/paid-gateway').glob('*.test.mjs')))])]
results=[]
for name,cmd in commands:
 with (out/(name+'.log')).open('w') as f:
  try:r=subprocess.run(cmd,cwd=snap,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=90);code=r.returncode
  except subprocess.TimeoutExpired:code='TIMEOUT90s'
 results.append({'name':name,'exit':code});print(results[-1],flush=True)
for view in ['desktop','mobile']:
 with (out/('current-'+view+'.log')).open('w') as f:
  try:r=subprocess.run(['node',str(out/'gateway-browser.mjs')],cwd=snap,env={**env,'QA_VIEWPORT':view,'QA_EVIDENCE':str(out/('current-'+view))},stdout=f,stderr=subprocess.STDOUT,timeout=90);code=r.returncode
  except subprocess.TimeoutExpired:code='TIMEOUT90s'
 results.append({'name':view,'exit':code});print(results[-1],flush=True)
(out/'current-run-results.json').write_text(json.dumps(results,indent=2))
