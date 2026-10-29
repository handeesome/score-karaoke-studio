import type { PagePartition, PartitionGuide, Project, Region, Segment } from './types'
import { refreshTimingFlags, timedSegmentIds } from './timing'

export type PartitionTool = 'line-h' | 'line-v' | 'cell-cut' | 'line-edit' | 'number'
export type PartitionCell = { key: string; region: Region; top: string; bottom: string; left: string; right: string }
export const GAP = .006
const sorted = (lines: PartitionGuide[]) => [...lines].sort((a, b) => a.position - b.position)
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const emptyPartition = (pageId: string): PagePartition => ({ pageId, horizontal: [], vertical: [], cuts: [], excluded: [], numberedKeys: [] })
export const containsPoint = (r: Region, x: number, y: number) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height

/** Keep old project numbers, then make future cells opt-in like new projects. */
export function initializePartitionNumbers(project: Project): Project {
  return { ...project, partitions: project.partitions?.map(partition => partition.numberedKeys !== undefined ? partition : {
    ...partition, numberedKeys: project.segments.filter(segment => segment.pageId === partition.pageId && segment.partitionKey).map(segment => segment.partitionKey!),
  }) }
}

/** Clear the current page's order, keeping its recorded slots for immediate renumbering. */
export function resetPartitionNumbers(project: Project, partition: PagePartition): Project {
  const assigned = timedSegmentIds(project)
  const removed = project.segments.filter(s => s.pageId === partition.pageId && s.partitionKey)
  const slots = [...removed.filter(s => assigned.has(s.id)).map(s => ({ startTime: s.startTime, endTime: s.endTime })), ...(partition.numberingSlots || [])]
    .sort((a, b) => a.startTime - b.startTime)
  const ending = Boolean(partition.numberingEnd || project.flags?.some(f => f.kind === 'end' && removed.some(s => s.id === f.segmentId)))
  return syncPartition(project, { ...partition, numberedKeys: [], lyricOrder: undefined, numberingSlots: slots, numberingEnd: ending }, true)
}

/** One click is one saved edit. Reuse held time slots after restarting the numbering. */
export function numberPartitionCell(project: Project, partition: PagePartition, key: string): Project {
  const keys = project.segments.filter(s => s.pageId === partition.pageId && s.partitionKey).map(s => s.partitionKey!)
  if (keys.includes(key) || partition.excluded.includes(key) || !partitionCells(partition).some(cell => cell.key === key)) return project
  const next = syncPartition(project, { ...partition, numberedKeys: [...keys, key], lyricOrder: undefined }, true)
  const target = next.segments.find(s => s.partitionKey === key)
  return target ? restoreNumberingSlots(next, partition.pageId, [target.id]) : next
}

/** Both manual and automatic numbering consume the same saved time slots. */
export function restoreNumberingSlots(project: Project, pageId: string, targetIds: string[]): Project {
  const partition = project.partitions?.find(p => p.pageId === pageId)
  const slots = partition?.numberingSlots || []
  if (!slots.length || !targetIds.length) return project
  const used = Math.min(slots.length, targetIds.length)
  const assignments = new Map(targetIds.slice(0, used).map((id, index) => [id, slots[index]]))
  const remaining = slots.slice(used)
  const next = { ...project,
    segments: project.segments.map(s => assignments.has(s.id) ? { ...s, ...assignments.get(s.id)!, timingSet: true } : s),
    partitions: project.partitions?.map(p => p.pageId === pageId ? { ...p, numberingSlots: remaining, numberingEnd: remaining.length ? p.numberingEnd : undefined } : p),
  }
  if (!remaining.length && partition?.numberingEnd) next.flags = [...(next.flags || []), { id: `numbering-end-${targetIds[used - 1]}`, segmentId: targetIds[used - 1], time: slots[used - 1].endTime, kind: 'end' }]
  return refreshTimingFlags(next)
}

