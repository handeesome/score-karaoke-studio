const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const test = require('node:test')
const { connectFullTiming, editTiming, removeTiming, insertTiming, rebindAfterMerge, timedSegmentIds } = require('../src/timing.ts')
const { recoverFlagsFromTiming } = require('../src/utils.ts')
const project = (mode = 'full', count = 30) => {
  const segments = Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, pageId: 'p1',
    region: { x: .1, y: .01 * i, width: .8, height: .009 }, startTime: i * 4, endTime: (i + 1) * 4,
    timingSet: true, direction: 'left-to-right' }))
  return { version: 1, projectName: 'test', pages: [{ id: 'p1' }], source: {}, segments,
    flags: [...segments.map((s, i) => ({ id: `f${i}`, time: s.startTime, segmentId: s.id, kind: i ? 'transition' : 'start' })),
      { id: 'end', time: count * 4, segmentId: `s${count}`, kind: 'end' }], highlight: { mode, opacity: .32 } }
}

test('wipe deletion keeps all 30 score boxes, numbering and every later time, leaving only slot 7 empty', () => {
  const before = project('wipe'), next = removeTiming(before, 's7')
  assert.equal(next.segments.length, 30)
  assert.deepEqual(next.segments.map(s => s.id), before.segments.map(s => s.id))
  assert.deepEqual(next.segments.slice(7), before.segments.slice(7))
  assert.equal(next.segments[6].timingSet, false)
  assert.equal(next.segments[6].startTime, 24)
  assert.equal(next.flags.some(f => f.segmentId === 's7'), false)
  assert.equal(timedSegmentIds(next).size, 29)
  assert.equal(before.segments[6].timingSet, true)
})

test('full deletion clears slot 7 and all later assignments while preserving score geometry and first 6 times', () => {
  const before = project(), next = removeTiming(before, 's7')
  assert.equal(next.segments.length, 30)
  assert.deepEqual(next.segments.slice(0, 6), before.segments.slice(0, 6))
  assert.equal(timedSegmentIds(next).size, 6)
  assert.equal(next.segments.slice(6).every(s => s.timingSet === false), true)
  assert.deepEqual(next.segments.map(s => s.region), before.segments.map(s => s.region))
  assert.equal(next.flags.some(f => f.kind === 'end'), false)
})

test('deleted times do not reappear after deleting the first/all items and reopening', () => {
  const empty = JSON.parse(JSON.stringify(removeTiming(project(), 's1')))
  assert.equal(empty.flags.length, 0)
  assert.equal(recoverFlagsFromTiming(empty), empty)
  assert.equal(timedSegmentIds(empty).size, 0)
  const wipe = removeTiming(project('wipe', 1), 's1')
  assert.equal(recoverFlagsFromTiming(wipe), wipe)
})

test('wipe insertion restores the empty slot without shifting any neighbour', () => {
  const before = project('wipe'), removed = removeTiming(before, 's7')
  const next = insertTiming(removed, 's7', 24, 120)
  assert.deepEqual(next.segments, before.segments)
  assert.equal(timedSegmentIds(next).size, 30)
  const overlap = insertTiming(removed, 's7', 29, 120)
  assert.equal(overlap.segments[6].startTime, 29)
  assert.deepEqual(overlap.segments[7], before.segments[7])
})

test('full boundary edit changes both sides and flags, leaving all other times fixed', () => {
  const before = project(), next = editTiming(before, 's7', 24, 29, 'end', 120)
  assert.equal(next.segments[6].endTime, 29)
  assert.equal(next.segments[7].startTime, 29)
  assert.equal(next.flags.find(f => f.segmentId === 's8').time, 29)
  assert.deepEqual(next.segments.slice(0, 6), before.segments.slice(0, 6))
  assert.deepEqual(next.segments.slice(8), before.segments.slice(8))
  const left = editTiming(before, 's7', 23, 28, 'start', 120)
  assert.equal(left.segments[5].endTime, 23)
  assert.equal(left.segments[6].startTime, 23)
})

test('full body move changes neighbouring edges together and cannot erase a neighbour', () => {
  const next = editTiming(project(), 's7', 25, 29, 'move', 120)
  assert.deepEqual(next.segments.slice(5, 8).map(s => [s.startTime, s.endTime]), [[20, 25], [25, 29], [29, 32]])
  const clamp = editTiming(project(), 's7', 90, 94, 'move', 120)
  assert.ok(clamp.segments[6].endTime < 32)
  assert.ok(clamp.segments[7].endTime - clamp.segments[7].startTime >= .0999)
})

