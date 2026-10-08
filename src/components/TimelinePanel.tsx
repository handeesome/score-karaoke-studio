import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { AudioLines, MoreHorizontal, Scissors } from 'lucide-react'
import type { Segment } from '../types'

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
  segments: Segment[]
  selected: string | null
  time: number
  onSelect: (id: string) => void
  onSeek: (time: number) => void
  onDuplicate: () => void
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

export default function TimelinePanel({ audioUrl, audioName, duration, segments, selected, time, onSelect, onSeek, onDuplicate }: TimelinePanelProps) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    setWaveform(null)
    setError(false)
    if (!audioUrl) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    fetch('/api/waveform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl }),
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('无法读取音频波形')
      return response.json() as Promise<WaveformData>
    }).then(data => {
      if (data.levels.length && data.peaks.length === data.levels.length) setWaveform(data)
      else setError(true)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [audioUrl])

  const extent = duration > 0 ? duration : waveform?.duration || 90
  const peakPath = useMemo(() => envelopePath(waveform?.peaks || []), [waveform])
  const levelPath = useMemo(() => envelopePath(waveform?.levels || []), [waveform])
  const ticks = Array.from({ length: 6 }, (_, index) => clock(extent * index / 5))

  const seekAt = (event: MouseEvent<HTMLDivElement>) => {
    if (!audioName) return
    const rect = event.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(extent, (event.clientX - rect.left) / rect.width * extent)))
  }

  return <div className="timeline-panel">
    <div className="timeline-heading">
      <div><span className="eyebrow">时间轴</span><strong>真实音频波形</strong><span className="waveform-caveat" title="波形来自整首音频，伴奏也会产生波形；乐句块用于参考人声位置。">含伴奏 · 点击跳转</span></div>
      <div className="timeline-tools">
        <button className="button button-quiet compact" onClick={onDuplicate}><Scissors size={14}/>复制到下一行</button>
        <button className="icon-button tiny" aria-label="更多时间轴操作"><MoreHorizontal size={16}/></button>
      </div>
    </div>
    <div className="timeline-track">
      <div className="timeline-ruler">{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div>
      <div className="wave-track">
        <div className="wave-label" title={audioName || '未导入音频'}><AudioLines size={13}/><span>{audioName || '未导入音频'}</span></div>
        <div className="wave-stage" onClick={seekAt} role="slider" aria-label="音频时间轴，点击跳转" aria-valuemin={0} aria-valuemax={Math.round(extent)} aria-valuenow={Math.round(time)} tabIndex={audioName ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, time - 1)) } else if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(extent, time + 1)) } }}>
          {waveform && <svg className="waveform-svg" viewBox={`0 0 ${waveform.levels.length} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={peakPath} className="waveform-peaks"/><path d={levelPath} className="waveform-levels"/></svg>}
          {!waveform && <div className="waveform-placeholder">{loading ? '正在生成音频波形…' : error ? '波形读取失败，请重新导入音频' : '导入 MP3 后显示真实波形'}</div>}
          {segments.map((segment, index) => <button key={segment.id} className={`timeline-block ${selected === segment.id ? 'current' : ''}`} style={{ left: `${Math.max(0, Math.min(100, segment.startTime / extent * 100))}%`, width: `${Math.max(0, Math.min(100, segment.endTime / extent * 100) - Math.max(0, segment.startTime / extent * 100))}%` }} title={`乐句 ${index + 1} · ${clock(segment.startTime)}–${clock(segment.endTime)}`} onClick={event => { event.stopPropagation(); onSelect(segment.id) }}>乐句 {String(index + 1).padStart(2, '0')}</button>)}
          <div className="timeline-cursor" style={{ left: `${Math.max(0, Math.min(100, time / extent * 100))}%` }}/>
        </div>
      </div>
    </div>
  </div>
}
