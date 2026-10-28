import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { AudioLines } from 'lucide-react'
import ActionDialog from './ActionDialog'
import type { KaraokeFlag, Segment, TimingRange } from '../types'
import { formatTime } from '../utils'
import { previewTimingEdit, type TimingEdge } from '../timing'

interface WaveformData {
  duration: number
  levels: number[]
  peaks: number[]
  kind: string
}

interface VocalProgress {
  progress: number | null
  elapsedSeconds: number
  lastProgressSeconds: number
  completedSegments?: number
  receivedAt: number
}

interface TimelinePanelProps {
  controls?: ReactNode
  audioUrl?: string | null
  audioName?: string | null
  duration: number
  flags: KaraokeFlag[]
  segments: Segment[]
  selected: string | null
  time: number
  playing: boolean
  highlightMode: 'wipe' | 'full'
  spareTimings?: TimingRange[]
  onSelect: (id: string) => void
  onSeek: (time: number) => void
  onChooseAudio: () => void
  onMoveSegment: (id: string, startTime: number, endTime: number, edge: TimingEdge) => void
  onDeleteTiming: (id: string) => void
  onInsertTiming: (id: string, at: number) => void
}

function clock(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

function envelopePath(values: number[]): string {
  if (!values.length) return ''
  const width = values.length
  const upper = values.map((value, index) => `${index + .5},${(50 - Math.max(.6, value * 45)).toFixed(2)}`).join(' L')
  const lower = values.map((value, index) => `${index + .5},${(50 + Math.max(.6, value * 45)).toFixed(2)}`).reverse().join(' L')
  return `M0,50 L${upper} L${width},50 L${lower} Z`
}

export default function TimelinePanel({ controls, audioUrl, audioName, duration, flags, segments, selected, time, playing, highlightMode, spareTimings = [], onSelect, onSeek, onChooseAudio, onMoveSegment, onDeleteTiming, onInsertTiming }: TimelinePanelProps) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [vocalProgress, setVocalProgress] = useState<VocalProgress | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [draggedSegment, setDraggedSegment] = useState<{ id: string; startTime: number; endTime: number } | null>(null)
  const draggingPointer = useRef<number | null>(null)
  const blockDrag = useRef<{ pointerId: number; id: string; mode: 'move' | 'start' | 'end'; startX: number; startTime: number; endTime: number; width: number; moved: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ fraction: number; offset: number } | null>(null)

  useEffect(() => {
    setWaveform(null)
    setError(null)
    setVocalProgress(null)
    if (!audioUrl) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setStage('正在准备人声波形…')
    const load = async () => {
      const response = await fetch('/api/waveform/vocals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioUrl }), signal: controller.signal,
      })
      let result = await response.json()
      if (!response.ok) throw new Error(result.detail || '无法读取音频波形')
      while (result.status === 'queued' || result.status === 'running') {
        if (controller.signal.aborted) return
        setStage(result.stage || '正在提取人声…')
        setVocalProgress({ progress: typeof result.progress === 'number' ? result.progress : null,
          elapsedSeconds: result.elapsedSeconds || 0, lastProgressSeconds: result.lastProgressSeconds || 0,
          completedSegments: result.completedSegments, receivedAt: Date.now() })
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        if (controller.signal.aborted) return
        const status = await fetch(`/api/waveform/vocals/${result.jobId}`, { signal: controller.signal })
        result = await status.json()
        if (!status.ok) throw new Error(result.detail || '无法读取人声提取进度')
      }
      if (result.status === 'failed') throw new Error(result.error || '人声提取失败')
      result = result.waveform
      const data = result as WaveformData
      if (!data?.levels?.length || data.peaks?.length !== data.levels.length) throw new Error('波形数据无效')
      if (!controller.signal.aborted) setWaveform(data)
    }
    void load().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '波形读取失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [audioUrl, retry])

  useEffect(() => {
    if (!loading) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [loading])

  const sinceReceived = Math.max(0, (now - (vocalProgress?.receivedAt || now)) / 1000)
  const elapsed = (vocalProgress?.elapsedSeconds || 0) + sinceReceived
  const quietSeconds = (vocalProgress?.lastProgressSeconds || 0) + sinceReceived

  const extent = duration > 0 ? duration : waveform?.duration || 90
  const timedSegmentIds = new Set(flags.filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
  const assigned = (s: Segment) => Boolean(s.timingSet || timedSegmentIds.has(s.id))
  const selectedSegment = segments.find(s => s.id === selected)
  const timingProject = { segments, flags, highlight: { opacity: .32, mode: highlightMode } }
  const previewSegments = draggedSegment && blockDrag.current ? previewTimingEdit(timingProject, draggedSegment.id,
    draggedSegment.startTime, draggedSegment.endTime, blockDrag.current.mode, extent) : segments
  const progress = Math.max(0, Math.min(100, time / extent * 100))
  const peakPath = useMemo(() => envelopePath(waveform?.peaks || []), [waveform])
  const levelPath = useMemo(() => envelopePath(waveform?.levels || []), [waveform])
  const tickCount = Math.round(5 * zoom)
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => clock(extent * index / tickCount))

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const wheelZoom = (event: WheelEvent) => {
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY) || blockDrag.current || draggingPointer.current !== null) return
      event.preventDefault()
      const scroller = scrollRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const offset = Math.max(0, Math.min(scroller.clientWidth, event.clientX - rect.left))
      const fraction = Math.max(0, Math.min(1, (scroller.scrollLeft + offset) / scroller.scrollWidth))
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1)
      setZoom(previous => {
        const next = Math.max(1, Math.min(8, previous * Math.exp(-pixels * .0015)))
        if (Math.abs(next - previous) < .001) return previous
        zoomAnchor.current = { fraction, offset }
        return next
      })
    }
    panel.addEventListener('wheel', wheelZoom, { passive: false })
    return () => panel.removeEventListener('wheel', wheelZoom)
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const anchor = zoomAnchor.current
    if (scroller && anchor) scroller.scrollLeft = anchor.fraction * scroller.scrollWidth - anchor.offset
    zoomAnchor.current = null
  }, [zoom])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!playing || !scroller || zoom === 1 || blockDrag.current) return
    const cursor = time / extent * scroller.scrollWidth
    if (cursor > scroller.scrollLeft + scroller.clientWidth * .78) scroller.scrollLeft = cursor - scroller.clientWidth * .78
    if (cursor < scroller.scrollLeft + scroller.clientWidth * .18) scroller.scrollLeft = cursor - scroller.clientWidth * .18
  }, [time, playing, zoom, extent])

  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(extent, (event.clientX - rect.left) / rect.width * extent)))
  }

  const startSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (!audioName || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as Element).closest('.timeline-block, .flag-tick')) return
    draggingPointer.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    seekAt(event)
  }

  const moveSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPointer.current === event.pointerId) seekAt(event)
  }

  const endSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPointer.current !== event.pointerId) return
    seekAt(event)
    draggingPointer.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const startBlockDrag = (event: PointerEvent<HTMLButtonElement>, segment: Segment) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.stopPropagation()
    onSelect(segment.id)
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width || 0
    if (!width) return
    const grip = (event.target as Element).closest('.timeline-resize-grip')
    const mode = grip?.classList.contains('start') ? 'start' : grip?.classList.contains('end') ? 'end' : 'move'
    blockDrag.current = { pointerId: event.pointerId, id: segment.id, mode, startX: event.clientX, startTime: segment.startTime, endTime: segment.endTime, width, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const blockPosition = (drag: NonNullable<typeof blockDrag.current>, clientX: number) => {
    const delta = (clientX - drag.startX) / drag.width * extent
    const minimum = .1
    if (drag.mode === 'start') {
      const startTime = Math.max(0, Math.min(drag.endTime - minimum, drag.startTime + delta))
      return { id: drag.id, startTime, endTime: drag.endTime }
    }
    if (drag.mode === 'end') {
      const endTime = Math.max(drag.startTime + minimum, Math.min(extent, drag.endTime + delta))
      return { id: drag.id, startTime: drag.startTime, endTime }
    }
    const span = Math.max(0, drag.endTime - drag.startTime)
    const startTime = Math.max(0, Math.min(Math.max(0, extent - span), drag.startTime + delta))
    return { id: drag.id, startTime, endTime: startTime + span }
  }

  const moveBlock = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = blockDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 3) return
    drag.moved = true
    setDraggedSegment(blockPosition(drag, event.clientX))
  }

  const endBlockDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = blockDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      const position = blockPosition(drag, event.clientX)
      if (position.startTime !== drag.startTime || position.endTime !== drag.endTime) onMoveSegment(drag.id, position.startTime, position.endTime, drag.mode)
    }
    blockDrag.current = null
    setDraggedSegment(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className="timeline-panel" ref={panelRef} aria-label="人声波形时间轴，滚轮缩放">
    <div className="timeline-editbar"><strong>时间轴</strong>{controls}{selectedSegment && (assigned(selectedSegment)
      ? <button className="button button-secondary" onClick={() => onDeleteTiming(selectedSegment.id)}>{highlightMode === 'full' ? `从第 ${segments.indexOf(selectedSegment) + 1} 句重新打点` : `移除第 ${segments.indexOf(selectedSegment) + 1} 句时间`}</button>
      : highlightMode === 'wipe' ? <><button className="button button-primary" onClick={() => onInsertTiming(selectedSegment.id, time)}>在当前位置插入第 {segments.indexOf(selectedSegment) + 1} 句</button><button className="button button-secondary" onClick={() => onInsertTiming(selectedSegment.id, selectedSegment.startTime)}>放回原来时间</button></>
        : <>{spareTimings.length > 0 && <button className="button button-primary" onClick={() => onInsertTiming(selectedSegment.id, spareTimings[0].startTime)}>放入下一个未分配时间段</button>}<span className="timeline-pending">第 {segments.indexOf(selectedSegment) + 1} 句待打点，歌谱框已保留</span></>)}</div>
    <div className="timeline-track">
      <div className="wave-label" title={audioName || '未导入音频'}><AudioLines size={13}/><span>{audioName || '未导入音频'}</span></div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
          <div className="timeline-progress" onPointerDown={startSeek} onPointerMove={moveSeek} onPointerUp={endSeek} onPointerCancel={event => { if (draggingPointer.current === event.pointerId) draggingPointer.current = null }} onLostPointerCapture={() => { draggingPointer.current = null }}><div className="timeline-progress-fill" style={{ width: `${progress}%` }}/>{flags.map(flag => <button key={flag.id} className="flag-tick" style={{ left: `${Math.max(0, Math.min(100, flag.time / extent * 100))}%` }} title={`打点 ${clock(flag.time)}`} onClick={event => { event.stopPropagation(); onSeek(flag.time) }}/>) }<div className="timeline-progress-knob" style={{ left: `${progress}%` }}/></div>
          <div className="timeline-ruler">{ticks.map((tick, index) => <span key={index} className={index === 0 ? 'first' : index === tickCount ? 'last' : undefined} style={{ left: `${index / tickCount * 100}%` }}>{tick}</span>)}</div>
          <div className="wave-track">
            <div className="wave-stage" style={{ backgroundSize: `${100 / tickCount}% 100%` }} onPointerDown={startSeek} onPointerMove={moveSeek} onPointerUp={endSeek} onPointerCancel={event => { if (draggingPointer.current === event.pointerId) draggingPointer.current = null }} onLostPointerCapture={() => { draggingPointer.current = null }} role="slider" aria-label="音频时间轴，点击或拖动定位" aria-valuemin={0} aria-valuemax={Math.round(extent)} aria-valuenow={Math.round(time)} tabIndex={audioName ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, time - 1)) } else if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(extent, time + 1)) } }}>
              {waveform && <svg className="waveform-svg" viewBox={`0 0 ${waveform.levels.length} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={peakPath} className="waveform-peaks"/><path d={levelPath} className="waveform-levels"/></svg>}
              {spareTimings.map((slot, index) => <button key={`${slot.startTime}-${slot.endTime}-${index}`} className="timeline-spare" style={{ left: `${slot.startTime / extent * 100}%`, width: `${(slot.endTime - slot.startTime) / extent * 100}%` }} title={`未分配时间 ${formatTime(slot.startTime)} 至 ${formatTime(slot.endTime)}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSeek(slot.startTime); if (selectedSegment && !assigned(selectedSegment)) onInsertTiming(selectedSegment.id, slot.startTime) }}>空位</button>)}
              {!waveform && (loading ? <div className="vocal-progress" aria-label="人声分离进度">
                <div className="vocal-progress-heading"><span role="status">{stage}</span><span>{vocalProgress?.progress != null ? `${Math.floor(vocalProgress.progress)}%` : '准备中'}</span></div>
                <div className={`vocal-progress-bar ${vocalProgress?.progress == null ? 'indeterminate' : ''}`} role="progressbar" aria-label="人声分离" aria-valuemin={0} aria-valuemax={100} aria-valuenow={vocalProgress?.progress ?? undefined}><span style={vocalProgress?.progress != null ? { width: `${vocalProgress.progress}%` } : undefined}/></div>
                <div className="vocal-progress-detail"><span>已用 {clock(elapsed)}{vocalProgress?.completedSegments ? ` · 已完成 ${vocalProgress.completedSegments} 段` : ''}</span>{quietSeconds >= 120 && <button className="vocal-help" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setHelpOpen(true) }}>为什么还没完成？</button>}</div>
              </div> : error ? <div className="waveform-feedback" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}><div className="feedback-panel feedback-error" role="alert"><strong>人声波形暂时不可用</strong><p>可以重试读取，或继续播放音频手动打点。</p><button className="button button-secondary" onClick={() => setRetry(n => n + 1)}>重试读取波形</button><button className="button button-secondary" onClick={() => setHelpOpen(true)}>查看原因</button></div></div> : <div className="waveform-placeholder"><button className="button button-secondary" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onChooseAudio() }}>选择音频，显示人声波形</button></div>)}
              {segments.map((segment, index) => { if (!assigned(segment)) return null; const shown = previewSegments[index]; return <button key={segment.id} data-segment-id={segment.id} className={`timeline-block ${selected === segment.id ? 'current' : ''}`} style={{ left: `${Math.max(0, Math.min(100, shown.startTime / extent * 100))}%`, width: `${Math.max(0, Math.min(100, shown.endTime / extent * 100)) - Math.max(0, Math.min(100, shown.startTime / extent * 100))}%` }} title={`乐句 ${index + 1} · ${formatTime(shown.startTime)}–${formatTime(shown.endTime)}`} aria-label={`乐句 ${index + 1}，${formatTime(shown.startTime)} 至 ${formatTime(shown.endTime)}，${highlightMode === 'full' ? '按 Delete 从这句重新打点' : '按 Delete 仅移除这句时间'}`} onPointerDown={event => startBlockDrag(event, segment)} onPointerMove={moveBlock} onPointerUp={endBlockDrag} onPointerCancel={() => { blockDrag.current = null; setDraggedSegment(null) }} onLostPointerCapture={() => { blockDrag.current = null; setDraggedSegment(null) }} onClick={event => { event.stopPropagation(); onSelect(segment.id) }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onSelect(segment.id); onDeleteTiming(segment.id) }} onKeyDown={event => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDeleteTiming(segment.id) } }}><span className="timeline-resize-grip start" aria-hidden="true"/><span className="timeline-block-text">{String(index + 1).padStart(2, '0')}</span><span className="timeline-resize-grip end" aria-hidden="true"/></button> })}
              <div className="timeline-cursor" style={{ left: `${Math.max(0, Math.min(100, time / extent * 100))}%` }}/>
            </div>
          </div>
        </div>
      </div>
    </div>
    {helpOpen && <ActionDialog notice={error ? { title: '人声波形读取失败', description: '可以重试读取。波形不可用时，仍可播放音频并手动打点，不需要清空已有标注。', tone: 'error', details: error, primary: { label: '重试读取波形', onClick: () => setRetry(n => n + 1) } } : { title: '人声分离可能需要较长时间', description: '进度会在每段处理完成后更新。可以继续使用其他功能。\n如果长时间没有变化，可按 Ctrl + Shift + Esc 打开任务管理器，查看软件和 Windows 更新是否占用了较多 CPU。已有分离结果会保存，下次打开会直接读取。', tone: 'info', closeLabel: '返回继续使用' }} onClose={() => setHelpOpen(false)}/>}
  </div>
}
