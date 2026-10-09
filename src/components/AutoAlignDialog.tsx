import { useState } from 'react'
import { AudioLines, Check, Pause, Play, WandSparkles, X } from 'lucide-react'
import type { AutoCandidate } from '../types'
import { formatTime } from '../utils'

interface Props {
  candidates: AutoCandidate[]
  existingCount: number
  playing: boolean
  onClose: () => void
  onListen: (time: number) => void
  onPause: () => void
  onApply: (indices: number[]) => void
}

export default function AutoAlignDialog({ candidates, existingCount, playing, onClose, onListen, onPause, onApply }: Props) {
  const [chosen, setChosen] = useState(() => new Set(candidates.map((_, index) => index)))
  const toggle = (index: number) => setChosen(previous => {
    const next = new Set(previous)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })
  const lowCount = candidates.filter(item => item.confidence < .35).length
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="auto-dialog" role="dialog" aria-modal="true" aria-labelledby="auto-title">
      <header className="auto-dialog-header"><div className="auto-dialog-icon"><WandSparkles size={18}/></div><div><h2 id="auto-title">自动对齐候选</h2><p>按谱面框的顺序，结合唱词与人声波形推算；请试听后应用。</p></div>{playing && <button className="button button-secondary compact" onClick={onPause}><Pause size={13}/>暂停试听</button>}<button className="icon-button" aria-label="关闭" onClick={onClose}><X size={17}/></button></header>
      <div className="auto-dialog-summary"><span>找到 <strong>{candidates.length}</strong> 条乐句</span><span>{lowCount ? `${lowCount} 条需要重点核对` : '所有乐句都有文字匹配'}</span><button onClick={() => setChosen(new Set(candidates.map((_, index) => index)))}>全选</button><button onClick={() => setChosen(new Set())}>全不选</button></div>
      <div className="auto-dialog-list">
        {candidates.map((candidate, index) => <div className={`auto-candidate ${chosen.has(index) ? '' : 'skipped'}`} key={`${candidate.pageId}-${index}`}>
          <label className="auto-candidate-check"><input type="checkbox" checked={chosen.has(index)} onChange={() => toggle(index)}/><span>{String(index + 1).padStart(2, '0')}</span></label>
          <div className="auto-candidate-main"><strong title={candidate.text}>{candidate.text || '歌词未识别'}</strong><small>{candidate.matchedText ? `听到：${candidate.matchedText}` : '没有可信的文字匹配，按相邻乐句推算'}</small></div>
          <div className="auto-candidate-time"><strong>{formatTime(candidate.startTime)} — {formatTime(candidate.endTime)}</strong><span className={candidate.confidence < .35 ? 'auto-low' : candidate.confidence < .6 ? 'auto-mid' : 'auto-high'}>{candidate.source} · {candidate.confidence < .35 ? '待核对' : candidate.confidence < .6 ? '一般' : '较可靠'}</span></div>
          <button className="auto-listen" title="从这句开始试听" onClick={() => onListen(candidate.startTime)}><Play size={13}/></button>
        </div>)}
      </div>
      <footer className="auto-dialog-footer"><div><AudioLines size={15}/><span>已有打点和框的位置会保留；只给未打点的乐句填时间。{existingCount ? '已打点的候选可用来对照。' : ''}</span></div><button className="button button-secondary" onClick={onClose}>暂不应用</button><button className="button button-primary" disabled={!chosen.size} onClick={() => onApply([...chosen].sort((a, b) => a - b))}><Check size={15}/>应用 {chosen.size} 条候选</button></footer>
    </div>
  </div>
}
