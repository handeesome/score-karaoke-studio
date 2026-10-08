import { useState } from 'react'
import { X } from 'lucide-react'
import type { AutoBoxCandidate, ScorePage } from '../types'

interface Props {
  pages: ScorePage[]
  candidates: AutoBoxCandidate[]
  existingCount: number
  onClose: () => void
  onApply: (indices: number[], replace: boolean) => void
}

export default function AutoBoxDialog({ pages, candidates, existingCount, onClose, onApply }: Props) {
  const [chosen, setChosen] = useState(() => new Set(candidates.map((_, index) => index)))
  const [pageId, setPageId] = useState(pages[0]?.id || '')
  const [replace, setReplace] = useState(false)
  const page = pages.find(item => item.id === pageId) || pages[0]
  const pageNumber = pages.findIndex(item => item.id === pageId) + 1
  const toggle = (index: number) => setChosen(current => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="auto-box-dialog" role="dialog" aria-modal="true" aria-label="自动框选预览">
      <header className="auto-box-header"><div><h2>自动框选预览</h2><p>按歌词行定位，只在明显大于字距的留白处分开。请检查虚线框，应用后仍可拖动修改。</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18}/></button></header>
      <div className="auto-box-body">
        <div className="auto-box-preview">{page && <div className="auto-box-page" style={{ aspectRatio: `${page.width} / ${page.height}` }}><img src={page.image} alt={`第 ${pageNumber} 页乐谱`}/><svg viewBox="0 0 1000 1414" preserveAspectRatio="none" aria-hidden="true">{candidates.map((item, index) => item.pageId === page.id && chosen.has(index) ? <rect key={index} x={item.region.x * 1000} y={item.region.y * 1414} width={item.region.width * 1000} height={item.region.height * 1414} /> : null)}</svg></div>}</div>
        <div className="auto-box-list-panel"><strong>候选标注 {chosen.size} / {candidates.length}</strong><div className="auto-box-page-tabs">{pages.map((item, index) => <button key={item.id} className={pageId === item.id ? 'active' : ''} onClick={() => setPageId(item.id)}>第 {index + 1} 页</button>)}</div><div className="auto-box-list">{candidates.map((item, index) => item.pageId === page?.id ? <label key={index}><input type="checkbox" checked={chosen.has(index)} onChange={() => toggle(index)}/><span><b>{String(index + 1).padStart(2, '0')}</b> 第 {item.row} 行{item.part > 1 ? ` · 第 ${item.part} 段` : ''}<small title={item.sourceText}>{item.sourceText}</small></span></label> : null)}</div></div>
      </div>
      <footer className="auto-box-footer"><label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/>替换现有 {existingCount} 条标注</label><span>{replace ? '旧标注和打点将被替换，可用 Ctrl+Z 撤销' : '保留现有标注，只补充未覆盖的区域'}</span><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={!chosen.size} onClick={() => onApply([...chosen].sort((a, b) => a - b), replace)}>应用 {chosen.size} 条</button></footer>
    </div>
  </div>
}
