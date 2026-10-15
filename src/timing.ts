import type { KaraokeFlag, Project, Segment } from './types'

export type TimingEdge = 'start' | 'end' | 'move' | 'both'
type TimingProject = Pick<Project, 'segments' | 'flags' | 'highlight'>
const MINIMUM = .1

export function timedSegmentIds(project: Pick<Project, 'segments' | 'flags'>): Set<string> {
  return new Set([...project.segments.filter(s => s.timingSet).map(s => s.id),
    ...(project.flags || []).filter(f => f.kind !== 'end').map(f => f.segmentId)])
}

/** Flags are views of assigned times. Never recover deliberately removed assignments here. */
export function refreshTimingFlags(project: Project): Project {
  const assigned = timedSegmentIds(project)
  const timed = project.segments.filter(s => assigned.has(s.id)).sort((a, b) => a.startTime - b.startTime)
  const old = new Map((project.flags || []).filter(f => f.kind !== 'end').map(f => [f.segmentId, f]))
  const flags: KaraokeFlag[] = timed.map((s, index) => ({ id: old.get(s.id)?.id || `timing-${s.id}`,
    segmentId: s.id, time: s.startTime, kind: index ? 'transition' : 'start' }))
  const ending = project.flags?.find(f => f.kind === 'end' && assigned.has(f.segmentId))
  if (ending && timed.length) flags.push({ ...ending, segmentId: timed[timed.length - 1].id, time: timed[timed.length - 1].endTime })
  return { ...project, flags, scoreTimingBound: true }
}

/** In full highlight, starts define shared boundaries. Unassigned score boxes stay in place. */
export function connectFullTiming(project: Project): Project {
  if (project.highlight.mode !== 'full') return project
  const assigned = timedSegmentIds(project)
  const timed = project.segments.filter(s => assigned.has(s.id))
  let changed = false
  let spareTimings = project.spareTimings
  if (spareTimings?.length) {
    const trimmed = spareTimings.flatMap(slot => {
      let pieces = [slot]
      for (const s of timed) pieces = pieces.flatMap(piece => {
        if (s.endTime <= piece.startTime || s.startTime >= piece.endTime) return [piece]
        return [{ startTime: piece.startTime, endTime: Math.min(piece.endTime, s.startTime) },
          { startTime: Math.max(piece.startTime, s.endTime), endTime: piece.endTime }]
          .filter(range => range.endTime - range.startTime >= MINIMUM)
      })
      return pieces
    })
    if (JSON.stringify(trimmed) !== JSON.stringify(spareTimings)) { spareTimings = trimmed; changed = true }
  }
  const ends = new Map(timed.slice(0, -1).flatMap((s, i) => {
    const next = timed[i + 1]
    return next.startTime >= s.startTime + MINIMUM ? [[s.id, next.startTime] as const] : []
  }))
  const segments = project.segments.map(s => {
    const endTime = ends.get(s.id)
    if (endTime === undefined || Math.abs(endTime - s.endTime) < .000001) return s
    changed = true
    return { ...s, endTime }
  })
  return changed ? refreshTimingFlags({ ...project, segments, spareTimings }) : project
}

/** A full-mode edit shares edges with neighbours; wipe-mode edits are independent. */
export function previewTimingEdit(project: TimingProject, id: string, start: number, end: number,
  edge: TimingEdge, duration: number): Segment[] {
  const assigned = timedSegmentIds(project)
  const source = project.segments.find(s => s.id === id)
  if (!source || !assigned.has(id) || !Number.isFinite(start) || !Number.isFinite(end)) return project.segments
  const limit = duration > 0 ? duration : Math.max(end, ...project.segments.map(s => s.endTime))
  const full = project.highlight.mode === 'full'
  const timed = project.segments.filter(s => assigned.has(s.id))
  const index = timed.findIndex(s => s.id === id)
  const previous = full ? timed[index - 1] : undefined
  const next = full ? timed[index + 1] : undefined
  let startTime = source.startTime, endTime = source.endTime
  const lower = previous ? previous.startTime + MINIMUM : 0
  const upper = next ? Math.min(limit, next.endTime - MINIMUM) : limit
  if (edge === 'move') {
    const span = source.endTime - source.startTime
    startTime = Math.max(lower, Math.min(upper - span, start))
    endTime = startTime + span
  } else {
    if (edge === 'start' || edge === 'both') startTime = Math.max(lower, Math.min(endTime - MINIMUM, start))
    if (edge === 'end' || edge === 'both') endTime = Math.min(upper, Math.max(startTime + MINIMUM, end))
  }
  if (startTime < lower || endTime > upper + .000001 || endTime - startTime < MINIMUM - .000001) return project.segments
  return project.segments.map(s => {
    if (s.id === id) return { ...s, startTime, endTime, timingSet: true }
    if (previous && s.id === previous.id) return { ...s, endTime: startTime }
    if (next && s.id === next.id) return { ...s, startTime: endTime }
    return s
  })
}

