import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import validator from 'gltf-validator'

const base = 'public/interiors'
const scene = JSON.parse(await readFile(join(base, 'reference/scene.json'), 'utf8'))
assert.equal(scene.schema_version, 3)
assert.equal(scene.interior_library_version, 2)
const imported = JSON.parse(await readFile('services/reconstruction/assets_manifest.json', 'utf8'))
for (const asset of imported.assets) {
  if (asset.status === 'APPROVED') {
    assert.equal(asset.license, 'CC0-1.0')
    assert(asset.runtime_sha256 && asset.license_evidence_sha256)
    assert(scene.furniture_assets.some(item => item.id === asset.id))
  }
}
const ids = new Set()
for (const asset of scene.furniture_assets) {
  assert(!ids.has(asset.id), `Duplicate asset ${asset.id}`)
  ids.add(asset.id)
  assert(asset.pivot === 'floor_center' && asset.forward_axis === '+Z')
  assert(asset.width_m > 0 && asset.depth_m > 0 && asset.height_m > 0)
  assert(asset.clearance.front_m >= 0 && asset.clearance.side_m >= 0)
  assert(asset.compatible_room_types.length > 0)
  assert(asset.glb_path === `/interiors/models/${asset.id}.glb`)
}
for (const instance of scene.furniture_instances) {
  assert(ids.has(instance.asset_id), `Unknown asset ${instance.asset_id}`)
  assert(scene.rooms.some(room => room.id === instance.room_id))
  assert(instance.position.every(Number.isFinite) && Number.isFinite(instance.rotation_y) && instance.scale === 1)
}
for (const material of scene.materials) {
  assert(material.repeat.every(value => Number.isFinite(value) && value > 0))
  assert(material.texture.startsWith('/interiors/textures/'))
  const size = (await stat(join('public', material.texture.slice(1)))).size
  assert(size > 0 && size < 200_000, `Unoptimized texture ${material.id}`)
}
for (const path of [...scene.furniture_assets.map(asset => join('public', asset.glb_path.slice(1))), join(base, 'reference/model.glb')]) {
  const bytes = await readFile(path)
  const report = await validator.validateBytes(new Uint8Array(bytes))
  if (report.issues.numErrors) {
    console.error(path, report.issues.messages.filter(message => message.severity === 0))
    process.exitCode = 1
  }
  console.log(`${path}: ${bytes.length} bytes, ${report.issues.numErrors} glTF errors, ${report.issues.numWarnings} warnings`)
}
