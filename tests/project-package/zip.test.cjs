const test = require('node:test')
const assert = require('node:assert/strict')
require('../custom-block/fixtures.cjs') // Repository TypeScript require hook.
const { encodePackageZip: encode, decodePackageZip: decode, PACKAGE_LIMITS: limits } = require('../../src/integrations/project-package/zip.ts')
const { ProjectPackageError } = require('../../src/integrations/project-package/errors.ts')

const bytes = text => new TextEncoder().encode(text)
const files = () => [
  { path: 'manifest.json', data: bytes('{}') },
  { path: 'project.json', data: bytes('{"fixture":true}') },
  { path: 'assets/photo.png', data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) },
]
function positions(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  const central = []
  const local = []
  let pos = view.getUint32(end + 16, true)
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    central.push(pos)
    local.push(view.getUint32(pos + 42, true))
    pos += 46 + view.getUint16(pos + 28, true)
  }
  return { view, end, central, local }
}
function mutate(fn, input = encode(files())) {
  const zip = input.slice()
  fn(zip, positions(zip))
  return zip
}
function rejects(zip, code) {
  assert.throws(() => decode(zip), error => {
    assert.equal(error instanceof ProjectPackageError, true)
    if (code) assert.equal(error.code, code)
    assert.equal(error.message.includes('assets/'), false)
    return true
  })
}

test('STORE ZIP is deterministic, CRC32 interoperable, bounded, and preserves binary data', () => {
  const original = files()
  const zip = encode(original)
  assert.deepEqual(zip, encode(original))
  assert.deepEqual([...decode(zip)], original.map(file => [file.path, file.data]))
  const known = encode([{ path: 'project.json', data: bytes('123456789') }])
  assert.equal(new DataView(known.buffer).getUint32(14, true), 0xcbf43926)
  const padded = new Uint8Array(zip.length + 12)
  padded.set(zip, 7)
  const recovered = decode(padded.subarray(7, 7 + zip.length))
  zip.fill(0)
  assert.deepEqual(recovered.get('assets/photo.png'), original[2].data)
  const nodeBuffer = Buffer.from(encode(original))
  const bufferRecovered = decode(nodeBuffer)
  nodeBuffer.fill(0)
  assert.deepEqual(bufferRecovered.get('assets/photo.png'), original[2].data)
  assert.deepEqual([...decode(encode([]))], [])
})

test('independent hand-built ZIP fixture restores with version 1.0 STORE headers', () => {
  // Conventional ZIP headers, known CRC32 test vector; independent of encoder.
  const fixture = Buffer.from(
    '504b03040a0000080000000021002639f4cb09000000090000000c000000' +
    '70726f6a6563742e6a736f6e313233343536373839' +
    '504b01020a000a0000080000000021002639f4cb09000000090000000c0000000000000000000000000000000000' +
    '70726f6a6563742e6a736f6e' +
    '504b050600000000010001003a000000330000000000', 'hex')
  assert.equal(new TextDecoder().decode(decode(fixture).get('project.json')), '123456789')
})

test('encoder rejects traversal, OS paths, unknown files, unsafe IDs, Unicode and case collisions', () => {
  for (const path of ['../project.json', '/project.json', 'C:/project.json', 'assets/../photo.png',
    'assets\\photo.png', 'assets/', 'project.json/child', 'assets/你好.png', 'assets/a.svg',
    'assets/a.jpeg', 'assets/a.PNG', 'assets/a.png\n', 'assets/a.png\0', 'assets/constructor.png',
    'assets/prototype.png', 'assets/__proto__.png', 'assets/.hidden.png', 'assets/a b.png',
    'assets/%2e%2e.png', 'other.json', 'Manifest.json', 'assets/' + 'a'.repeat(129) + '.png']) {
    assert.throws(() => encode([{ path, data: bytes('') }]), { code: 'PACKAGE_PATH' }, path)
  }
  for (const pair of [['project.json', 'project.json'], ['assets/a.png', 'assets/A.png']]) {
    assert.throws(() => encode(pair.map(path => ({ path, data: bytes('') }))), { code: 'PACKAGE_PATH' })
  }
})

