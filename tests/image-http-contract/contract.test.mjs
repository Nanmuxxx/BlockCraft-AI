import test from 'node:test'
import assert from 'node:assert/strict'
import { validInput, validKey, validJob, IMAGE_PROTOCOL, IMAGE_ERRORS } from '../../server/image-generation/contract.ts'
const input = { version: IMAGE_PROTOCOL, projectId: 'fixture-project', prompt: 'cat' }
test('OFFLINE: strict versioned input and key; JSON round trip', () => {
  assert.ok(validInput(JSON.parse(JSON.stringify(input))))
  for (const x of [null, [], {}, {...input, version:'2'}, {...input, principal:'forged'}, {...input, prompt:'x'.repeat(501)}, {...input,prompt:'a\nb'}, {...input,projectId:'../x'}]) assert.equal(validInput(x), false)
  assert.ok(validKey('request-1234567890'))
  for (const x of [undefined, '', 'x,y', 'a'.repeat(129), ['request-1234567890']]) assert.equal(validKey(x),false)
})
test('OFFLINE: terminal wire state cannot expose image before success or uncertain spend', () => {
  const job = {version:IMAGE_PROTOCOL,kind:'HTTP_MOCK',id:'11111111-1111-4111-8111-111111111111',status:'QUEUED',charge:'NONE',expiresAt:100}
  assert.ok(validJob(job))
  assert.ok(validJob({...job,status:'UNCERTAIN',charge:'UNCERTAIN',error:{code:'BILLING_UNCERTAIN'}}))
  for (const x of [{...job,image:{}},{...job,status:'UNCERTAIN'},{...job,status:'SUCCEEDED'},{...job,error:{code:'raw-upstream'}}]) assert.equal(validJob(x),false)
  assert.equal(IMAGE_ERRORS.IDEMPOTENCY_CONFLICT,409)
})
