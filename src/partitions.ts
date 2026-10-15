import type { PagePartition, PartitionGuide, Project, Region, Segment } from './types'

export type PartitionTool = 'line-h' | 'line-v' | 'cell-cut' | 'line-edit'
export type PartitionCell = { key: string; region: Region; top: string; bottom: string; left: string; right: string }
export const GAP = .006
const sorted = (lines: PartitionGuide[]) => [...lines].sort((a, b) => a.position - b.position)
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const emptyPartition = (pageId: string): PagePartition => ({ pageId, horizontal: [], vertical: [], cuts: [], excluded: [] })
export const containsPoint = (r: Region, x: number, y: number) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height

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

export function syncPartition(project: Project, partition: PagePartition): Project {
  const previous = project.partitions?.find(item => item.pageId === partition.pageId)
  if (previous) {
    const skipped = partitionCells(previous).filter(cell => partition.excluded.includes(cell.key))
    const inherited = partitionCells(partition).filter(cell => skipped.some(old => {
      const a = cell.region, b = old.region
      return a.x >= b.x - 1e-8 && a.y >= b.y - 1e-8 && a.x + a.width <= b.x + b.width + 1e-8 && a.y + a.height <= b.y + b.height + 1e-8
    })).map(cell => cell.key)
    partition = { ...partition, excluded: [...new Set([...partition.excluded, ...inherited])] }
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
  const generated = cells.map(cell => {
    let match = matches.get(cell.key)
    if (!match) {
      let best = 0
      for (const candidate of old.filter(item => available.has(item.id))) {
        const a = cell.region, b = candidate.region
        const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
        const score = area / Math.min(a.width * a.height, b.width * b.height)
        if (score > best && score > .5) { best = score; match = candidate }
      }
      if (match) available.delete(match.id)
    }
    return { ...(match || { id: `partition-${cell.key}`, startTime: 0, endTime: 4, timingSet: false, direction: 'left-to-right' as const }),
      pageId: partition.pageId, region: cell.region, regions: undefined, partitionKey: cell.key }
  })
  const segments = [...project.segments.filter(segment => segment.pageId !== partition.pageId || !segment.partitionKey), ...generated]
  const byId = new Map(generated.map(segment => [segment.id, segment]))
  const sameTopology = old.length === generated.length && old.every(segment => byId.has(segment.id))
  const pageIndex = new Map(project.pages.map((page, index) => [page.id, index]))
  if (sameTopology) segments.splice(0, segments.length, ...project.segments.map(segment => byId.get(segment.id) || segment))
  else segments.sort((a, b) => (pageIndex.get(a.pageId) || 0) - (pageIndex.get(b.pageId) || 0) || a.region.y - b.region.y || a.region.x - b.region.x)
  const retained = new Set(segments.map(segment => segment.id))
  const flags = project.flags?.filter(flag => retained.has(flag.segmentId))
  return { ...project, segments, flags,
    partitions: [...(project.partitions || []).filter(item => item.pageId !== partition.pageId), partition] }
}
