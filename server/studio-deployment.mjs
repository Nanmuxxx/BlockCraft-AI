/** Isolated, owner-approved ModelScope test deployment. No production migration.
 * The persistent directory is created once; partial/changed state is refused.
 * Never remove/rename this Studio or its persistent volume to recover allowance.
 */
import { mkdirSync, lstatSync, realpathSync, openSync, closeSync, constants, fstatSync,
  readFileSync, writeFileSync, fsyncSync, chmodSync, fchmodSync, readdirSync, mkdtempSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { startStudioServer } from './studio-launcher.mjs'
import { startServer, installShutdownHandlers, createOpaqueSessionPrincipalResolver } from './index.mjs'
import { openLedger } from './paid-gateway/ledger.mjs'
import { STUDIO_MVP_POLICY, LEGACY_STUDIO_MVP_POLICY, STUDIO_PRICING as PRICING, STUDIO_AUTHORIZATION } from './paid-gateway/pricing.mjs'
import { createLivePricingVerifier } from './paid-gateway/live-pricing.mjs'

export const ORIGIN = 'https://nanmuxxx-blockcraft-ai-test-7a2adbb-20261020.ms.show'
const DIRECTORY = '/mnt/workspace/blockcraft-test-10cny-20261020'
const digest = value => createHash('sha256').update(value).digest('hex')
const refuse = (stage = 'private-file') => { throw Object.assign(new Error('TEST_STATE_REFUSED'), { stage }) }

export function classifyTestStartupError(error, fallbackStage = 'storage-or-configuration') {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'UNCLASSIFIED'
  const stage = typeof error?.stage === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(error.stage)
    ? error.stage : fallbackStage
  return { code, stage }
}

function privateRead(path, limit = 1024 * 1024, allowMountedDirectory = false) {
  if (realpathSync(path) !== path) refuse('file-canonical')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    const mode = stat.mode & 0o777
    const mountedFileAccepted = allowMountedDirectory && (mode === 0o644 || mode === 0o666 || mode === 0o777)
    if (!stat.isFile() || stat.uid !== process.getuid() || (mode !== 0o600 && !mountedFileAccepted) || stat.nlink !== 1 || stat.size > limit) {
      console.error(JSON.stringify({ event: 'studio-test-file-check', regular: stat.isFile(),
        ownerMatches: stat.uid === process.getuid(), mode: mode.toString(8), singleLink: stat.nlink === 1, bounded: stat.size <= limit }))
      refuse('file-metadata')
    }
    return readFileSync(fd)
  } finally { closeSync(fd) }
}

function createPrivate(path, bytes, allowMountedDirectory = false) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600)
  try {
    fchmodSync(fd, 0o600)
    const mode = fstatSync(fd).mode & 0o777
    if (mode !== 0o600 && !(allowMountedDirectory && (mode === 0o644 || mode === 0o666 || mode === 0o777))) {
      console.error(JSON.stringify({ event: 'studio-test-new-file-mode', mode: mode.toString(8), mounted: allowMountedDirectory }))
      refuse('new-file-permissions')
    }
    writeFileSync(fd, bytes); fsyncSync(fd)
  } finally { closeSync(fd) }
}

