import type { KaraokeFlag, Project, Segment, SegmentRegion } from './types'

export function segmentRegions(segment: Segment): SegmentRegion[] {
  return segment.regions?.length ? segment.regions : [{ pageId: segment.pageId, region: segment.region }]
}

export function regionReveal(regions: SegmentRegion[], progress: number): number[] {
  const widths = regions.map(item => Math.max(.001, item.region.width))
  const total = widths.reduce((sum, width) => sum + width, 0)
  let distance = Math.max(0, Math.min(1, progress)) * total
  return widths.map(width => {
    const fraction = Math.max(0, Math.min(1, distance / width))
    distance -= width
    return fraction
  })
}

export function recoverFlagsFromTiming(project: Project): Project {
  if (!project.segments.length || project.flags?.length) return project
  const calibrated: Segment[] = []
  for (const [index, segment] of project.segments.entries()) {
    const defaultByIndex = Math.abs(segment.startTime - index * 4) < .001 && Math.abs(segment.endTime - (index + 1) * 4) < .001
    const defaultAtZero = Math.abs(segment.startTime) < .001 && Math.abs(segment.endTime - 4) < .001
    if (defaultByIndex || defaultAtZero || segment.endTime <= segment.startTime ||
      (calibrated.length && segment.startTime < calibrated[calibrated.length - 1].startTime - .05)) break
    calibrated.push(segment)
  }
  if (!calibrated.length) return project
  const flags: KaraokeFlag[] = calibrated.map((segment, index) => ({
    id: `recovered-${segment.id}`, time: segment.startTime, segmentId: segment.id,
    kind: index === 0 ? 'start' : 'transition',
  }))
  return { ...project, flags }
}

export function bindTimingToScoreOrder(project: Project): Project {
  const timedIds = new Set((project.flags || []).filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
  const timed = project.segments.filter(segment => segment.timingSet || timedIds.has(segment.id))
    .sort((a, b) => a.startTime - b.startTime)
  const untimed = project.segments.filter(segment => !segment.timingSet && !timedIds.has(segment.id))
  const slots = [...timed, ...untimed]
  const slotById = new Map(slots.map((segment, index) => [segment.id, index]))
  const segments = project.segments.map((segment, index) => ({ ...segment,
    startTime: slots[index].startTime,
    endTime: slots[index].endTime,
    timingSet: Boolean(slots[index].timingSet || timedIds.has(slots[index].id)),
  }))
  const flags = project.flags?.map(flag => {
    const slot = slotById.get(flag.segmentId)
    return slot === undefined ? flag : { ...flag, segmentId: segments[slot].id }
  })
  return { ...project, segments, flags, scoreTimingBound: true }
}

export function formatTime(seconds: number) {
  const safe = Math.max(0, seconds || 0)
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0')
  const secs = Math.floor(safe % 60).toString().padStart(2, '0')
  const millis = Math.floor((safe % 1) * 1000).toString().padStart(3, '0')
  return `${minutes}:${secs}.${millis}`
}

export function fitRegion(region: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(0, Math.min(1, region.x)); const y = Math.max(0, Math.min(1, region.y))
  return { x, y, width: Math.max(0.005, Math.min(1 - x, region.width)), height: Math.max(0.005, Math.min(1 - y, region.height)) }
}

export function calculateKaraokeProgress(start: number, end: number, anchors: { time: number; progress: number }[] = [], at: number) {
  if (end <= start) return 0
  const points = [{ time: start, progress: 0 }, ...anchors, { time: end, progress: 1 }].sort((a, b) => a.time - b.time)
  if (at <= points[0].time) return points[0].progress
  if (at >= points[points.length - 1].time) return points[points.length - 1].progress
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]; const b = points[i + 1]
    if (a.time <= at && at <= b.time) {
      if (b.time <= a.time) return b.progress
      return Math.max(0, Math.min(1, a.progress + (b.progress - a.progress) * ((at - a.time) / (b.time - a.time))))
    }
  }
  return 0
}

export function migrateLegacyCuts(project: Project): Project {
  let hadCuts = false
  const segments = project.segments.flatMap(segment => {
    const legacy = segment as Segment & { cuts?: number[]; anchors?: { time: number; progress: number }[] }
    const cuts = [...new Set((legacy.cuts || []).filter(cut => cut > 0 && cut < 1))].sort((a, b) => a - b)
    const { cuts: _cuts, anchors: _anchors, ...base } = legacy
    if (!cuts.length) return [base]
    hadCuts = true
    const edges = [0, ...cuts, 1]
    return edges.slice(0, -1).map((from, index): Segment => {
      const to = edges[index + 1]
      return {
        ...base,
        id: index ? `${segment.id}-part-${index + 1}` : segment.id,
        region: { ...segment.region, x: segment.region.x + segment.region.width * from, width: segment.region.width * (to - from) },
        startTime: segment.startTime + (segment.endTime - segment.startTime) * from,
        endTime: segment.startTime + (segment.endTime - segment.startTime) * to,
      }
    })
  })
  return { ...project, segments, flags: hadCuts ? [] : project.flags }
}

export function calculateCameraTarget(centerY: number, pageHeight: number, viewportHeight: number, currentY: number, safeZone = 0.58) {
  const maxScroll = Math.max(0, pageHeight - viewportHeight)
  const current = Math.max(0, Math.min(maxScroll, currentY))
  const visibleY = centerY - current
  if (visibleY >= viewportHeight * .30 && visibleY <= viewportHeight * .72) return current
  return Math.max(0, Math.min(maxScroll, centerY - viewportHeight * safeZone))
}