test('decoder rejects malicious central names even when local names match', () => {
  const base = encode([{ path: 'assets/a.png', data: bytes('') }])
  for (const path of ['../evil.json', '/project.xxx', 'assets/a.svg', 'assets/a.pn\n', 'assets\\a.png']) {
    const name = bytes(path)
    // All mutations retain the recorded name byte length.
    if (name.length !== 12) continue
    rejects(mutate((zip, { central, local }) => {
      zip.set(name, central[0] + 46); zip.set(name, local[0] + 30)
    }, base), 'PACKAGE_PATH')
  }
  rejects(mutate((zip, { central, local }) => {
    zip[central[0] + 46] = 0xff; zip[local[0] + 30] = 0xff
  }, base), 'PACKAGE_PATH')
  const pair = encode([{ path: 'assets/a.png', data: bytes('') }, { path: 'assets/b.png', data: bytes('') }])
  for (const name of ['assets/a.png', 'assets/A.png']) {
    rejects(mutate((zip, { central, local }) => {
      zip.set(bytes(name), central[1] + 46); zip.set(bytes(name), local[1] + 30)
    }, pair), 'PACKAGE_PATH')
  }
})

test('file count, per-file, cumulative and archive size limits apply before allocation or copying', () => {
  const maximum = [{ path: 'manifest.json', data: new Uint8Array(limits.maxFileBytes) },
    { path: 'project.json', data: new Uint8Array(limits.maxTotalBytes - limits.maxFileBytes) }]
  for (let i = 0; i < 32; i++) maximum.push({ path: `assets/a${i}.png`, data: bytes('') })
  assert.equal(decode(encode(maximum)).size, limits.maxFiles)
  assert.throws(() => encode([...maximum, { path: 'assets/extra.png', data: bytes('') }]), { code: 'PACKAGE_LIMIT' })
  assert.throws(() => encode([{ path: 'project.json', data: new Uint8Array(limits.maxFileBytes + 1) }]), { code: 'PACKAGE_LIMIT' })
  const excessive = maximum.map(file => ({ ...file }))
  excessive[1] = { ...excessive[1], data: new Uint8Array(excessive[1].data.length + 1) }
  assert.throws(() => encode(excessive), { code: 'PACKAGE_LIMIT' })
  rejects(new Uint8Array(limits.maxZipBytes + 1), 'PACKAGE_LIMIT')
  rejects(mutate((_, { view, end }) => { view.setUint16(end + 8, 35, true); view.setUint16(end + 10, 35, true) }), 'PACKAGE_LIMIT')
  rejects(mutate((_, { view, central }) => view.setUint32(central[0] + 24, limits.maxFileBytes + 1, true)), 'PACKAGE_LIMIT')
  const totalZip = encode(maximum)
  rejects(mutate((_, { view, central }) => {
    view.setUint32(central[1] + 20, 1_100_001, true); view.setUint32(central[1] + 24, 1_100_001, true)
  }, totalZip), 'PACKAGE_LIMIT')
})

test('unsupported compression, encryption, descriptors, extras, comments, volumes and ZIP64 reject', () => {
  const cases = [
    ({ view, central }) => view.setUint16(central[0] + 10, 8, true),
    ({ view, central }) => view.setUint16(central[0] + 8, 0x0801, true),
    ({ view, central }) => view.setUint16(central[0] + 8, 0x0808, true),
    ({ view, central }) => view.setUint16(central[0] + 8, 0, true),
    ({ view, central }) => view.setUint16(central[0] + 6, 45, true),
    ({ view, central }) => view.setUint16(central[0] + 30, 1, true),
    ({ view, local }) => view.setUint16(local[0] + 28, 1, true),
    ({ view, central }) => view.setUint16(central[0] + 32, 1, true),
    ({ view, central }) => view.setUint16(central[0] + 34, 1, true),
    ({ view, end }) => view.setUint16(end + 4, 1, true),
    ({ view, end }) => view.setUint16(end + 6, 1, true),
    ({ view, end }) => view.setUint16(end + 8, 1, true),
    ({ view, end }) => view.setUint16(end + 20, 1, true),
    ({ view, end }) => view.setUint32(end + 12, 0xffffffff, true),
    ({ view, central }) => view.setUint32(central[0] + 24, 0xffffffff, true),
    ({ view, central }) => view.setUint32(central[0] + 42, 0xffffffff, true),
  ]
  for (const change of cases) rejects(mutate((_, p) => change(p)), 'PACKAGE_UNSUPPORTED')
})