test('wipe edits allow both empty space and overlap and only change the selected item', () => {
  const before = project('wipe')
  const gap = editTiming(before, 's7', 24, 26, 'end', 120)
  assert.equal(gap.segments[6].endTime, 26)
  assert.deepEqual(gap.segments[7], before.segments[7])
  const overlap = editTiming(before, 's7', 24, 30, 'end', 120)
  assert.equal(overlap.segments[6].endTime, 30)
  assert.deepEqual(overlap.segments[7], before.segments[7])
})

test('full normalization joins existing gaps by preserving starts; wipe remains unchanged', () => {
  const before = project(); before.segments[0].endTime = 2
  const next = connectFullTiming(before)
  assert.equal(next.segments[0].endTime, 4)
  assert.equal(connectFullTiming(next), next)
  before.highlight.mode = 'wipe'
  assert.equal(connectFullTiming(before), before)
})

test('explicitly timed items at default-looking times can recover flags; deliberately untimed items cannot', () => {
  const before = project('wipe', 3); before.flags = []
  before.segments[1].timingSet = false
  const recovered = recoverFlagsFromTiming(before)
  assert.deepEqual(recovered.flags.map(f => f.segmentId), ['s1', 's3'])
})

test('merging phrases 6 and 7 retains all original slot lengths, moves phrase 8 into old slot 7 and leaves the last slot free', () => {
  for (const mode of ['wipe', 'full']) {
    const before = project(mode)
    const merged = { ...before, segments: before.segments.filter(s => s.id !== 's7') }
    const next = rebindAfterMerge(before, merged)
    assert.equal(next.segments.length, 29)
    assert.equal(next.segments[5].id, 's6')
    assert.deepEqual([next.segments[5].startTime, next.segments[5].endTime], [20, 24])
    assert.equal(next.segments[6].id, 's8')
    assert.deepEqual([next.segments[6].startTime, next.segments[6].endTime], [24, 28])
    assert.deepEqual(next.segments.map(s => [s.startTime, s.endTime]), before.segments.slice(0, 29).map(s => [s.startTime, s.endTime]))
    assert.deepEqual(next.spareTimings, [{ startTime: 116, endTime: 120 }])
    assert.equal(next.flags.find(f => f.segmentId === 's8' && f.kind !== 'end').time, 24)
    assert.equal(next.flags.find(f => f.kind === 'end').time, 116)
    assert.equal(before.segments.length, 30)
  }
})

test('repeated merges retain every unused tail slot and terminal merge still preserves completion', () => {
  const before = project()
  const once = rebindAfterMerge(before, { ...before, segments: before.segments.filter(s => s.id !== 's30') })
  const twice = rebindAfterMerge(once, { ...once, segments: once.segments.filter(s => s.id !== 's29') })
  assert.deepEqual(twice.spareTimings, [{ startTime: 112, endTime: 116 }, { startTime: 116, endTime: 120 }])
  assert.equal(twice.flags.find(f => f.kind === 'end').segmentId, 's28')
})

test('an added phrase can reuse the preserved tail slot in either mode without disturbing existing assignments', () => {
  for (const mode of ['wipe', 'full']) {
    const before = project(mode)
    const merged = rebindAfterMerge(before, { ...before, segments: before.segments.filter(s => s.id !== 's7') })
    const newBox = { ...before.segments[29], id: 'new-box', timingSet: false, startTime: 0, endTime: 4 }
    const next = insertTiming({ ...merged, segments: [...merged.segments, newBox] }, 'new-box', 116, 120)
    assert.deepEqual(next.segments.slice(0, 29), merged.segments)
    assert.deepEqual([next.segments[29].startTime, next.segments[29].endTime], [116, 120])
    assert.equal(next.spareTimings.length, 0)
    assert.equal(next.flags.find(f => f.kind === 'end').segmentId, 'new-box')
  }
})

test('full resizing into a spare tail consumes its occupied part; deletion from a phrase clears later spare slots', () => {
  const before = project()
  const merged = rebindAfterMerge(before, { ...before, segments: before.segments.filter(s => s.id !== 's7') })
  const edited = editTiming(merged, 's30', 112, 118, 'end', 120)
  assert.deepEqual(edited.spareTimings, [{ startTime: 118, endTime: 120 }])
  assert.deepEqual(removeTiming(merged, 's7').spareTimings, [{ startTime: 116, endTime: 120 }]) // nonexistent id is a no-op
  assert.deepEqual(removeTiming(merged, 's8').spareTimings, [])
})
