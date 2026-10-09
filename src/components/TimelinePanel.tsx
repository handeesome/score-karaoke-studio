import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { AudioLines } from 'lucide-react'
import type { KaraokeFlag, Segment } from '../types'

interface WaveformData {
  duration: number
  levels: number[]
  peaks: number[]
  kind: string
}

interface TimelinePanelProps {
  audioUrl?: string | null
  audioName?: string | null
  duration: number
  flags: KaraokeFlag[]
  segments: Segment[]
  selected: string | null
  time: number
  playing: boolean
  onSelect: (id: string) => void
  onSeek: (time: number) => void
  onMoveSegment: (id: string, startTime: number, endTime: number) => void
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

export default function TimelinePanel({ audioUrl, audioName, duration, flags, segments, selected, time, playing, onSelect, onSeek, onMoveSegment }: TimelinePanelProps) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [draggedSegment, setDraggedSegment] = useState<{ id: string; startTime: number; endTime: number } | null>(null)
  const draggingPointer = useRef<number | null>(null)
  const blockDrag = useRef<{ pointerId: number; id: string; startX: number; startTime: number; endTime: number; width: number; moved: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ fraction: number; offset: number } | null>(null)

  useEffect(() => {
    setWaveform(null)
    setError(null)
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
        setStage(result.stage || '正在提取人声…')
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
  }, [audioUrl])

  const extent = duration > 0 ? duration : waveform?.duration || 90
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
    blockDrag.current = { pointerId: event.pointerId, id: segment.id, startX: event.clientX, startTime: segment.startTime, endTime: segment.endTime, width, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const blockPosition = (drag: NonNullable<typeof blockDrag.current>, clientX: number) => {
    const span = Math.max(0, drag.endTime - drag.startTime)
    const startTime = Math.max(0, Math.min(Math.max(0, extent - span), drag.startTime + (clientX - drag.startX) / drag.width * extent))
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
      if (position.startTime !== drag.startTime) onMoveSegment(drag.id, position.startTime, position.endTime)
    }
    blockDrag.current = null
    setDraggedSegment(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className="timeline-panel" ref={panelRef} aria-label="人声波形时间轴，滚轮缩放">
    <div className="timeline-track">
      <div className="wave-label" title={audioName || '未导入音频'}><AudioLines size={13}/><span>{audioName || '未导入音频'}</span></div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
          <div className="timeline-progress" onPointerDown={startSeek} onPointerMove={moveSeek} onPointerUp={endSeek} onPointerCancel={event => { if (draggingPointer.current === event.pointerId) draggingPointer.current = null }} onLostPointerCapture={() => { draggingPointer.current = null }}><div className="timeline-progress-fill" style={{ width: `${progress}%` }}/>{flags.map(flag => <button key={flag.id} className="flag-tick" style={{ left: `${Math.max(0, Math.min(100, flag.time / extent * 100))}%` }} title={`打点 ${clock(flag.time)}`} onClick={event => { event.stopPropagation(); onSeek(flag.time) }}/>) }<div className="timeline-progress-knob" style={{ left: `${progress}%` }}/></div>
          <div className="timeline-ruler">{ticks.map((tick, index) => <span key={index} className={index === 0 ? 'first' : index === tickCount ? 'last' : undefined} style={{ left: `${index / tickCount * 100}%` }}>{tick}</span>)}</div>
          <div className="wave-track">
            <div className="wave-stage" style={{ backgroundSize: `${100 / tickCount}% 100%` }} onPointerDown={startSeek} onPointerMove={moveSeek} onPointerUp={endSeek} onPointerCancel={event => { if (draggingPointer.current === event.pointerId) draggingPointer.current = null }} onLostPointerCapture={() => { draggingPointer.current = null }} role="slider" aria-label="音频时间轴，点击或拖动定位" aria-valuemin={0} aria-valuemax={Math.round(extent)} aria-valuenow={Math.round(time)} tabIndex={audioName ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, time - 1)) } else if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(extent, time + 1)) } }}>
              {waveform && <svg className="waveform-svg" viewBox={`0 0 ${waveform.levels.length} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={peakPath} className="waveform-peaks"/><path d={levelPath} className="waveform-levels"/></svg>}
              {!waveform && <div className="waveform-placeholder">{loading ? stage : error || '导入 MP3 后显示人声波形'}</div>}
              {segments.map((segment, index) => { const shown = draggedSegment?.id === segment.id ? draggedSegment : segment; return <button key={segment.id} className={`timeline-block ${selected === segment.id ? 'current' : ''}`} style={{ left: `${Math.max(0, Math.min(100, shown.startTime / extent * 100))}%`, width: `${Math.max(0, Math.min(100, shown.endTime / extent * 100) - Math.max(0, shown.startTime / extent * 100))}%` }} title={`乐句 ${index + 1} · ${clock(shown.startTime)}–${clock(shown.endTime)}`} onPointerDown={event => startBlockDrag(event, segment)} onPointerMove={moveBlock} onPointerUp={endBlockDrag} onPointerCancel={() => { blockDrag.current = null; setDraggedSegment(null) }} onLostPointerCapture={() => { blockDrag.current = null; setDraggedSegment(null) }} onClick={event => { event.stopPropagation(); onSelect(segment.id) }}>乐句 {String(index + 1).padStart(2, '0')}</button> })}
              <div className="timeline-cursor" style={{ left: `${Math.max(0, Math.min(100, time / extent * 100))}%` }}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
}
