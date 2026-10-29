import type { Project } from './types'
import { initialProject } from './types'
import { connectFullTiming, refreshTimingFlags, timedSegmentIds } from './timing'
import { segmentRegions } from './utils'

export function emptyProject(): Project {
  return { ...structuredClone(initialProject), projectId: null, scoreTimingBound: true }
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