export function partitionCells(partition: PagePartition): PartitionCell[] {
  const horizontal = sorted(partition.horizontal), vertical = sorted(partition.vertical)
  const cells: PartitionCell[] = []
  for (let row = 0; row < horizontal.length - 1; row++) {
    const top = horizontal[row], bottom = horizontal[row + 1]
    if (bottom.position - top.position < GAP - 1e-8) continue
    for (let col = 0; col < vertical.length - 1; col++) {
      const left = vertical[col], right = vertical[col + 1]
      const cuts = partition.cuts.filter(cut => {
        const a = horizontal.find(line => line.id === cut.top), b = horizontal.find(line => line.id === cut.bottom)
        const l = vertical.find(line => line.id === cut.left), r = vertical.find(line => line.id === cut.right)
        return a && b && l && r && a.position <= top.position && b.position >= bottom.position &&
          cut.position > left.position && cut.position < right.position && cut.position > l.position && cut.position < r.position
      })
      const edges = sorted([left, ...cuts, right])
      for (let part = 0; part < edges.length - 1; part++) {
        const start = edges[part], end = edges[part + 1]
        if (end.position - start.position < GAP - 1e-8) continue
        cells.push({ key: [partition.pageId, top.id, bottom.id, start.id, end.id].join(':'),
          top: top.id, bottom: bottom.id, left: left.id, right: right.id,
          region: { x: start.position, y: top.position, width: end.position - start.position, height: bottom.position - top.position } })
      }
    }
  }
  return cells
}

export function partitionLyricRows(partition: PagePartition) {
  const rows = new Map<string, { key: string; region: Region; cells: PartitionCell[] }>()
  for (const cell of partitionCells(partition)) {
    const key = `${cell.top}:${cell.bottom}`
    let row = rows.get(key)
    if (!row) {
      row = { key, region: { ...cell.region }, cells: [] }
      rows.set(key, row)
    }
    row.region.width = cell.region.x + cell.region.width - row.region.x
    row.cells.push(cell)
  }
  return [...rows.values()]
}

/** Only active lyric rows advance the verse cycle; skipped notation bands do not. */
export function automaticLyricRows(partition: PagePartition, verseCount: number, enabled?: Record<string, number>) {
  const rows = partitionLyricRows(partition)
  const numbered = new Set(partition.numberedKeys || [])
  const hasNumber = (row: typeof rows[number]) => row.cells.some(cell => numbered.has(cell.key))
  // Lyric bands have comparable heights; notation between systems is taller.
  // Existing manual numbers supply lyric examples without treating every unnumbered row as notation.
  const examples = rows.filter(row => numbered.size ? hasNumber(row) : !row.cells.every(cell => partition.excluded.includes(cell.key)))
  const heights = examples.map(row => row.region.height).sort((a, b) => a - b)
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0
  let index = 0
  return Object.fromEntries(rows.map(row => {
    const saved = enabled?.[row.key] ?? partition.lyricOrder?.rows[row.key]
    const notation = rows.length >= 3 && heights.length >= 2 && !hasNumber(row) && row.region.height > median * 1.65
    const skipped = saved !== undefined ? saved === 0 : row.cells.every(cell => partition.excluded.includes(cell.key)) || notation
    return [row.key, skipped ? 0 : index++ % Math.max(1, verseCount) + 1]
  }))
}

export function withLyricOrder(partition: PagePartition, verseCount: number, rows: Record<string, number>): PagePartition {
  const excluded = new Set(partition.excluded)
  for (const row of partitionLyricRows(partition)) {
    if (rows[row.key] === 0) row.cells.forEach(cell => excluded.add(cell.key))
    else if (row.cells.every(cell => excluded.has(cell.key))) row.cells.forEach(cell => excluded.delete(cell.key))
  }
  return { ...partition, excluded: [...excluded], numberedKeys: undefined, lyricOrder: verseCount > 1 ? { verseCount, rows: { ...rows } } : undefined }
}

export function addGuide(partition: PagePartition, axis: 'horizontal' | 'vertical', position: number, id: string): PagePartition {
  position = clamp(position)
  if (partition[axis].some(line => Math.abs(line.position - position) < GAP)) return partition
  return { ...partition, [axis]: [...partition[axis], { id, position }] }
}

