import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {openLedger}=await import(pathToFileURL(join(process.cwd(),'server/paid-gateway/ledger.mjs')).href);
const {openIdempotencySidecar}=await import(pathToFileURL(join(process.cwd(),'server/paid-gateway/idempotency-sidecar.mjs')).href);
const directory=mkdtempSync(join(tmpdir(),'sidecar-multiple-handles-'));
const ledger=openLedger(join(directory,'ledger.json'));
const options={ledger,directory,bindingKey:Buffer.alloc(32,0x5a)};
const a=openIdempotencySidecar(options);
const b=openIdempotencySidecar(options);
const claim={principal:'synthetic-principal',idempotencyKey:'0123456789abcdefghijklmnopqrstuv',payload:Buffer.from('{"idea":"task"}'),inputBound:100,outputBound:100,requestHash:'synthetic'};
try {
 const first=a.reserve(claim); ledger.settle(first,{prompt_tokens:1,completion_tokens:1,total_tokens:2}); let second;
 try{second={id:b.reserve(claim)}}catch(error){second={code:error.code}}
 console.log(JSON.stringify({candidate_sha:'c1c7df0c68e9c7ecc337ffd296ed5a3042615e4b',same_principal_key_payload:true,first:!!first,second,ledger_entries:ledger.snapshot().entries.length,sidecar_claims:a.snapshot().claims.length,real_model_calls:0}));
} finally{a.close();b.close();ledger.close();rmSync(directory,{recursive:true,force:true})}
