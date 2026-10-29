import { ChevronRight, X } from 'lucide-react'
import type { Project, Segment } from '../types'
import { formatTime, segmentRegions } from '../utils'

export default function InspectorPanel({ project, selected, selectedCount, timed, full, currentTime, orderDraft, mergeTarget,
  onClose, onOrderDraft, onMoveOrder, onMergeTarget, onMerge, onTime, onSeek, onReverse, onRepeat, onDelete,
}: {
  project: Project; selected: string | null; selectedCount: number; timed: Set<string>; full: boolean; currentTime: number
  orderDraft: string | null; mergeTarget: string | null
  onClose: () => void; onOrderDraft: (value: string | null) => void; onMoveOrder: (id: string, value: string) => void
  onMergeTarget: (id: string) => void; onMerge: (ids: string[]) => void
  onTime: (segment: Segment, field: 'startTime' | 'endTime', value: number) => boolean
  onSeek: (time: number) => void; onReverse: (id: string) => void; onRepeat: () => void; onDelete: (id: string) => void
}) {
  const segment = project.segments.find(s => s.id === selected)
  const index = segment ? project.segments.indexOf(segment) : -1
  // The next phrase is the default merge target. Only the last phrase falls back to the previous one.
  const neighbours = [project.segments[index + 1], index > 0 ? project.segments[index - 1] : undefined].filter((s): s is Segment => Boolean(s))
  const target = neighbours.find(s => s.id === mergeTarget)?.id || neighbours[0]?.id || ''
  const assigned = segment && (segment.timingSet || timed.has(segment.id))
  return <aside className="right-panel" aria-label="乐句设置">
    <div className="right-panel-title"><h2>乐句设置</h2><button className="icon-button" aria-label="收起乐句设置" onClick={onClose}><X size={22}/></button></div>
    {segment ? <div className="inspector-card">
      <div className="inspector-selection-heading"><strong>乐句 {String(index + 1).padStart(2, '0')}</strong><span className={assigned ? 'assignment-ready' : 'assignment-pending'}>{assigned ? '已放入时间轴' : '待打点'}</span></div>
      {(['startTime', 'endTime'] as const).map(field => <div className="inspector-time" key={field}>
        <div><span>{field === 'startTime' ? '开始时间' : '结束时间'}</span><output aria-label={field === 'startTime' ? '开始时间' : '结束时间'}>{formatTime(segment[field])}</output></div>
        <div className="inspector-time-actions"><button className="button button-secondary" onClick={() => onSeek(segment[field])}>定位到这里</button><button className="button button-secondary" onClick={() => onTime(segment, field, currentTime)}>设为当前</button></div>
      </div>)}
      {!full && neighbours.length > 0 && <div className="inspector-merge"><label className="field-label" htmlFor="merge-target">与哪句合并</label><select id="merge-target" value={target} onChange={e => onMergeTarget(e.target.value)}>{neighbours.map(s => <option value={s.id} key={s.id}>乐句 {String(project.segments.indexOf(s) + 1).padStart(2, '0')}（{project.segments.indexOf(s) > index ? '下一句' : '上一句'}）</option>)}</select><button className="button button-primary" onClick={() => onMerge([segment.id, target])}>合并这两句<ChevronRight size={20}/></button></div>}
      <details className="inspector-more"><summary>更多乐句操作</summary>
        <div className="inspector-order"><label className="field-label" htmlFor="phrase-order">乐句序号</label><div><input id="phrase-order" type="text" inputMode="numeric" value={orderDraft ?? String(index + 1)} onChange={e => onOrderDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onMoveOrder(segment.id, e.currentTarget.value) } else if (e.key === 'Escape') onOrderDraft(null) }}/><button className="button button-secondary" disabled={orderDraft === null || orderDraft === String(index + 1)} onClick={() => onMoveOrder(segment.id, orderDraft || '')}>移动到此</button></div></div>
        {segmentRegions(segment).length > 1 && <button className="button button-secondary" onClick={() => onReverse(segment.id)}>反转框顺序</button>}
        {!full && <button className="button button-secondary" onClick={onRepeat}>重复使用选中框{selectedCount > 1 ? `（${selectedCount}）` : ''}</button>}
        <button className="button button-danger-quiet" onClick={() => onDelete(segment.id)}>{segment.partitionKey ? '跳过此区' : '删除歌谱上的框'}</button>
      </details>
    </div> : <div className="inspector-empty"><strong>未选中乐句</strong></div>}
  </aside>
}