function replacePrivate(path, bytes, allowMountedDirectory = false) {
  const directory = dirname(path)
  const temp = join(directory, `.studio-migrate-${randomBytes(16).toString('hex')}`)
  createPrivate(temp, bytes, allowMountedDirectory)
  renameSync(temp, path)
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function migrateStudioState({ directory, access, receipt, allowMountedDirectory }) {
  const receiptPath = join(directory, 'deployment-receipt.json')
  const currentReceipt = privateRead(receiptPath, 4096, allowMountedDirectory).toString()
  if (currentReceipt !== JSON.stringify(receipt)) {
    let legacy
    try { legacy = JSON.parse(currentReceipt) } catch { refuse('receipt-mismatch') }
    const expectedLegacy = { version: 1, policy: LEGACY_STUDIO_MVP_POLICY.id, origin: ORIGIN,
      accessHash: digest(access), expiresAt: PRICING.expiresAt }
    if (JSON.stringify(legacy) !== JSON.stringify(expectedLegacy)) refuse('receipt-mismatch')
    replacePrivate(receiptPath, Buffer.from(JSON.stringify(receipt)), allowMountedDirectory)
    console.info(JSON.stringify({ event: 'studio-test-policy-migrated', from: LEGACY_STUDIO_MVP_POLICY.id, to: STUDIO_MVP_POLICY.id }))
  }

  const approvalPath = join(directory, 'approval.json')
  const approval = JSON.parse(privateRead(approvalPath, 65536, allowMountedDirectory))
  const approvalIsLegacy = approval.policyId === LEGACY_STUDIO_MVP_POLICY.id && approval.approval?.reference === LEGACY_STUDIO_MVP_POLICY.approval &&
    approval.approval.maxCalls === LEGACY_STUDIO_MVP_POLICY.maxCalls
  const approvalIsCurrent = approval.policyId === STUDIO_MVP_POLICY.id && approval.approval?.reference === STUDIO_MVP_POLICY.approval &&
    approval.approval.maxCalls === STUDIO_MVP_POLICY.maxCalls
  if (approvalIsLegacy) {
    const migrated = { ...approval, policyId: STUDIO_MVP_POLICY.id,
      approval: { ...approval.approval, reference: STUDIO_MVP_POLICY.approval, maxCalls: STUDIO_MVP_POLICY.maxCalls } }
    replacePrivate(approvalPath, Buffer.from(JSON.stringify(migrated)), allowMountedDirectory)
  } else if (!approvalIsCurrent) refuse('approval-mismatch')

  const ledgerPath = join(directory, 'studio-ledger.json')
  const ledger = JSON.parse(privateRead(ledgerPath, 1024 * 1024, allowMountedDirectory))
  if (ledger.approval === LEGACY_STUDIO_MVP_POLICY.approval && ledger.profile === 'studio-mvp' &&
      Array.isArray(ledger.entries) && ledger.entries.every(entry => entry.status === 'settled')) {
    replacePrivate(ledgerPath, Buffer.from(JSON.stringify({ ...ledger, approval: STUDIO_MVP_POLICY.approval })), allowMountedDirectory)
  } else if (ledger.approval !== STUDIO_MVP_POLICY.approval || ledger.profile !== 'studio-mvp') refuse('ledger-mismatch')
}

// A signed, separately preserved renewal changes only authorization deadlines.
// Original receipt, pricing and ledger bytes are never relabelled or reset.
function renewStudioAuthorization({ directory, allowMountedDirectory }) {
  const path = join(directory, 'approval.json')
  const bytes = privateRead(path, 65536, allowMountedDirectory)
  const approval = JSON.parse(bytes)
  const backupName = 'approval.pre-lifetime-v1.json'
  const authorizationName = 'studio-lifetime-authorization-v1.json'
  const key = privateRead(join(directory, 'binding.key'), 32, allowMountedDirectory)
  const signed = payload => JSON.stringify({ payload, mac: createHmac('sha256', key).update('studio-lifetime-v1\0').update(JSON.stringify(payload)).digest('hex') })
  const names = readdirSync(directory)
  if (!names.includes(backupName)) {
    if (names.includes(authorizationName) || approval.issuer || approval.approval?.expiresAt !== PRICING.expiresAt
        || !Array.isArray(approval.sessions) || approval.sessions.some(s => s.expiresAt !== PRICING.expiresAt)) refuse('lifetime-predecessor')
    createPrivate(join(directory, backupName), bytes, allowMountedDirectory)
    const payload = { version: 1, authorization: STUDIO_AUTHORIZATION.id, predecessorHash: digest(bytes),
      maxCalls: STUDIO_AUTHORIZATION.maxCalls, maxNano: STUDIO_AUTHORIZATION.maxNano, expiresAt: STUDIO_AUTHORIZATION.expiresAt }
    createPrivate(join(directory, authorizationName), signed(payload), allowMountedDirectory)
    replacePrivate(path, JSON.stringify({ ...approval,
      approval: { ...approval.approval, expiresAt: STUDIO_AUTHORIZATION.expiresAt },
      sessions: approval.sessions.map(s => ({ ...s, expiresAt: STUDIO_AUTHORIZATION.expiresAt })) }), allowMountedDirectory)
  }
  const originalBytes = privateRead(join(directory, backupName), 65536, allowMountedDirectory)
  const original = JSON.parse(originalBytes)
  const payload = { version: 1, authorization: STUDIO_AUTHORIZATION.id, predecessorHash: digest(originalBytes),
    maxCalls: STUDIO_AUTHORIZATION.maxCalls, maxNano: STUDIO_AUTHORIZATION.maxNano, expiresAt: STUDIO_AUTHORIZATION.expiresAt }
  if (privateRead(join(directory, authorizationName), 4096, allowMountedDirectory).toString() !== signed(payload)) refuse('lifetime-receipt')
  const expected = { ...original, approval: { ...original.approval, expiresAt: STUDIO_AUTHORIZATION.expiresAt },
    sessions: original.sessions.map(s => ({ ...s, expiresAt: STUDIO_AUTHORIZATION.expiresAt })) }
  if (privateRead(path, 65536, allowMountedDirectory).toString() !== JSON.stringify(expected)) refuse('lifetime-approval')
}

export function prepareTestState({ directory = DIRECTORY, access, now = Date.now(), policy = STUDIO_MVP_POLICY,
  allowMountedDirectory = false, studioAuthorization = false } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(access || '') || !studioAuthorization && now >= PRICING.expiresAt) refuse('access-or-expiry')
  let created = false
  try { mkdirSync(directory, { mode: 0o700 }); created = true }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  let stat = lstatSync(directory)
  // The first cloud attempt confirmed an empty, owned, canonical directory
  // whose mount ignored mkdir's requested mode. Tighten only that empty
  // initial directory; never chmod/recover any existing receipt or ledger.
  if (stat.isDirectory() && stat.uid === process.getuid() && realpathSync(directory) === directory &&
      (stat.mode & 0o777) === 0o777 && readdirSync(directory).length === 0) {
    chmodSync(directory, 0o700)
    stat = lstatSync(directory)
    created = true
    console.info(JSON.stringify({ event: 'studio-test-empty-directory-mode', mode: (stat.mode & 0o777).toString(8) }))
  }
  const mountedDirectoryAccepted = allowMountedDirectory && stat.isDirectory() && stat.uid === process.getuid() &&
    realpathSync(directory) === directory && (stat.mode & 0o777) === 0o777
  if (!stat.isDirectory() || stat.uid !== process.getuid() ||
      ((stat.mode & 0o777) !== 0o700 && !mountedDirectoryAccepted) || realpathSync(directory) !== directory) {
    console.error(JSON.stringify({ event: 'studio-test-directory-check', directoryType: stat.isDirectory(),
      ownerMatches: stat.uid === process.getuid(), mode: (stat.mode & 0o777).toString(8), canonical: realpathSync(directory) === directory }))
    refuse('directory-metadata')
  }
  const receipt = { version: 1, policy: policy.id, origin: ORIGIN, accessHash: digest(access), expiresAt: PRICING.expiresAt }
  let repairedEmptyReceipt = false
  if (allowMountedDirectory && !created && readdirSync(directory).length === 1 &&
      readdirSync(directory)[0] === 'deployment-receipt.json') {
    const receiptPath = join(directory, 'deployment-receipt.json')
    const fd = openSync(receiptPath, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const receiptStat = fstatSync(fd)
      if (!receiptStat.isFile() || receiptStat.uid !== process.getuid() || receiptStat.nlink !== 1 || receiptStat.size !== 0) refuse('receipt-repair-state')
      writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd)
    } finally { closeSync(fd) }
    repairedEmptyReceipt = true
    created = true
    console.info(JSON.stringify({ event: 'studio-test-empty-receipt-repaired' }))
  }
  if (created) {
    // Receipt is written first. Any interruption leaves an incomplete directory
    // that requires review, never implicit reinitialization or budget reset.
    if (!repairedEmptyReceipt) createPrivate(join(directory, 'deployment-receipt.json'), JSON.stringify(receipt), allowMountedDirectory)
    createPrivate(join(directory, 'binding.key'), randomBytes(32), allowMountedDirectory)
    const approval = { version: 1, publicOrigin: ORIGIN, policyId: policy.id,
      approval: { providerVerified: true, permissionsVerified: true,
        reference: policy.approval, maxCalls: policy.maxCalls, expiresAt: PRICING.expiresAt },
      sessions: [{ sessionHash: digest(access), principal: 'studio-test-owner-20261020',
        expiresAt: PRICING.expiresAt, revoked: false, appId: 'pomodoro' }] }
    createPrivate(join(directory, 'approval.json'), JSON.stringify(approval), allowMountedDirectory)
    const ledger = openLedger(join(directory, 'studio-ledger.json'), { policy, profile: 'studio-mvp', allowMountedDirectory })
    ledger.close()
    const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
  migrateStudioState({ directory, access, receipt, allowMountedDirectory })
  if (studioAuthorization) {
    if (policy !== STUDIO_MVP_POLICY) refuse('lifetime-policy')
    renewStudioAuthorization({ directory, allowMountedDirectory })
  }
  if (privateRead(join(directory, 'binding.key'), 32, allowMountedDirectory).length !== 32) refuse()
  const approval = JSON.parse(privateRead(join(directory, 'approval.json'), 65536, allowMountedDirectory))
  if (approval.policyId !== policy.id || approval.publicOrigin !== ORIGIN || approval.sessions?.[0]?.sessionHash !== digest(access)) refuse()
  return { directory, approval, created }
}

