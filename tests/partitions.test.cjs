const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { emptyPartition, addGuide, addCellCut, partitionCells, moveGuide, removeGuide, syncPartition } = require('../src/partitions.ts')
const test = require('node:test')
const guide = (p, axis, value, id) => addGuide(p, axis, value, id)
const base = () => {
  let p = emptyPartition('p1')
  for (const [axis, value, id] of [['horizontal', .2, 'top'], ['horizontal', .4, 'middle'], ['horizontal', .6, 'bottom'], ['vertical', .1, 'left'], ['vertical', .9, 'right']]) p = guide(p, axis, value, id)
  return p
}
const project = () => ({ version: 1, projectName: 'test', pages: [{ id: 'p1' }, { id: 'p2' }], segments: [], flags: [], source: {}, highlight: { mode: 'full', opacity: .32 } })

test('only four explicitly drawn sides form a cell; page margins stay outside', () => {
  const p = base()
  assert.equal(partitionCells({ ...p, vertical: [p.vertical[0]] }).length, 0)
  const cells = partitionCells(p)
  assert.equal(cells.length, 2)
  assert.deepEqual(cells[0].region, { x: .1, y: .2, width: .8, height: .2 })
})
test('horizontal and vertical placement order does not matter', () => {
  const p = base()
  assert.deepEqual(partitionCells({ ...p, horizontal: [...p.horizontal].reverse(), vertical: [...p.vertical].reverse() }), partitionCells(p))
})
test('a whole-page vertical divides every enclosed row', () => {
  const p = guide(base(), 'vertical', .5, 'whole')
  assert.equal(partitionCells(p).length, 4)
})
test('local cut divides only the clicked closed row and can be repeated', () => {
  let p = addCellCut(base(), .5, .3, 'local')
  assert.equal(partitionCells(p).length, 3)
  assert.equal(partitionCells(p).filter(cell => cell.region.y === .4).length, 1)
  p = addCellCut(p, .7, .3, 'second')
  assert.equal(partitionCells(p).length, 4)
})
test('outside or near-edge local cuts do nothing', () => {
  const p = base()
  for (const [x, y] of [[.05, .3], [.5, .1], [.101, .3], [.899, .3]]) assert.equal(addCellCut(p, x, y, 'bad'), p)
})
test('later horizontal guide intersects an existing local cut without affecting other rows', () => {
  let p = addCellCut(base(), .5, .3, 'local')
  p = guide(p, 'horizontal', .3, 'new-row')
  assert.equal(partitionCells(p).length, 5)
})
test('dragging guides cannot cross neighbors or their attached local cuts', () => {
  const p = addCellCut(base(), .5, .3, 'local')
  assert.ok(moveGuide(p, 'left', .8).vertical[0].position < .5)
  assert.ok(moveGuide(p, 'middle', .9).horizontal[1].position < .6)
  assert.ok(moveGuide(p, 'local', .99).cuts[0].position < .9)
})
test('removing a boundary removes local cuts attached to it', () => {
  const p = removeGuide(addCellCut(base(), .5, .3, 'local'), 'top')
  assert.equal(p.cuts.length, 0)
  assert.equal(partitionCells(p).length, 1)
})
test('moving a line keeps IDs, timing, flags and manual numbering', () => {
  let state = syncPartition(project(), base())
  state.segments[0].startTime = 5; state.segments[0].endTime = 8; state.segments[0].timingSet = true
  state.flags = [{ id: 'flag', segmentId: state.segments[0].id, time: 5, kind: 'start' }]
  state.segments.reverse()
  const ids = state.segments.map(s => s.id)
  const next = syncPartition(state, moveGuide(base(), 'left', .15))
  assert.deepEqual(next.segments.map(s => s.id), ids)
  assert.equal(next.segments[1].startTime, 5)
  assert.equal(next.segments[1].region.x, .15)
  assert.deepEqual(next.flags, state.flags)
})
test('adding a local cut keeps unaffected timed rows intact', () => {
  const state = syncPartition(project(), base())
  state.segments[1].startTime = 9; state.segments[1].endTime = 12; state.segments[1].timingSet = true
  const id = state.segments[1].id
  const next = syncPartition(state, addCellCut(base(), .5, .3, 'cut'))
  assert.equal(next.segments.length, 3)
  assert.equal(next.segments[2].id, id)
  assert.equal(next.segments[2].startTime, 9)
  assert.equal(next.segments[1].timingSet, false)
})
test('skipped cells leave the numbering and can be restored', () => {
  const p = base(), state = syncPartition(project(), p), key = partitionCells(p)[0].key
  const skipped = syncPartition(state, { ...p, excluded: [key] })
  assert.equal(skipped.segments.length, 1)
  assert.equal(syncPartition(skipped, p).segments.length, 2)
})
test('legacy rectangles and other pages survive line edits', () => {
  const state = project()
  state.segments = [{ id: 'legacy', pageId: 'p2', region: { x: .1, y: .1, width: .3, height: .1 }, startTime: 2, endTime: 6, timingSet: true, direction: 'left-to-right' }]
  const next = syncPartition(state, base())
  assert.equal(next.segments.find(s => s.id === 'legacy'), state.segments[0])
  assert.equal(next.partitions[0].pageId, 'p1')
})
test('subdividing a skipped blank region keeps its pieces skipped', () => {
  const p = base()
  const skipped = { ...p, excluded: [partitionCells(p)[0].key] }
  const state = syncPartition(project(), skipped)
  const divided = syncPartition(state, addCellCut(skipped, .5, .3, 'blank-cut'))
  assert.equal(divided.segments.length, 1)
  assert.equal(divided.segments[0].region.y, .4)
  const restore = { ...divided.partitions[0], excluded: [] }
  assert.equal(syncPartition(divided, restore).segments.length, 3)
})