export function addCellCut(partition: PagePartition, x: number, y: number, id: string): PagePartition {
  const cell = partitionCells(partition).find(cell => containsPoint(cell.region, x, y))
  if (!cell || x - cell.region.x < GAP || cell.region.x + cell.region.width - x < GAP) return partition
  return { ...partition, cuts: [...partition.cuts, { id, position: x, top: cell.top, bottom: cell.bottom, left: cell.left, right: cell.right }] }
}

export function removeGuide(partition: PagePartition, id: string): PagePartition {
  return { ...partition, horizontal: partition.horizontal.filter(line => line.id !== id),
    vertical: partition.vertical.filter(line => line.id !== id),
    cuts: partition.cuts.filter(cut => ![cut.id, cut.top, cut.bottom, cut.left, cut.right].includes(id)) }
}

export function moveGuide(partition: PagePartition, id: string, position: number): PagePartition {
  const axis = partition.horizontal.some(line => line.id === id) ? 'horizontal' : partition.vertical.some(line => line.id === id) ? 'vertical' : 'cuts'
  const lines = sorted(partition[axis])
  const index = lines.findIndex(line => line.id === id)
  if (index < 0) return partition
  let low = 0, high = 1
  if (axis === 'cuts') {
    const cut = partition.cuts.find(line => line.id === id)!
    const left = partition.vertical.find(line => line.id === cut.left), right = partition.vertical.find(line => line.id === cut.right)
    if (!left || !right) return partition
    low = left.position + GAP; high = right.position - GAP
    for (const other of partition.cuts.filter(other => other.id !== id && other.top === cut.top && other.bottom === cut.bottom)) {
      if (other.position < cut.position) low = Math.max(low, other.position + GAP)
      else high = Math.min(high, other.position - GAP)
    }
  } else {
    low = index ? lines[index - 1].position + GAP : 0
    high = index < lines.length - 1 ? lines[index + 1].position - GAP : 1
    if (axis === 'vertical') for (const cut of partition.cuts) {
      if (cut.left === id) high = Math.min(high, cut.position - GAP)
      if (cut.right === id) low = Math.max(low, cut.position + GAP)
    }
  }
  return { ...partition, [axis]: partition[axis].map(line => line.id === id ? { ...line, position: clamp(position, low, high) } : line) }
}

