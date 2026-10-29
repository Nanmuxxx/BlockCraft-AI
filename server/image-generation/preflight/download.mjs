import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIPv4, BlockList } from 'node:net'
import { validateCandidatePng, CANDIDATE_LIMITS } from './png.mjs'

const error = code => Object.assign(new Error(code), { code })
const privateRanges = new BlockList()
// Conservative IPv4-only policy: reject special-use blocks, including public exceptions.
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) privateRanges.addSubnet(ip,prefix,'ipv4')
export const isPublicIPv4 = value => typeof value === 'string' && isIPv4(value) && !privateRanges.check(value,'ipv4')
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function inspectDownloadUrl(value, allowedHosts = []) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) throw error('DOWNLOAD_REJECTED')
  let url; try { url = new URL(value) } catch { throw error('DOWNLOAD_REJECTED') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
    || !hostPattern.test(url.hostname) || !allowedHosts.includes(url.hostname)) throw error('DOWNLOAD_REJECTED')
  return url
}

/** Inert until explicitly called with a server-owned exact CDN hostname allowlist.
 * No environment/key reads, provider POST, redirects, retries, cookies or proxy agent.
 * DNS + HTTPS are injectable for offline tests. Those functions are trusted server code.
 * This is NOT a generation Provider, authorization gate or durable job/billing ledger.
 */
export function createCandidateDownloader({ allowedHosts = [], lookup = dnsLookup, request = httpsRequest,
  timeoutMs = 10000 } = {}) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.every(h => typeof h === 'string' && hostPattern.test(h))
    || typeof lookup !== 'function' || typeof request !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw error('DOWNLOAD_REJECTED')
  const hosts = [...allowedHosts]
  let active = false
  return Object.freeze({
    resources: () => ({ active }),
    download(value, { signal, expected } = {}) {
      let url
      try {
        url = inspectDownloadUrl(value, hosts)
        if (!(signal instanceof AbortSignal)) throw error('DOWNLOAD_REJECTED')
        if (signal.aborted) throw error('CANCELLED')
        if (active) throw error('DOWNLOAD_BUSY')
      } catch (e) { return Promise.reject(e) }
      active = true
      return new Promise((resolve,reject) => {
        let done = false, req, response, dnsPending = true, timer
        const fail = code => {
          if (done) return
          done = true; clearTimeout(timer); signal.removeEventListener('abort',abort)
          // Capacity remains occupied until actual request close / DNS completion.
          response?.destroy(); req?.destroy()
          if (!req && !dnsPending) active = false
          reject(error(code)) // no upstream message, body, signed URL or secret in diagnostics
        }
        const abort = () => fail('CANCELLED')
        signal.addEventListener('abort',abort,{once:true})
        timer = setTimeout(() => fail('DOWNLOAD_TIMEOUT'),timeoutMs)
        if (signal.aborted) { dnsPending = false; fail('CANCELLED'); return }
        Promise.resolve().then(() => lookup(url.hostname,{all:true,verbatim:true})).then(addresses => {
          dnsPending = false
          if (done) { active = false; return }
          if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32
            || !addresses.every(x => x?.family === 4 && isPublicIPv4(x.address))) { fail('DOWNLOAD_REJECTED'); return }
          const pinned = addresses[0].address
          // Fresh TLS connection, fixed address, original hostname retained for certificate/SNI.
          req = request(url, {method:'GET',agent:false,family:4,servername:url.hostname,rejectUnauthorized:true,
            maxHeaderSize:16384,headers:{Accept:'image/png','Accept-Encoding':'identity'},
            lookup:(_hostname,options,callback) => options?.all
              ? callback(null,[{address:pinned,family:4}]) : callback(null,pinned,4)}, res => {
            response = res
            res.on('error',() => fail('DOWNLOAD_FAILED'))
            if (done) {res.destroy(); return}
            const length = res.headers['content-length']
            if (res.statusCode !== 200 || res.headers['content-type']?.toLowerCase() !== 'image/png'
              || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity'
              || length !== undefined && (typeof length !== 'string' || !/^(0|[1-9][0-9]*)$/.test(length)
                || !Number.isSafeInteger(Number(length)) || Number(length) > CANDIDATE_LIMITS.bytes)) {
              fail('DOWNLOAD_REJECTED'); return
            }
            const chunks = []; let total = 0
            res.on('data',chunk => {
              if (done) return
              if (!(chunk instanceof Uint8Array) || chunk.byteLength > CANDIDATE_LIMITS.bytes-total) {fail('DOWNLOAD_REJECTED'); return}
              total += chunk.byteLength; chunks.push(Buffer.from(chunk))
            })
            res.once('aborted',() => fail('DOWNLOAD_FAILED'))
            res.once('end',() => {
              if (done) return
              if (!res.complete || length !== undefined && total !== Number(length)) {fail('DOWNLOAD_REJECTED'); return}
              let image
              try { image = validateCandidatePng(Buffer.concat(chunks,total),expected) } catch {fail('INVALID_IMAGE'); return}
              done = true; clearTimeout(timer); signal.removeEventListener('abort',abort); resolve(image)
            })
          })
          req.once('error',() => fail('DOWNLOAD_FAILED'))
          req.once('close',() => { active = false; if (!done) fail('DOWNLOAD_FAILED') })
          req.end()
        }).catch(() => { dnsPending = false; if (done && !req) active = false; else fail('DOWNLOAD_FAILED') })
      })
    },
  })
}