test('symlinks, directories and other special entries reject', () => {
  for (const attributes of [0xa1ff0000, 0x41ed0000, 0x11ff0000, 0x21ff0000, 0x80000010, 0x10]) {
    rejects(mutate((_, { view, central }) => {
      view.setUint16(central[0] + 4, 0x0314, true)
      view.setUint32(central[0] + 38, attributes, true)
    }), 'PACKAGE_UNSUPPORTED')
  }
})

test('CRC, local/central names, timestamps, flags, methods, sizes and version must agree', () => {
  rejects(mutate((zip, { local }) => { zip[local[0] + 30 + 13] ^= 1 }), 'PACKAGE_INTEGRITY')
  for (const field of [4, 6, 8, 10, 12, 14, 18, 22, 26]) {
    rejects(mutate((_, { view, local }) => view.setUint16(local[0] + field, view.getUint16(local[0] + field, true) ^ 1, true)), 'PACKAGE_INTEGRITY')
  }
  rejects(mutate((zip, { local }) => { zip[local[0] + 30] ^= 1 }), 'PACKAGE_INTEGRITY')
  rejects(mutate((_, { view, central }) => view.setUint32(central[0] + 20, 1, true)), 'PACKAGE_INTEGRITY')
  rejects(mutate((_, { view, central, local }) => {
    view.setUint32(central[0] + 16, 0, true); view.setUint32(local[0] + 14, 0, true)
  }), 'PACKAGE_INTEGRITY')
})

test('truncation, overlapping offsets, gaps, trailing data and undeclared entries reject safely', () => {
  const zip = encode(files())
  for (let length = 0; length < zip.length; length++) rejects(zip.subarray(0, length))
  rejects(Uint8Array.from([...zip, 0]))
  rejects(Uint8Array.from([0, ...zip]))
  rejects(mutate((_, { view, end }) => view.setUint32(end + 12, 1, true)))
  rejects(mutate((_, { view, end }) => view.setUint32(end + 16, 0xffffff00, true)))
  rejects(mutate((_, { view, central }) => view.setUint32(central[1] + 42, 0, true)))
  rejects(mutate((_, { view, central }) => view.setUint32(central[0] + 42, 1, true)))
  rejects(mutate((_, { view, end }) => { view.setUint16(end + 8, 2, true); view.setUint16(end + 10, 2, true) }))
  rejects(mutate((_, { view, central }) => view.setUint16(central[0] + 28, 65535, true)))
  rejects(mutate((_, { view, local }) => view.setUint32(local[0], 0, true)))
})

test('malformed runtime types raise sanitized stable errors', () => {
  for (const value of [undefined, null, {}, [], new ArrayBuffer(22), 'ZIP']) rejects(value, 'PACKAGE_INVALID')
  assert.throws(() => encode(null), { code: 'PACKAGE_INVALID' })
  assert.throws(() => encode([{ path: 'project.json', data: 'raw' }]), { code: 'PACKAGE_INVALID' })
  assert.throws(() => encode([null]), { code: 'PACKAGE_INVALID' })
})

test('single-byte mutations never escape as raw parser errors or silently alter file data', () => {
  const zip = encode(files())
  const original = [...decode(zip)]
  for (let offset = 0; offset < zip.length; offset++) {
    const changed = zip.slice()
    changed[offset] ^= 0xff
    let restored
    try { restored = decode(changed) } catch (error) {
      assert.equal(error instanceof ProjectPackageError, true, `offset ${offset}`)
      assert.match(error.code, /^PACKAGE_(INVALID|LIMIT|PATH|UNSUPPORTED|INTEGRITY)$/)
      continue
    }
    assert.deepEqual([...restored], original, `offset ${offset}`)
  }
})