export function syncPartition(project: Project, partition: PagePartition, renumber = false): Project {
  const previous = project.partitions?.find(item => item.pageId === partition.pageId)
  if (previous) {
    const skipped = partitionCells(previous).filter(cell => partition.excluded.includes(cell.key))
    const inherited = partitionCells(partition).filter(cell => skipped.some(old => {
      const a = cell.region, b = old.region
      return a.x >= b.x - 1e-8 && a.y >= b.y - 1e-8 && a.x + a.width <= b.x + b.width + 1e-8 && a.y + a.height <= b.y + b.height + 1e-8
    })).map(cell => cell.key)
    partition = { ...partition, excluded: [...new Set([...partition.excluded, ...inherited])] }
    if (partition.lyricOrder && previous.lyricOrder) {
      const oldRows = partitionLyricRows(previous)
      const rows = { ...partition.lyricOrder.rows }
      for (const row of partitionLyricRows(partition)) {
        if (rows[row.key] !== undefined) continue
        const parent = oldRows.find(old => row.region.y >= old.region.y - 1e-8 &&
          row.region.y + row.region.height <= old.region.y + old.region.height + 1e-8)
        if (parent && previous.lyricOrder.rows[parent.key] !== undefined) rows[row.key] = previous.lyricOrder.rows[parent.key]
      }
      partition = { ...partition, lyricOrder: { ...partition.lyricOrder, rows } }
    }
  }
  const old = project.segments.filter(segment => segment.pageId === partition.pageId && segment.partitionKey)
  const available = new Set(old.map(segment => segment.id))
  const cells = partitionCells(partition).filter(cell => !partition.excluded.includes(cell.key))
  // Reserve exact matches before matching newly split/merged cells by area.
  const matches = new Map<string, Segment>()
  for (const cell of cells) {
    const match = old.find(segment => segment.partitionKey === cell.key)
    if (match) { matches.set(cell.key, match); available.delete(match.id) }
  }
  let generated = cells.map(cell => {
    let match = matches.get(cell.key)
    if (!match) {
      let best = 0
      for (const candidate of old.filter(item => available.has(item.id))) {
        const a = cell.region, b = candidate.region
        const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
        const score = area / Math.min(a.width * a.height, b.width * b.height)
        // Equal overlaps keep the earlier numbered phrase, despite float rounding.
        if (score > best + 1e-8 && score > .5) { best = score; match = candidate }
      }
      if (match) available.delete(match.id)
    }
    return { ...(match || { id: `partition-${cell.key}`, startTime: 0, endTime: 4, timingSet: false, direction: 'left-to-right' as const }),
      pageId: partition.pageId, region: cell.region, regions: undefined, partitionKey: cell.key }
  })
  // Candidate cells are geometry only. A manual order opts cells into the song.
  // When a line splits an already numbered cell, its best matching child keeps the number.
  if (partition.numberedKeys !== undefined) {
    const byKey = new Map(generated.map(segment => [segment.partitionKey, segment]))
    const byId = new Map(generated.map(segment => [segment.id, segment]))
    const used = new Set<string>()
    generated = partition.numberedKeys.flatMap(key => {
      const oldId = old.find(segment => segment.partitionKey === key)?.id
      const match = byKey.get(key) || (oldId ? byId.get(oldId) : undefined)
      if (!match || used.has(match.id)) return []
      used.add(match.id)
      return [match]
    })
    partition = { ...partition, numberedKeys: generated.map(segment => segment.partitionKey!) }
  }
  const segments = [...project.segments.filter(segment => segment.pageId !== partition.pageId || !segment.partitionKey), ...generated]
  const byId = new Map(generated.map(segment => [segment.id, segment]))
  const sameTopology = old.length === generated.length && old.every(segment => byId.has(segment.id))
  const pageIndex = new Map(project.pages.map((page, index) => [page.id, index]))
  if (partition.numberedKeys !== undefined) {
    const numbered = new Map(generated.map((segment, index) => [segment.id, index]))
    segments.sort((a, b) => (pageIndex.get(a.pageId) || 0) - (pageIndex.get(b.pageId) || 0) ||
      (a.pageId === partition.pageId ? (numbered.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (numbered.get(b.id) ?? Number.MAX_SAFE_INTEGER) : 0))
  } else if (sameTopology && !renumber) segments.splice(0, segments.length, ...project.segments.map(segment => byId.get(segment.id) || segment))
  else {
    const partitions = [...(project.partitions || []).filter(p => p.pageId !== partition.pageId), partition]
    const verseByCell = new Map<string, number>()
    for (const page of partitions) if (page.lyricOrder) {
      const fallback = automaticLyricRows(page, page.lyricOrder.verseCount)
      for (const row of partitionLyricRows(page)) for (const cell of row.cells) {
        const verse = page.lyricOrder.rows[row.key] ?? fallback[row.key]
        verseByCell.set(cell.key, verse > 0 ? verse : page.lyricOrder.verseCount + 1)
      }
    }
    segments.sort((a, b) => (pageIndex.get(a.pageId) || 0) - (pageIndex.get(b.pageId) || 0) ||
      (verseByCell.get(a.partitionKey || '') || 1) - (verseByCell.get(b.partitionKey || '') || 1) ||
      a.region.y - b.region.y || a.region.x - b.region.x)
  }
  const retained = new Set(segments.map(segment => segment.id))
  const flags = project.flags?.filter(flag => retained.has(flag.segmentId))
  return { ...project, segments, flags,
    partitions: [...(project.partitions || []).filter(item => item.pageId !== partition.pageId), partition] }
}