export function editTiming(project: Project, id: string, start: number, end: number, edge: TimingEdge, duration: number): Project {
  const prepared = connectFullTiming(project)
  const segments = previewTimingEdit(prepared, id, start, end, edge, duration)
  return segments === prepared.segments ? prepared : connectFullTiming(refreshTimingFlags({ ...prepared, segments }))
}

/** Removing a timeline item never deletes or renumbers its score box. */
export function removeTiming(project: Project, id: string): Project {
  const index = project.segments.findIndex(s => s.id === id)
  if (index < 0) return project
  const removed = new Set(project.segments.filter((s, i) => project.highlight.mode === 'full' ? i >= index : s.id === id).map(s => s.id))
  const segments = project.segments.map(s => removed.has(s.id) ? { ...s, timingSet: false } : s)
  return refreshTimingFlags({ ...project, segments, flags: project.flags?.filter(f => !removed.has(f.segmentId)),
    spareTimings: project.highlight.mode === 'full' ? project.spareTimings?.filter(slot => slot.endTime <= project.segments[index].startTime) : project.spareTimings })
}

export function insertTiming(project: Project, id: string, at: number, duration: number): Project {
  const segment = project.segments.find(s => s.id === id)
  if (!segment || timedSegmentIds(project).has(id) || !Number.isFinite(at)) return project
  const spare = project.spareTimings?.find(slot => Math.abs(slot.startTime - at) < .0001)
  if (project.highlight.mode === 'full' && (!spare || project.segments.find(s => !timedSegmentIds(project).has(s.id))?.id !== id)) return project
  const limit = duration > 0 ? duration : Math.max(at + 4, segment.endTime)
  const startTime = Math.max(0, Math.min(limit - MINIMUM, at))
  const endTime = Math.min(limit, spare?.endTime ?? (at >= segment.startTime && at < segment.endTime
    ? segment.endTime : startTime + Math.max(MINIMUM, segment.endTime - segment.startTime)))
  return connectFullTiming(refreshTimingFlags({ ...project,
    spareTimings: spare ? project.spareTimings?.filter(slot => slot !== spare) : project.spareTimings,
    segments: project.segments.map(s => s.id === id ? { ...s, startTime, endTime, timingSet: true } : s) }))
}

/** Merge geometry without merging time spans: keep the old slots and rebind by score order. */
export function rebindAfterMerge(before: Project, after: Project): Project {
  if (after.segments.length >= before.segments.length) return after
  const assigned = timedSegmentIds(before)
  const segments = after.segments.map((s, index) => ({ ...s,
    startTime: before.segments[index].startTime, endTime: before.segments[index].endTime,
    timingSet: assigned.has(before.segments[index].id),
  }))
  const spareTimings = [...before.segments.slice(segments.length).filter(s => assigned.has(s.id))
    .map(s => ({ startTime: s.startTime, endTime: s.endTime })), ...(before.spareTimings || [])]
    .sort((a, b) => a.startTime - b.startTime)
  const validIds = new Set(segments.filter(s => s.timingSet).map(s => s.id))
  const flags = (before.flags || []).filter(f => f.kind !== 'end' && validIds.has(f.segmentId))
  const ending = before.flags?.find(f => f.kind === 'end')
  const last = segments.filter(s => s.timingSet).slice(-1)[0]
  if (ending && last) flags.push({ ...ending, segmentId: last.id, time: last.endTime })
  // Removed/unassigned slots must not be reintroduced through old IDs in flags.
  return connectFullTiming(refreshTimingFlags({ ...after, segments, flags, spareTimings }))
}
