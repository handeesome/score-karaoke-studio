import { useState } from 'react'
import { AudioLines, Check, Pause, Play, WandSparkles, X } from 'lucide-react'
import type { AutoCandidate } from '../types'
import { formatTime } from '../utils'
import ActionDialog, { type ActionNotice } from './ActionDialog'

interface Props {
  candidates: AutoCandidate[]
  existingCount: number
  playing: boolean
  onClose: () => void
  onListen: (time: number) => void
  onPause: () => void
  onApply: (indices: number[]) => void
  onManual: () => void
}

export default function AutoAlignDialog({ candidates, existingCount, playing, onClose, onListen, onPause, onApply, onManual }: Props) {
  const [chosen, setChosen] = useState(() => new Set(candidates.map((_, index) => index)))
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const apply = () => {
    if (!chosen.size) { setNotice({ title: '还没有选中要应用的乐句', description: '请勾选要使用的乐句，或点击“全选乐句”。', primary: { label: '全选乐句', onClick: () => setChosen(new Set(candidates.map((_, i) => i))) } }); return }
    onApply([...chosen].sort((a, b) => a - b))
  }
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
      <div className={`auto-dialog-summary ${lowCount ? 'needs-review' : ''}`}><span>找到 <strong>{candidates.length}</strong> 条乐句</span><span>{lowCount ? `${lowCount} 条时间不确定，建议先试听` : candidates.length ? '建议试听后应用' : '没有找到可用的时间'}</span>{lowCount > 0 && <button onClick={() => { document.querySelector('.auto-candidate[data-review="true"]')?.scrollIntoView({ block: 'center' }); onListen(candidates.find(c => c.confidence < .35)!.startTime) }}>试听第一条待核对乐句</button>}<button onClick={() => setChosen(new Set(candidates.map((_, index) => index)))}>全选</button><button onClick={() => setChosen(new Set())}>全不选</button></div>
      {!candidates.length && <div className="feedback-empty"><strong>这次没有得到可用的对齐结果</strong><p>可以保留现有歌词框，播放音频并手动记录时间。</p><button className="button button-primary" onClick={onManual}>返回手动打点</button></div>}
      <div className="auto-dialog-list">
        {candidates.map((candidate, index) => <div data-review={candidate.confidence < .35} className={`auto-candidate ${chosen.has(index) ? '' : 'skipped'}`} key={`${candidate.pageId}-${index}`}>
          <label className="auto-candidate-check"><input type="checkbox" checked={chosen.has(index)} onChange={() => toggle(index)}/><span>{String(index + 1).padStart(2, '0')}</span></label>
          <div className="auto-candidate-main"><strong title={candidate.text}>{candidate.text || '歌词未识别'}</strong><small>{candidate.matchedText ? `听到：${candidate.matchedText}` : '没有可信的文字匹配，按相邻乐句推算'}</small></div>
          <div className="auto-candidate-time"><strong>{formatTime(candidate.startTime)} — {formatTime(candidate.endTime)}</strong><span className={candidate.confidence < .35 ? 'auto-low' : candidate.confidence < .6 ? 'auto-mid' : 'auto-high'}>{candidate.source} · {candidate.confidence < .35 ? '待核对' : candidate.confidence < .6 ? '一般' : '较可靠'}</span></div>
          <button className="auto-listen" aria-label={`试听第 ${index + 1} 句`} onClick={() => onListen(candidate.startTime)}><Play size={16}/>试听</button>
        </div>)}
      </div>
      <footer className="auto-dialog-footer"><div className="feedback-inline"><AudioLines size={15}/><span>只给未打点的乐句填时间，保留已有打点和框。{existingCount ? '已打点的候选可用来对照。' : ''}</span></div><button className="button button-secondary" onClick={onClose}>暂不应用</button>{candidates.length > 0 && <button className="button button-primary" onClick={apply}><Check size={15}/>应用 {chosen.size} 条候选</button>}</footer>
      {notice && <ActionDialog notice={notice} onClose={() => setNotice(null)}/>}
    </div>
  </div>
}
