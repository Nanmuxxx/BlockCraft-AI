import subprocess, pathlib, os, json, time, platform
root=pathlib.Path('/Users/nanmuxun/BlockAI/BlockCraft-AI-image-http-phase2');os.chdir(root)
out=root/'docs/acceptance/image-http-rework/stale-async'; logs=out/'logs';logs.mkdir(exist_ok=True)
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
env=dict(os.environ,NODE_PATH='/tmp/blockcraft-workshop-browser-tools/node_modules',GALLERY_EXPECTED_SHA=sha)
commands=[
('types','node node_modules/typescript/bin/tsc -b',{}),
('server-types','node node_modules/typescript/bin/tsc -p server/tsconfig.json',{}),
('provider-types','node node_modules/typescript/bin/tsc -p server/image-generation/tsconfig.json',{}),
('contracts','node --test --test-timeout=10000 tests/image-backend/provider.test.mjs tests/image-http-contract/*.test.mjs',{}),
('server','npm --prefix server test',{}),
('default','npm test',{}),
('prepare','node tools/project-zip-export/prepare.mjs',{}),
('resources','node --test tests/project-json/*.test.cjs tests/project-package/*.test.cjs tests/custom-block-bc/*.test.cjs tests/workshop-export/*.test.*',{}),
('generation','npm run test:generation',{}),
('http-1440','node tests/gallery-generation/browser.cjs',{'GALLERY_TEST_PROVIDER':'HTTP_MOCK'}),
('http-390','node tests/gallery-generation/browser.cjs',{'GALLERY_TEST_PROVIDER':'HTTP_MOCK','GALLERY_VIEWPORT_WIDTH':'390'}),
('rework-1440','node tests/image-http-integration/rework.browser.cjs',{}),
('rework-390','node tests/image-http-integration/rework.browser.cjs',{'GALLERY_VIEWPORT_WIDTH':'390'}),
('fixed-mock','node tests/gallery-generation/browser.cjs',{'GALLERY_TEST_PROVIDER':'MOCK'}),
('canvas','node tests/gallery-generation/browser.cjs',{}),
('zip-browser','node tests/project-package/browser.cjs',{}),
('build','npm run build',{'VITE_IMAGE_HTTP_FIXTURE':'1'}),
('production','node tests/image-http-integration/production.cjs',{})]
results={'head_sha':sha,'environment':{'platform':platform.platform(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'playwright':subprocess.check_output(['node','/tmp/blockcraft-workshop-browser-tools/node_modules/playwright/cli.js','--version'],text=True).strip()},'common_env':{'NODE_PATH':env['NODE_PATH'],'GALLERY_EXPECTED_SHA':sha},'commands':[]}
for name,cmd,extra in commands:
 extra={**extra,'GALLERY_EVIDENCE_DIR':str(out/name)}
 start=time.time(); print('START',name,sha,flush=True)
 with (logs/(name+'.log')).open('w') as f:
  try: r=subprocess.run(cmd,shell=True,executable='/bin/zsh',env={**env,**extra},stdout=f,stderr=subprocess.STDOUT,timeout=300);code=r.returncode
  except subprocess.TimeoutExpired: code=124;f.write('\nRUNNER_DEADLINE_300_SECONDS\n')
 result={'name':name,'command':cmd,'env':extra,'mode':'MOCK/OFFLINE; REAL_PROVIDER=NOT_RUN','head_sha':sha,'exit_code':code,'seconds':round(time.time()-start,2)}
 results['commands'].append(result);(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
 print('END',name,code,result['seconds'],flush=True)
 if code: print((logs/(name+'.log')).read_text()[-6000:],flush=True);raise SystemExit(code)
print('ALL18_PASS',sha,flush=True)
