import type { Project, Segment } from './types'
import { initialProject } from './types'
import { connectFullTiming, refreshTimingFlags, timedSegmentIds } from './timing'
import { segmentRegions } from './utils'

export function emptyProject(): Project {
  return { ...structuredClone(initialProject), projectId: null, scoreTimingBound: true }
}

/** Append independent performances of the selected score regions, awaiting new timing. */
export function repeatScoreRegions(project: Project, selectedIds: string[], duration: number, makeId: (index: number) => string): Project {
  const sources = project.segments.filter(segment => selectedIds.includes(segment.id))
  if (!sources.length) return project
  const assigned = timedSegmentIds(project)
  const lastAssignedEnd = Math.max(0, ...project.segments.filter(segment => assigned.has(segment.id)).map(segment => segment.endTime))
  const audioEnd = duration || project.audioDuration || lastAssignedEnd + sources.length * 1.1 + 2
  const copies = sources.map((source, index): Segment => {
    const startTime = Math.max(0, Math.min(audioEnd - .1, lastAssignedEnd + index * 1.1))
    const regions = segmentRegions(source).map(item => ({ pageId: item.pageId, region: { ...item.region } }))
    return { ...source, partitionKey: undefined,
      repeatSourceId: source.repeatSourceId || (source.partitionKey ? source.id : undefined),
      id: makeId(index), pageId: regions[0].pageId, region: regions[0].region,
      regions: regions.length > 1 ? regions : undefined, startTime, endTime: Math.min(audioEnd, startTime + 1), timingSet: false }
  })
  return { ...project, segments: [...project.segments, ...copies],
    flags: project.highlight.mode === 'full' ? project.flags?.filter(flag => flag.kind !== 'end') : project.flags }
}

export function removeScorePages(project: Project, pageIds: Set<string>): Project {
  const pages = project.pages.filter(page => !pageIds.has(page.id))
  if (pages.length === project.pages.length) return project
  if (!pages.length) return { ...project, pages: [], source: { ...project.source, pdf: null },
    segments: [], flags: [], partitions: [], spareTimings: [], scoreTimingBound: true }
  const assigned = timedSegmentIds(project)
  const segments = project.segments.flatMap(segment => {
    const parts = segmentRegions(segment)
    const kept = parts.filter(part => !pageIds.has(part.pageId))
    if (!kept.length) return []
    if (kept.length === parts.length) return [{ ...segment, timingSet: assigned.has(segment.id) }]
    return [{ ...segment, pageId: kept[0].pageId, region: kept[0].region,
      regions: kept.length > 1 ? kept : undefined, timingSet: assigned.has(segment.id),
      partitionKey: pageIds.has(segment.pageId) ? undefined : segment.partitionKey }]
  })
  const ids = new Set(segments.map(segment => segment.id))
  return connectFullTiming(refreshTimingFlags({ ...project, pages, segments,
    flags: project.flags?.filter(flag => ids.has(flag.segmentId)),
    partitions: project.partitions?.filter(partition => !pageIds.has(partition.pageId)) }))
}
