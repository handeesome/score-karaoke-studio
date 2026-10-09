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
  const [waveMode, setWaveMode] = useState<'vocals' | 'mix'>('vocals')
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setWaveform(null)
    setError(null)
    if (!audioUrl) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setStage(waveMode === 'vocals' ? '正在准备人声波形…' : '正在生成原音频波形…')
    const load = async () => {
      const response = await fetch(waveMode === 'vocals' ? '/api/waveform/vocals' : '/api/waveform', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioUrl }), signal: controller.signal,
      })
      let result = await response.json()
      if (!response.ok) throw new Error(result.detail || '无法读取音频波形')
      if (waveMode === 'vocals') {
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
      }
      const data = result as WaveformData
      if (!data?.levels?.length || data.peaks?.length !== data.levels.length) throw new Error('波形数据无效')
      if (!controller.signal.aborted) setWaveform(data)
    }
    void load().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '波形读取失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [audioUrl, waveMode])

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
      <div><span className="eyebrow">时间轴</span><strong>{waveMode === 'vocals' ? '人声波形' : '原音频波形'}</strong><span className="waveform-caveat">{waveMode === 'vocals' ? '提取后显示歌声起落 · 点击跳转' : '含伴奏 · 点击跳转'}</span></div>
      <div className="timeline-tools">
        <button className="button button-quiet compact" disabled={!audioUrl} onClick={() => setWaveMode(mode => mode === 'vocals' ? 'mix' : 'vocals')}>{waveMode === 'vocals' ? '查看原音频' : '提取人声'}</button>
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
          {!waveform && <div className="waveform-placeholder">{loading ? stage : error || '导入 MP3 后显示人声波形'}</div>}
          {segments.map((segment, index) => <button key={segment.id} className={`timeline-block ${selected === segment.id ? 'current' : ''}`} style={{ left: `${Math.max(0, Math.min(100, segment.startTime / extent * 100))}%`, width: `${Math.max(0, Math.min(100, segment.endTime / extent * 100) - Math.max(0, segment.startTime / extent * 100))}%` }} title={`乐句 ${index + 1} · ${clock(segment.startTime)}–${clock(segment.endTime)}`} onClick={event => { event.stopPropagation(); onSelect(segment.id) }}>乐句 {String(index + 1).padStart(2, '0')}</button>)}
          <div className="timeline-cursor" style={{ left: `${Math.max(0, Math.min(100, time / extent * 100))}%` }}/>
        </div>
      </div>
    </div>
  </div>
}