/** Supplemental MVP grant has its own immutable receipts beside legacy state.
 * Legacy allowance files are never read, changed, or included in this budget.
 */
export function claimMvpBoot({ directory = DIRECTORY, access, now = Date.now(), allowMountedDirectory = false, studioAuthorization = false } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(access || '') || !studioAuthorization && now >= PRICING.expiresAt) refuse('access-or-expiry')
  try { mkdirSync(directory, { mode: 0o700 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || realpathSync(directory) !== directory) refuse('mvp-directory')
  const markerName = 'mvp-5cny-20261022-allowance-spent.json'
  const markerPath = join(directory, markerName)
  const bootId = randomBytes(16).toString('hex')
  const sign = value => createHmac('sha256', access).update(JSON.stringify(value)).digest('hex')
  const encode = value => Buffer.from(JSON.stringify({ ...value, mac: sign(value) }))
  function readBounded(path) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const s = fstatSync(fd)
      if (!s.isFile() || s.nlink !== 1 || s.size > 4096) refuse('mvp-receipt')
      return readFileSync(fd)
    } finally { closeSync(fd) }
  }
  function once(name, bytes) {
    const path = join(directory, name)
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600)
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    let duplicate
    try { duplicate = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    if (duplicate !== undefined) { closeSync(duplicate); refuse('mvp-exclusive-create') }
    const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(parent) } finally { closeSync(parent) }
    if (!readBounded(path).equals(bytes)) refuse('mvp-receipt-readback')
  }
  function preserve(name, bytes) {
    const path = join(directory, name)
    if (readdirSync(directory).includes(name)) {
      if (!readBounded(path).equals(bytes)) refuse('mvp-predecessor-mismatch')
      return
    }
    once(name, bytes)
  }
  let marker
  if (readdirSync(directory).includes(markerName)) {
    marker = readBounded(markerPath)
    let parsed
    try { parsed = JSON.parse(marker.toString('utf8')) } catch { refuse('mvp-marker-invalid') }
    if (!parsed || parsed.version !== 1 || ![STUDIO_MVP_POLICY.id, LEGACY_STUDIO_MVP_POLICY.id].includes(parsed.policy) ||
        ![STUDIO_MVP_POLICY.maxCalls, LEGACY_STUDIO_MVP_POLICY.maxCalls].includes(parsed.maxCalls) ||
        ![STUDIO_MVP_POLICY.conservativeNano / 1e9, LEGACY_STUDIO_MVP_POLICY.conservativeNano / 1e9].includes(parsed.reservedCny) ||
        parsed.expiresAt !== PRICING.expiresAt || parsed.restart !== 'paid-disabled' ||
        typeof parsed.bootId !== 'string' || !/^[a-f0-9]{32}$/.test(parsed.bootId) ||
        typeof parsed.mac !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.mac) || parsed.mac !== sign({ ...parsed, mac: undefined })) refuse('mvp-marker-invalid')
    if (parsed.policy === LEGACY_STUDIO_MVP_POLICY.id || parsed.maxCalls === LEGACY_STUDIO_MVP_POLICY.maxCalls ||
        parsed.reservedCny === LEGACY_STUDIO_MVP_POLICY.conservativeNano / 1e9) {
      preserve('mvp-5cny-20261022-allowance-spent.predecessor.json', marker)
      marker = encode({ version: 1, policy: STUDIO_MVP_POLICY.id, bootId: parsed.bootId, spentAt: parsed.spentAt,
        expiresAt: parsed.expiresAt, maxCalls: STUDIO_MVP_POLICY.maxCalls,
        reservedCny: STUDIO_MVP_POLICY.conservativeNano / 1e9, restart: 'paid-disabled' })
      replacePrivate(markerPath, marker, allowMountedDirectory)
      console.info(JSON.stringify({ event: 'studio-test-mvp-grant-migrated', from: LEGACY_STUDIO_MVP_POLICY.id, to: STUDIO_MVP_POLICY.id }))
    }
  } else {
    marker = encode({ version: 1, policy: STUDIO_MVP_POLICY.id, bootId, spentAt: now,
      expiresAt: PRICING.expiresAt, maxCalls: STUDIO_MVP_POLICY.maxCalls,
      reservedCny: STUDIO_MVP_POLICY.conservativeNano / 1e9, restart: 'paid-disabled' })
    once(markerName, marker)
  }
  const markerValue = JSON.parse(marker.toString('utf8'))
  const activeBootId = markerValue.bootId
  let calls = readdirSync(directory).filter(name => /^mvp-5cny-attempt-\d+\.json$/.test(name)).length
  function historyDiagnostic() {
    // Read-only, bounded provenance summary. Never emit record contents, IDs,
    // credentials, signatures, request hashes or application data.
    try {
      const legacy = JSON.parse(readBounded(join(directory, 'mvp-5cny-20261021-allowance-spent.json')))
      const legacySignatureMatches = typeof legacy.mac === 'string' && legacy.mac === sign({ ...legacy, mac: undefined })
      const groups = { current: [], legacy: [], unmatched: [] }
      let signaturesMatch = true, metadataMatches = true
      for (let call = 1; call <= calls; call++) {
        const record = JSON.parse(readBounded(join(directory, `mvp-5cny-attempt-${call}.json`)))
        signaturesMatch &&= typeof record.mac === 'string' && record.mac === sign({ ...record, mac: undefined })
        metadataMatches &&= record.version === 1 && record.call === call && record.state === 'attempt-reserved'
        groups[record.bootId === activeBootId ? 'current' : record.bootId === legacy.bootId ? 'legacy' : 'unmatched'].push(call)
      }
      const scopes = {}
      for (const date of ['20261021', '20261022']) {
        try {
          const ledger = JSON.parse(privateRead(join(directory, `mvp-5cny-${date}-scope`, 'studio-ledger.json'), 1024 * 1024, allowMountedDirectory))
          scopes[date] = { entries: ledger.entries.length, halted: ledger.halted === true,
            settled: ledger.entries.filter(e => e.status === 'settled').length,
            reserved: ledger.entries.filter(e => e.status === 'reserved').length,
            uncertain: ledger.entries.filter(e => e.status === 'uncertain').length }
        } catch { scopes[date] = { readable: false } }
      }
      console.error(JSON.stringify({ event: 'studio-test-mvp-history-provenance', legacySignatureMatches,
        signaturesMatch, metadataMatches, groups: Object.fromEntries(Object.entries(groups).map(([name, indices]) =>
          [name, { count: indices.length, first: indices[0] ?? null, last: indices.at(-1) ?? null }])), scopes }))
    } catch { console.error(JSON.stringify({ event: 'studio-test-mvp-history-provenance', readable: false })) }
  }
  return {
    assertLedgerHistory(entryCount) {
      // The Oct 21 boot used a temporary primary ledger. Its one signed
      // attempt survives outside that ledger; charge the complete bounded
      // transport ceiling permanently, without inventing usage or rewriting it.
      let historicalDebit
      if (studioAuthorization && entryCount === calls - 1 && readdirSync(directory).includes('mvp-5cny-20261021-allowance-spent.json')) {
        const legacyBytes = readBounded(join(directory, 'mvp-5cny-20261021-allowance-spent.json'))
        const attemptBytes = readBounded(join(directory, 'mvp-5cny-attempt-1.json'))
        const responseBytes = readBounded(join(directory, 'mvp-5cny-response-1.json'))
        const legacy = JSON.parse(legacyBytes), attempt = JSON.parse(attemptBytes), response = JSON.parse(responseBytes)
        const exact = (record, fields) => record && JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...fields, 'mac'].sort())
          && typeof record.mac === 'string' && /^[a-f0-9]{64}$/.test(record.mac)
          && timingSafeEqual(Buffer.from(record.mac, 'hex'), Buffer.from(sign({ ...record, mac: undefined }), 'hex'))
        const legacyExpiry = Date.parse('2026-10-22T00:00:00+08:00')
        const knownSamplesStart = Date.parse('2026-10-22T12:45:01.006Z')
        if (!exact(legacy, ['version', 'policy', 'bootId', 'spentAt', 'expiresAt', 'maxCalls', 'reservedCny', 'restart'])
            || legacy.version !== 1 || legacy.policy !== 'OWNER-APPROVED-STUDIO-MVP-5-CNY-20261021'
            || !/^[a-f0-9]{32}$/.test(legacy.bootId) || legacy.bootId === activeBootId
            || legacy.maxCalls !== 8 || legacy.reservedCny !== 5 || legacy.restart !== 'paid-disabled'
            || legacy.expiresAt !== legacyExpiry || !Number.isSafeInteger(legacy.spentAt) || legacy.spentAt <= 0
            || !exact(attempt, ['version', 'bootId', 'call', 'at', 'state'])
            || attempt.version !== 1 || attempt.bootId !== legacy.bootId || attempt.call !== 1 || attempt.state !== 'attempt-reserved'
            || !Number.isSafeInteger(attempt.at) || attempt.at < legacy.spentAt || attempt.at >= legacyExpiry
            || !exact(response, ['version', 'bootId', 'call', 'at', 'status'])
            || response.version !== 1 || response.bootId !== legacy.bootId || response.call !== 1 || response.status !== 200
            || !Number.isSafeInteger(response.at) || response.at < attempt.at || response.at >= knownSamplesStart) refuse('legacy-history-unverified')
        const oldScope = JSON.parse(privateRead(join(directory, 'mvp-5cny-20261021-scope', 'studio-ledger.json'), 1024 * 1024, allowMountedDirectory))
        const oldPricing = { ...PRICING, verifiedDate: '2026-10-21', expiresAt: legacyExpiry }
        if (oldScope.version !== 3 || oldScope.profile !== 'studio-mvp' || oldScope.approval !== legacy.policy
            || JSON.stringify(oldScope.pricing) !== JSON.stringify(oldPricing)
            || !Array.isArray(oldScope.entries) || oldScope.entries.length !== 0 || oldScope.halted !== false) refuse('legacy-history-unverified')
        historicalDebit = Object.freeze({ calls: 1, nano: 212_992_000,
          evidenceHash: digest(Buffer.concat([legacyBytes, Buffer.from('\0'), attemptBytes, Buffer.from('\0'), responseBytes])) })
        console.info(JSON.stringify({ event: 'studio-test-legacy-debit-verified', calls: 1, conservativeNano: historicalDebit.nano,
          markerAt: legacy.spentAt, attemptAt: attempt.at, responseAt: response.at, responseStatus: response.status, separateFromKnownSamples: true }))
      }
      const names = readdirSync(directory).filter(name => /^mvp-5cny-attempt-\d+\.json$/.test(name)).sort()
      const expected = Array.from({ length: calls }, (_, i) => `mvp-5cny-attempt-${i + 1}.json`).sort()
      if (historicalDebit) {
        const responses = readdirSync(directory).filter(name => /^mvp-5cny-response-\d+\.json$/.test(name)).sort()
        const expectedResponses = Array.from({ length: calls }, (_, i) => `mvp-5cny-response-${i + 1}.json`).sort()
        if (JSON.stringify(responses) !== JSON.stringify(expectedResponses)) refuse('legacy-history-unverified')
      }
      if (!Number.isSafeInteger(entryCount) || entryCount + (historicalDebit?.calls ?? 0) !== calls || JSON.stringify(names) !== JSON.stringify(expected)) {
        console.error(JSON.stringify({ event: 'studio-test-mvp-history-check', ledgerEntries: entryCount,
          attemptReceipts: calls, countersContinuous: JSON.stringify(names) === JSON.stringify(expected) }))
        historyDiagnostic()
        refuse('mvp-history-mismatch')
      }
      for (let call = historicalDebit ? 2 : 1; call <= calls; call++) {
        const record = JSON.parse(readBounded(join(directory, `mvp-5cny-attempt-${call}.json`)))
        if (record.version !== 1 || record.bootId !== activeBootId || record.call !== call || record.state !== 'attempt-reserved'
            || typeof record.mac !== 'string' || record.mac !== sign({ ...record, mac: undefined })) {
          console.error(JSON.stringify({ event: 'studio-test-mvp-history-check', ledgerEntries: entryCount,
            attemptReceipts: calls, receiptIndex: call, versionMatches: record.version === 1,
            bootMatches: record.bootId === activeBootId, counterMatches: record.call === call,
            stateMatches: record.state === 'attempt-reserved', signatureMatches: typeof record.mac === 'string' && record.mac === sign({ ...record, mac: undefined }) }))
          historyDiagnostic()
          refuse('mvp-history-mismatch')
        }
      }
      return historicalDebit
    },
    wrap(fetchImpl = globalThis.fetch) {
      return async (url, init) => {
        const count = calls + 1
        if (!readBounded(join(directory, markerName)).equals(marker) ||
            count > (studioAuthorization ? STUDIO_AUTHORIZATION.maxCalls - STUDIO_AUTHORIZATION.knownHistoricalCalls : STUDIO_MVP_POLICY.maxCalls) ||
            !studioAuthorization && Date.now() >= PRICING.expiresAt) refuse('mvp-grant-invalid')
        once(`mvp-5cny-attempt-${count}.json`, encode({ version: 1, bootId: activeBootId, call: count,
          at: Date.now(), state: 'attempt-reserved' }))
        calls = count
        const response = await fetchImpl(url, init)
        once(`mvp-5cny-response-${count}.json`, encode({ version: 1, bootId: activeBootId, call: count,
          at: Date.now(), status: response.status }))
        return response
      }
    },
  }
}

