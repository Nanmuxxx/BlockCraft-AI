import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const clock = new URL('./historical-clock.mjs',import.meta.url).pathname
const child = new URL('./sidecar-child.mjs',import.meta.url).pathname
function run(directory,mode,historical=true) {
 const args=[...(historical?['--import',clock]:[]),child,directory,mode]
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}})
 assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout)
}
function directory(){const p=mkdtempSync(join(tmpdir(),'blockcraft-independent-sidecar-'));chmodSync(p,0o700);return p}
for(const mode of ['settled','unknown']) test('separate OS process restart preserves '+mode+' claim and at most one Mock egress',()=>{
 const p=directory(), first=run(p,mode), next=run(p,'replay'), third=run(p,'replay')
 assert.equal(first.code,'OK');assert.equal(next.code,'IDEMPOTENCY_REPLAY');assert.equal(third.code,'IDEMPOTENCY_REPLAY')
 for(const item of [first,next,third]){assert.equal(item.entries,1);assert.equal(item.claims,1);assert.equal(item.halted,mode==='unknown')}
 assert.equal(readFileSync(join(p,'mock-egress.txt'),'utf8'),'MOCK\n')
 console.log(JSON.stringify({case:mode,first,next,third,mockEgress:1,clock:'historical test process only'}))
})
test('native expired clock denies reserve/egress but retains prior durable claim',()=>{
 const p=directory(), first=run(p,'expired',false), retry=run(p,'expired',false)
 assert.equal(first.code,'PRICING_EXPIRED');assert.equal(retry.code,'IDEMPOTENCY_REPLAY')
 assert.equal(first.entries,0);assert.equal(first.claims,1);assert.equal(retry.entries,0)
 assert.equal(existsSync(join(p,'mock-egress.txt')),false)
 console.log(JSON.stringify({case:'native-expiry',first,retry,mockEgress:0,zeroClaim:false}))
})
