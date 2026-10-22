const test = require('node:test')
const assert = require('node:assert/strict')
const { makeGalleryProject } = require('./fixtures.cjs')
const { createProjectPackage, parseProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { parseProjectFile } = require('../../src/integrations/project-package/file.ts')
const registry = { async resolve() { return undefined } }

test('browser decode gate rejects corrupt images during ZIP export, ZIP import and legacy import', async () => {
  const original = globalThis.createImageBitmap
  const project = makeGalleryProject()
  const zip = await createProjectPackage(project, registry)
  globalThis.createImageBitmap = async () => { throw new Error('untrusted decoder detail') }
  try {
    await assert.rejects(createProjectPackage(project, registry), { code: 'RESOURCE_INVALID' })
    await assert.rejects(parseProjectPackage(zip), { code: 'RESOURCE_INVALID' })
    const bytes = new TextEncoder().encode(JSON.stringify(project))
    await assert.rejects(parseProjectFile({ size: bytes.length, async arrayBuffer() { return bytes.buffer } }), { code: 'RESOURCE_INVALID' })
  } finally {
    if (original) globalThis.createImageBitmap = original
    else delete globalThis.createImageBitmap
  }
})

test('successful native decode releases bitmap allocations and preserves exact resource bytes', async () => {
  const original = globalThis.createImageBitmap
  let closed = 0
  globalThis.createImageBitmap = async (blob, options) => {
    assert.equal(blob.type, 'image/png')
    assert.deepEqual(options, { resizeWidth: 1, resizeHeight: 1 })
    return { width: 1, height: 1, close() { closed++ } }
  }
  try {
    const project = makeGalleryProject()
    const zip = await createProjectPackage(project, registry)
    assert.deepEqual((await parseProjectPackage(zip)).project, project)
    assert.equal(closed, 2)
  } finally {
    if (original) globalThis.createImageBitmap = original
    else delete globalThis.createImageBitmap
  }
})
