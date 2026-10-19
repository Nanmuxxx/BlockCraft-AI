const http = require('node:http')
const https = require('node:https')
const nativeFetch = globalThis.fetch
function allowed(value) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('QA_EXTERNAL_NETWORK_DENIED:' + url.hostname)
  }
}
globalThis.fetch = (input, options) => { allowed(input); return nativeFetch(input, options) }
for (const protocol of [http, https]) {
  const original = protocol.request
  protocol.request = function(input, ...args) {
    if (typeof input === 'string' || input instanceof URL) allowed(input)
    else if (!['127.0.0.1', 'localhost', '::1'].includes(input.hostname || input.host)) throw new Error('QA_EXTERNAL_NETWORK_DENIED')
    return original.call(this, input, ...args)
  }
}
