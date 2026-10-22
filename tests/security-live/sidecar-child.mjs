import { appendFileSync } from 'node:fs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { openIdempotencySidecar } from '../../server/paid-gateway/idempotency-sidecar.mjs'
const [directory, mode] = process.argv.slice(2)
const ledger = openLedger(directory + '/ledger.json')
const store = openIdempotencySidecar({ ledger, directory, bindingKey: Buffer.alloc(32, 90) })
let code = 'OK'
try {
 const id = store.reserve({principal:'qa-opaque-principal',idempotencyKey:'0123456789abcdefghijklmnopqrstuv',payload:Buffer.from('{"idea":"unpreset-test"}'),inputBound:100,outputBound:100,requestHash:'qa-hash'})
 // Durable local Mock egress marker, only written after reserve succeeds.
 appendFileSync(directory + '/mock-egress.txt', 'MOCK\n', {mode:0o600})
 if (mode === 'unknown') ledger.uncertain(id)
 else ledger.settle(id,{prompt_tokens:1,completion_tokens:1,total_tokens:2})
} catch (e) { code = e.code }
console.log(JSON.stringify({mode,code,entries:ledger.snapshot().entries.length,halted:ledger.snapshot().halted,claims:store.snapshot().claims.length}))
store.close();ledger.close()
