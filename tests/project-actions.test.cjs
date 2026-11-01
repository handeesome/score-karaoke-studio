const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { emptyProject, removeScorePages, repeatScoreRegions } = require('../src/projectActions.ts')
const { recoverFlagsFromTiming } = require('../src/utils.ts')
const region = { x: .1, y: .2, width: .8, height: .1 }
const fixture = () => ({ version: 1, projectId: 'existing', projectName: 'Song', scoreTimingBound: true,
  source: { pdf: 'score.pdf', audio: 'song.wav', audioUrl: '/media/song.wav' },
  pages: [1, 2, 3].map(i => ({ id: 'p' + i, image: '/page' + i })),
  segments: [1, 2, 3].map(i => ({ id: 's' + i, pageId: 'p' + i, region,
    startTime: i * 4, endTime: i * 4 + 4, timingSet: true })),
  partitions: [1, 2, 3].map(i => ({ pageId: 'p' + i })),
  flags: [1, 2, 3].map(i => ({ id: 'f' + i, segmentId: 's' + i, time: i * 4, kind: i === 1 ? 'start' : 'transition' })),
  spareTimings: [{ startTime: 16, endTime: 20 }], highlight: { mode: 'wipe', opacity: .32 }, audioDuration: 30 })

test('removing a page deletes only its annotations and flags, preserving other timings and audio', () => {
  const before = fixture(), saved = structuredClone(before)
  const after = removeScorePages(before, new Set(['p2']))
  assert.deepEqual(after.pages.map(p => p.id), ['p1', 'p3'])
  assert.deepEqual(after.segments, [before.segments[0], before.segments[2]])
  assert.deepEqual(after.flags.map(f => f.segmentId), ['s1', 's3'])
  assert.deepEqual(after.partitions.map(p => p.pageId), ['p1', 'p3'])
  assert.deepEqual(after.source, before.source)
  assert.deepEqual(before, saved)
})

test('cross-page phrases keep their remaining regions and recorded timing', () => {
  const before = fixture()
  before.segments[0].regions = [{ pageId: 'p1', region }, { pageId: 'p2', region }]
  const after = removeScorePages(before, new Set(['p1']))
  assert.equal(after.segments[0].id, 's1')
  assert.equal(after.segments[0].pageId, 'p2')
  assert.equal(after.segments[0].startTime, before.segments[0].startTime)
  assert.equal(after.segments[0].regions, undefined)
  assert.equal(after.flags[0].kind, 'start')
})

test('clearing every page preserves audio while removing all recoverable timing data', () => {
  const before = fixture(), after = removeScorePages(before, new Set(['p1', 'p2', 'p3']))
  for (const field of ['pages', 'segments', 'flags', 'partitions', 'spareTimings']) assert.deepEqual(after[field], [])
  assert.equal(after.source.pdf, null)
  assert.equal(after.source.audioUrl, before.source.audioUrl)
  assert.deepEqual(recoverFlagsFromTiming(after).flags, [])
})

test('full highlight keeps remaining start times and removes orphan terminal flags', () => {
  const before = fixture(); before.highlight.mode = 'full'
  before.flags.push({ id: 'end', segmentId: 's3', time: 16, kind: 'end' })
  const after = removeScorePages(before, new Set(['p3']))
  assert.deepEqual(after.segments.map(s => s.startTime), [4, 8])
  assert.ok(after.flags.every(f => f.segmentId !== 's3'))
})

test('new projects have independent empty data and no previous audio or project ID', () => {
  const first = emptyProject(), second = emptyProject()
  first.pages.push({ id: 'temporary' })
  first.highlight.mode = 'full'
  assert.deepEqual(second.pages, [])
  assert.equal(second.projectId, null)
  assert.equal(second.source.audio, null)
  assert.equal(second.highlight.mode, 'wipe')
})

test('full-mode repeats append in score order with independent timing and no stale ending', () => {
  const before = fixture(); before.highlight.mode = 'full'
  before.segments[0].partitionKey = 'cell1'
  before.segments[1].partitionKey = 'cell2'
  before.flags.push({ id: 'end', segmentId: 's3', time: 16, kind: 'end' })
  const snapshot = structuredClone(before)
  const after = repeatScoreRegions(before, ['s2', 's1'], 30, i => 'repeat' + i)
  assert.deepEqual(after.segments.slice(0, 3), before.segments)
  assert.deepEqual(after.segments.slice(3).map(s => s.repeatSourceId), ['s1', 's2'])
  assert.ok(after.segments.slice(3).every(s => s.timingSet === false && s.partitionKey === undefined))
  assert.ok(after.flags.every(f => f.kind !== 'end' && !f.segmentId.startsWith('repeat')))
  assert.notEqual(after.segments[3].region, before.segments[0].region)
  assert.deepEqual(before, snapshot)
  const again = repeatScoreRegions(after, ['repeat0'], 30, () => 'again')
  assert.equal(again.segments.at(-1).repeatSourceId, 's1')
  assert.equal(again.segments.at(-1).timingSet, false)
})

test('wipe-mode repeats retain existing independent geometry and timing behavior', () => {
  const before = fixture()
  const after = repeatScoreRegions(before, ['s1'], 30, () => 'repeat')
  assert.equal(after.segments.at(-1).repeatSourceId, undefined)
  assert.equal(after.segments.at(-1).timingSet, false)
  assert.deepEqual(after.flags, before.flags)
  assert.equal(repeatScoreRegions(before, [], 30, () => 'unused'), before)
})