const send = (res, status, value, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...extra })
  res.end(JSON.stringify(value))
}

export async function startTestDeployment({ env = process.env, directory = DIRECTORY, host = '0.0.0.0',
  port = Number(env.PORT || 7860), fetchImpl, signalHandlers = true, singleBoot = false, mvpSupplemental = false, mochiEnabled = false, studioAuthorization = false,
  verifyPricing = createLivePricingVerifier() } = {}) {
  const access = env.BLOCKCRAFT_TEST_ACCESS?.trim()
  let configured = Boolean(env.DEEPSEEK_API_KEY?.trim() && access)
  let unavailable = configured ? null : 'AI_NOT_CONFIGURED'
  let state, started, supplementalGrant, historicalDebit, resolvePrincipal = () => null
  if (configured) {
    let startupStage = 'pricing-verification'
    try {
      if (studioAuthorization && (!mvpSupplemental || typeof verifyPricing.assertCurrent !== 'function')) refuse('lifetime-pricing-guard')
      await verifyPricing()
      const providerFetch = fetchImpl || globalThis.fetch
      fetchImpl = async (...args) => { await verifyPricing(); return providerFetch(...args) }
      if (mvpSupplemental) {
        startupStage = 'supplemental-grant'
        const legacyMarker = join(directory, 'mvp-5cny-20261022-allowance-spent.json')
        const scope = join(directory, 'mvp-5cny-20261022-scope')
        const grant = claimMvpBoot({ directory: dirname(legacyMarker), access, allowMountedDirectory: true, studioAuthorization })
        supplementalGrant = grant
        directory = scope
        fetchImpl = grant.wrap(fetchImpl)
      }
      startupStage = 'isolated-state'
      state = prepareTestState({ directory, access, policy: STUDIO_MVP_POLICY,
        allowMountedDirectory: mvpSupplemental, studioAuthorization })
      if (studioAuthorization) historicalDebit = supplementalGrant.assertLedgerHistory(JSON.parse(privateRead(join(directory, 'studio-ledger.json'), 1024 * 1024, mvpSupplemental)).entries.length)
      resolvePrincipal = createOpaqueSessionPrincipalResolver({ sessions: state.approval.sessions })
      startupStage = 'studio-server'
      started = await startStudioServer({ env: { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
        STUDIO_APPROVAL_PATH: join(directory, 'approval.json'), PUBLIC_ORIGIN: ORIGIN },
        host, port, fetchImpl, signalHandlers: false, policy: STUDIO_MVP_POLICY, profile: 'studio-mvp',
        allowMountedDirectory: mvpSupplemental, mochiEnabled, studioAuthorization, historicalDebit, verifyPricing, pricingGuard: verifyPricing.assertCurrent })
    } catch (error) {
      // A storage, approval or expiry failure disables paid egress; the frontend
      // remains usable. Never fall back to an unprotected configured provider.
      if (!singleBoot && !mvpSupplemental) throw error
      configured = false; resolvePrincipal = () => null; unavailable = 'AI_AUTHORIZATION_LOCKED'
      console.error(JSON.stringify({ event: 'studio-test-paid-disabled', ...classifyTestStartupError(error, startupStage) }))
    }
  }
  if (!started) {
    // Missing secrets must not accidentally select the unprotected provider.
    started = await startServer({ host, port, env: {} })
  }
  const authorizationExpiry = studioAuthorization ? STUDIO_AUTHORIZATION.expiresAt : PRICING.expiresAt
  const priceCurrent = () => { try { if (studioAuthorization) verifyPricing.assertCurrent(); return true } catch { return false } }
  const handlers = started.server.listeners('request')
  started.server.removeAllListeners('request')
  const attempts = new Map()
  const pending = new Set()
  async function login(req, res) {
    let timer
    try {
      if (!configured || Date.now() >= authorizationExpiry) { send(res, 503, { error: 'AI_NOT_CONFIGURED' }); return }
      const origins = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin')
      if (origins.length !== 1 || req.headers.origin !== ORIGIN ||
          req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') { send(res, 403, { error: 'ORIGIN_REJECTED' }); return }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') { send(res, 415, { error: 'INVALID_REQUEST' }); return }
      for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key)
      const ip = req.socket.remoteAddress
      if (!attempts.has(ip)) {
        if (attempts.size >= 1000) { send(res, 429, { error: 'RATE_LIMITED' }); return }
        attempts.set(ip, { count: 0, until: Date.now() + 60_000 })
      }
      if (++attempts.get(ip).count > 5) { send(res, 429, { error: 'RATE_LIMITED' }); return }
      let size = 0
      const chunks = []
      timer = setTimeout(() => req.destroy(), 3000)
      for await (const chunk of req) {
        size += chunk.length
        if (size > 1024) { req.destroy(); return }
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || Object.keys(body).length !== 1 || typeof body.credential !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(body.credential) || !timingSafeEqual(Buffer.from(digest(body.credential), 'hex'), Buffer.from(digest(access), 'hex'))) {
        send(res, 401, { error: 'UNAUTHORIZED' }); return
      }
      // Session renewal is separate from the budget grant's no-date limit.
      const maxAge = 30 * 24 * 60 * 60
      send(res, 200, { authenticated: true }, { 'Set-Cookie': `__Host-bc_session=${body.credential}; Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=${maxAge}` })
    } catch { if (!res.destroyed && !res.writableEnded) send(res, 400, { error: 'INVALID_REQUEST' }) }
    finally { clearTimeout(timer) }
  }
  async function status(req, res) {
    // Status and paid requests share the bounded, single-flight verifier.
    // A disabled deployment must never refresh itself into paid access.
    let pricingVerified = priceCurrent()
    if (configured && studioAuthorization && Date.now() < authorizationExpiry) {
      try { await verifyPricing(); pricingVerified = priceCurrent() }
      catch { pricingVerified = false }
    }
    const authenticated = Boolean(resolvePrincipal(req))
    let budget
    if (authenticated) {
      try {
        // Only this newly authorized isolated ledger; never old/private ledgers.
        const ledger = JSON.parse(privateRead(join(directory, 'studio-ledger.json'), 1024 * 1024, mvpSupplemental).toString())
        if (ledger.approval !== STUDIO_MVP_POLICY.approval || ledger.profile !== 'studio-mvp') refuse()
        if (studioAuthorization) {
          const c = ledger.studioBudgetCheckpoint
          if (!c || c.calls < 8 || c.calls > STUDIO_AUTHORIZATION.maxCalls || c.reservedNano > STUDIO_AUTHORIZATION.maxNano) refuse('lifetime-checkpoint')
          budget = { calls: c.calls, maxCalls: STUDIO_AUTHORIZATION.maxCalls, capCny: STUDIO_AUTHORIZATION.maxNano / 1e9,
            reservedCny: c.reservedNano / 1e9, remainingCalls: STUDIO_AUTHORIZATION.maxCalls - c.calls,
            remainingCny: (STUDIO_AUTHORIZATION.maxNano - c.reservedNano) / 1e9, halted: ledger.halted }
        } else budget = { calls: ledger.entries.length, maxCalls: STUDIO_MVP_POLICY.maxCalls, capCny: STUDIO_MVP_POLICY.conservativeNano / 1e9,
          reservedCny: ledger.entries.reduce((sum, e) => sum + e.reserveNano, 0) / 1e9,
          estimatedCny: ledger.entries.reduce((sum, e) => sum + (e.estimatedNano || 0), 0) / 1e9,
          halted: ledger.halted }
      } catch { send(res, 503, { configured, authenticated, unavailable: true }); return }
    }
    send(res, 200, { configured: configured && Date.now() < authorizationExpiry && pricingVerified, authenticated: authenticated && Date.now() < authorizationExpiry,
      unavailable: Date.now() >= authorizationExpiry ? 'AI_AUTHORIZATION_EXPIRED' : !pricingVerified ? 'PRICING_UNVERIFIED' : unavailable,
      singleBoot: singleBoot || mvpSupplemental, model: PRICING.model, expiresAt: authorizationExpiry,
      pricingVerification: 'official-page-at-startup-and-every-15-minutes', ...(budget ? { budget } : {}) }); return
  }
  started.server.on('request', (req, res) => {
    if (req.url === '/api/studio/status' && req.method === 'GET') {
      const task = status(req, res); pending.add(task); void task.finally(() => pending.delete(task)); return
    }
    if (req.url === '/api/studio/session') {
      const task = login(req, res); pending.add(task); void task.finally(() => pending.delete(task)); return
    }
    for (const handler of handlers) handler.call(started.server, req, res)
  })
  let shuttingDown
  const shutdown = () => shuttingDown ??= (async () => { await Promise.allSettled([...pending]); await started.shutdown() })()
  if (signalHandlers) installShutdownHandlers(shutdown)
  console.info(JSON.stringify({ event: 'studio-test-ready', host, port, configured, mochiEnabled: configured && mochiEnabled, policy: STUDIO_MVP_POLICY.id,
    state: state?.created ? 'initialized-new-isolated-scope' : configured ? 'persistent-scope-reused' : 'disabled', expiresAt: authorizationExpiry }))
  return { server: started.server, shutdown }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startTestDeployment({ mvpSupplemental: true, mochiEnabled: true, studioAuthorization: true }).catch(error => {
    console.error(JSON.stringify({ event: 'studio-test-start-refused', code: ['EACCES', 'ENOENT', 'LEDGER_LOCKED', 'TEST_STATE_REFUSED'].includes(error.code || error.message) ? error.code || error.message : 'CONFIGURATION_REFUSED',
      ...(error.message === 'TEST_STATE_REFUSED' ? { stage: error.stage } : {}) }))
    process.exitCode = 1
  })
}
