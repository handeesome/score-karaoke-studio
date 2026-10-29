const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { emptyPartition, addGuide, addCellCut, partitionCells, moveGuide, removeGuide, syncPartition, partitionLyricRows, automaticLyricRows, withLyricOrder, initializePartitionNumbers, numberPartitionCell, resetPartitionNumbers, restoreNumberingSlots } = require('../src/partitions.ts')
const { bindTimingToScoreOrder } = require('../src/utils.ts')
const test = require('node:test')
const guide = (p, axis, value, id) => addGuide(p, axis, value, id)
const base = () => {
  let p = { ...emptyPartition('p1'), numberedKeys: undefined }
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

const verses = () => {
  let p = { ...emptyPartition('p1'), numberedKeys: undefined }
  for (const [index, y] of [.05, .10, .15, .20, .40, .45, .50, .55].entries()) p = addGuide(p, 'horizontal', y, `h${index}`)
  p = addGuide(addGuide(p, 'vertical', .1, 'left'), 'vertical', .9, 'right')
  return { ...p, excluded: partitionCells(p).filter(c => c.top === 'h3').map(c => c.key) }
}
const rowOrder = segments => segments.map(s => s.partitionKey.split(':')[1])

test('three lyric verses run through every score system before the next verse, skipping the notation band', () => {
  const p = verses(), rows = automaticLyricRows(p, 3)
  assert.deepEqual(Object.values(rows), [1, 2, 3, 0, 1, 2, 3])
  const original = syncPartition(project(), p)
  const next = syncPartition(original, withLyricOrder(p, 3, rows), true)
  assert.deepEqual(rowOrder(next.segments), ['h0', 'h4', 'h1', 'h5', 'h2', 'h6'])
  assert.deepEqual(new Set(next.segments.map(s => s.id)), new Set(original.segments.map(s => s.id)))
  for (const s of next.segments) assert.deepEqual(s.region, original.segments.find(old => old.id === s.id).region)
})

test('local phrase cuts remain left to right within each lyric row and keep verse ordering on later cuts', () => {
  const p = withLyricOrder(verses(), 3, automaticLyricRows(verses(), 3))
  const initial = syncPartition(project(), p)
  const first = syncPartition(initial, addCellCut(p, .5, .075, 'first-cut'))
  assert.deepEqual(rowOrder(first.segments), ['h0', 'h0', 'h4', 'h1', 'h5', 'h2', 'h6'])
  assert.ok(first.segments[0].region.x < first.segments[1].region.x)
  const next = syncPartition(first, addCellCut(first.partitions[0], .5, .425, 'second-cut'))
  assert.deepEqual(rowOrder(next.segments), ['h0', 'h0', 'h4', 'h4', 'h1', 'h5', 'h2', 'h6'])
})

test('custom verse assignments handle exceptional rows and position numbering can be restored', () => {
  const p = verses(), rows = automaticLyricRows(p, 3)
  rows['h4:h5'] = 3
  const state = syncPartition(project(), withLyricOrder(p, 3, rows), true)
  assert.deepEqual(rowOrder(state.segments), ['h0', 'h1', 'h5', 'h2', 'h4', 'h6'])
  const restored = syncPartition(state, withLyricOrder(state.partitions[0], 1, automaticLyricRows(state.partitions[0], 1)), true)
  assert.deepEqual(rowOrder(restored.segments), ['h0', 'h1', 'h2', 'h4', 'h5', 'h6'])
  assert.equal(restored.partitions[0].lyricOrder, undefined)
})

test('reordering lyric verses rebinds all recorded time slots without changing their values or losing the ending', () => {
  const p = verses(), before = syncPartition(project(), p)
  before.segments.forEach((s, i) => { s.startTime = 10 + i * 4; s.endTime = 14 + i * 4; s.timingSet = true })
  before.flags = before.segments.map((s, i) => ({id:`f${i}`, segmentId:s.id, time:s.startTime, kind:i ? 'transition' : 'start'}))
  before.flags.push({id:'end', segmentId:before.segments.at(-1).id, time:34, kind:'end'})
  const after = bindTimingToScoreOrder(syncPartition(before, withLyricOrder(p, 3, automaticLyricRows(p, 3)), true))
  assert.deepEqual(after.segments.map(s => [s.startTime,s.endTime,s.timingSet]), before.segments.map(s => [s.startTime,s.endTime,s.timingSet]))
  assert.deepEqual(after.flags.map(f => f.time), before.flags.map(f => f.time))
  assert.equal(after.flags.at(-1).segmentId, after.segments.at(-1).id)
  const reopened = JSON.parse(JSON.stringify(after))
  const moved = syncPartition(reopened, moveGuide(reopened.partitions[0], 'left', .12))
  assert.deepEqual(rowOrder(moved.segments), rowOrder(after.segments))
  assert.deepEqual(moved.flags, after.flags)
})

test('splitting a lyric band inherits its verse and splitting skipped notation cannot shift later verse labels', () => {
  const p = withLyricOrder(verses(), 3, automaticLyricRows(verses(), 3))
  const state = syncPartition(project(), p)
  const split = syncPartition(state, addGuide(p, 'horizontal', .075, 'inside-first-verse'))
  assert.equal(split.partitions[0].lyricOrder.rows['h0:inside-first-verse'], 1)
  assert.equal(split.partitions[0].lyricOrder.rows['inside-first-verse:h1'], 1)
  const more = syncPartition(split, addGuide(split.partitions[0], 'horizontal', .3, 'inside-notation'))
  assert.deepEqual(rowOrder(more.segments), rowOrder(split.segments))
  assert.equal(more.partitions[0].lyricOrder.rows['h3:inside-notation'], 0)
})

test('new partitions contain unnumbered geometry until the user chooses a click order', () => {
  const p = { ...verses(), numberedKeys: [] }
  const initial = syncPartition(project(), p)
  assert.equal(initial.segments.length, 0)
  assert.equal(partitionCells(initial.partitions[0]).length, 7)
  const keys = partitionCells(p).filter(c => !p.excluded.includes(c.key)).map(c => c.key)
  const clicked = [keys[0], keys[3], keys[2], keys[5], keys[1], keys[4]]
  const chosen = syncPartition(initial, { ...p, numberedKeys: clicked }, true)
  assert.deepEqual(chosen.segments.map(s => s.partitionKey), clicked)
  assert.deepEqual(chosen.partitions[0].numberedKeys, clicked)
  assert.equal(syncPartition(chosen, chosen.partitions[0]).segments.length, 6)
})

test('cuts and line movement preserve the chosen manual numbers while new cells remain unnumbered', () => {
  const p = verses(), keys = partitionCells(p).filter(c => !p.excluded.includes(c.key)).map(c => c.key)
  let state = syncPartition(project(), { ...p, numberedKeys: [keys[3], keys[0]] })
  const ids = state.segments.map(s => s.id)
  state = syncPartition(state, moveGuide(state.partitions[0], 'left', .12))
  assert.deepEqual(state.segments.map(s => s.id), ids)
  state = syncPartition(state, addCellCut(state.partitions[0], .5, .075, 'new-child'))
  assert.equal(state.segments.length, 2)
  assert.deepEqual(state.segments.map(s => s.id), ids)
  assert.equal(partitionCells(state.partitions[0]).length, 8)
  assert.deepEqual(rowOrder(state.segments), ['h4', 'h0'])
})

test('duplicate or stale click keys cannot duplicate a phrase or produce a number for an excluded cell', () => {
  const p = verses(), cells = partitionCells(p)
  const next = syncPartition(project(), { ...p, numberedKeys: [cells[0].key,cells[0].key,'missing',cells[3].key] })
  assert.equal(next.segments.length, 1)
  assert.deepEqual(next.partitions[0].numberedKeys, [cells[0].key])
})

test('opening an old partition preserves every existing number and new cuts do not add automatic numbers', () => {
  const old = syncPartition(project(), verses())
  old.segments.reverse()
  const migrated = initializePartitionNumbers(old)
  assert.deepEqual(migrated.segments, old.segments)
  assert.deepEqual(migrated.partitions[0].numberedKeys, old.segments.map(s => s.partitionKey))
  const next = syncPartition(migrated, addCellCut(migrated.partitions[0], .5, .075, 'new-cut'))
  assert.deepEqual(next.segments.map(s => s.id), migrated.segments.map(s => s.id))
})

test('one click assigns one saved number and duplicate clicks make no edit', () => {
  const p = { ...verses(), numberedKeys: [] }, initial = syncPartition(project(), p)
  const keys = partitionCells(p).filter(c => !p.excluded.includes(c.key)).map(c => c.key)
  const first = numberPartitionCell(initial, initial.partitions[0], keys[3])
  assert.equal(first.segments.length, 1)
  assert.equal(first.segments[0].partitionKey, keys[3])
  assert.equal(numberPartitionCell(first, first.partitions[0], keys[3]), first)
  const reopened = initializePartitionNumbers(JSON.parse(JSON.stringify(first)))
  const second = numberPartitionCell(reopened, reopened.partitions[0], keys[0])
  assert.deepEqual(second.segments.map(s => s.partitionKey), [keys[3],keys[0]])
})

test('restarting and immediately renumbering preserves recorded time slots and the final ending', () => {
  const before = syncPartition(project(), verses())
  before.segments.forEach((s,i)=>{s.startTime=10+i*4;s.endTime=14+i*4;s.timingSet=true})
  before.flags=before.segments.map((s,i)=>({id:`f${i}`,segmentId:s.id,time:s.startTime,kind:i?'transition':'start'}))
  before.flags.push({id:'end',segmentId:before.segments.at(-1).id,time:34,kind:'end'})
  const keys = before.segments.map(s => s.partitionKey).reverse()
  let after = resetPartitionNumbers(before, before.partitions[0])
  assert.equal(after.segments.length,0)
  assert.equal(after.partitions[0].numberingSlots.length,6)
  after = JSON.parse(JSON.stringify(after))
  for (const key of keys) after = numberPartitionCell(after,after.partitions[0],key)
  assert.deepEqual(after.segments.map(s=>[s.startTime,s.endTime,s.timingSet]),before.segments.map(s=>[s.startTime,s.endTime,s.timingSet]))
  assert.equal(after.flags.at(-1).kind,'end')
  assert.equal(after.flags.at(-1).time,34)
  assert.equal(after.flags.at(-1).segmentId,after.segments.at(-1).id)
  assert.equal(after.partitions[0].numberingSlots.length,0)
})

test('automatic numbering can finish a partial immediate renumbering without losing held time slots', () => {
  const before=syncPartition(project(),verses())
  before.segments.forEach((s,i)=>{s.startTime=10+i*4;s.endTime=14+i*4;s.timingSet=true})
  let after=resetPartitionNumbers(before,before.partitions[0])
  after=numberPartitionCell(after,after.partitions[0],partitionCells(after.partitions[0])[0].key)
  const p=withLyricOrder(after.partitions[0],3,automaticLyricRows(after.partitions[0],3))
  after=syncPartition(after,p,true)
  after=restoreNumberingSlots(after,p.pageId,after.segments.filter(s=>!s.timingSet).map(s=>s.id))
  after=bindTimingToScoreOrder(after)
  assert.deepEqual(after.segments.map(s=>[s.startTime,s.endTime,s.timingSet]),before.segments.map(s=>[s.startTime,s.endTime,s.timingSet]))
})

test('cutting numbered phrase 09 keeps its number, ID and recorded time while the right child stays unnumbered', () => {
  let p={...emptyPartition('p1'),numberedKeys:undefined}
  for(let i=0;i<=12;i++)p=addGuide(p,'horizontal',.05+i*.06,`line-${i}`)
  p=addGuide(addGuide(p,'vertical',.1,'left'),'vertical',.9,'right')
  let before=syncPartition(project(),p)
  before.segments.forEach((s,i)=>{s.startTime=10+i*4;s.endTime=14+i*4;s.timingSet=true})
  before.flags=before.segments.map((s,i)=>({id:`f${i}`,segmentId:s.id,time:s.startTime,kind:i?'transition':'start'}))
  before=initializePartitionNumbers(before)
  const ninth=before.segments[8]
  const next=syncPartition(before,addCellCut(before.partitions[0],.5,ninth.region.y+ninth.region.height/2,'cut-09'))
  assert.equal(next.segments.length,12)
  assert.equal(next.segments[8].id,ninth.id)
  assert.equal(next.segments[8].region.width,.4)
  assert.deepEqual(next.segments.map(s=>[s.id,s.startTime,s.endTime,s.timingSet]),before.segments.map(s=>[s.id,s.startTime,s.endTime,s.timingSet]))
  assert.deepEqual(next.flags,before.flags)
  const right=partitionCells(next.partitions[0]).find(c=>c.key.endsWith(':cut-09:right'))
  assert.ok(right)
  assert.ok(!next.partitions[0].numberedKeys.includes(right.key))
})

test('merging equally overlapping numbered rows keeps the earlier phrase despite floating point rounding', () => {
  const p={pageId:'p1',horizontal:Array.from({length:31},(_,i)=>({id:`h${i}`,position:.1+.025*i})),vertical:[{id:'left',position:.1},{id:'right',position:.9}],cuts:[],excluded:[]}
  let before={...project(),partitions:[p],segments:Array.from({length:30},(_,i)=>({id:`s${i+1}`,pageId:'p1',partitionKey:`p1:h${i}:h${i+1}:left:right`,region:{x:.1,y:.1+.025*i,width:.8,height:.025},startTime:4*i,endTime:4*(i+1),timingSet:true,direction:'left-to-right'}))}
  before=initializePartitionNumbers(before)
  const after=syncPartition(before,removeGuide(before.partitions[0],'h6'))
  assert.equal(after.segments.length,29)
  assert.equal(after.segments[5].id,'s6')
  assert.equal(after.segments[6].id,'s8')
})

test('automatic numbering skips taller notation bands without needing manual exclusions', () => {
  const p={...verses(),excluded:[],numberedKeys:[]}
  const rows=automaticLyricRows(p,3)
  assert.equal(rows['h3:h4'],0)
  assert.deepEqual(rowOrder(syncPartition(project(),withLyricOrder(p,3,rows)).segments),['h0','h4','h1','h5','h2','h6'])
  // A user can explicitly include the tall row, or skip a normal lyric row.
  const override=automaticLyricRows(p,3,{...rows,'h3:h4':1,'h1:h2':0})
  assert.notEqual(override['h3:h4'],0)
  assert.equal(override['h1:h2'],0)
})
