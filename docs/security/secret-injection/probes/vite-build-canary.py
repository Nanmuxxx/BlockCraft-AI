"""Run from an isolated exact #61 candidate checkout. Synthetic canary only."""
import subprocess,pathlib,json
root=pathlib.Path.cwd()
canary='SYNTHETIC-ONLY-BUILD-CANARY-20261019-NO-REAL-KEY'
env={'PATH':'/usr/local/bin:/usr/bin:/bin','DEEPSEEK_API_KEY':canary,'NODE_ENV':'production'}
p=subprocess.run(['/usr/local/bin/npm','run','build'],env=env,text=True,capture_output=True)
files=[x for x in (root/'dist').rglob('*') if x.is_file()]
hits=[str(x.relative_to(root)) for x in files if canary.encode() in x.read_bytes()]
result={'sha':'63a4ab2b65b9ffba72875a383a4ad82f472725fe','build_exit':p.returncode,'dist_files_scanned':len(files),'canary_hits':hits,'build_output_canary_leak':canary in p.stdout+p.stderr,'real_model_calls':0,'scope':'Vite dist and build output only, no container image/Studio build claim'}
(root/'supervisor-build-canary-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
assert p.returncode==0 and not hits and not result['build_output_canary_leak']
