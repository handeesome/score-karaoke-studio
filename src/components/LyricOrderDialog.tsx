import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PagePartition, Project, ScorePage } from '../types'
import { automaticLyricRows, partitionLyricRows, syncPartition, withLyricOrder } from '../partitions'

export default function LyricOrderDialog({ project, partition, page, onClose, onApply }: {
  project: Project; partition: PagePartition; page: ScorePage
  onClose: () => void; onApply: (partition: PagePartition) => void
}) {
  const initialCount = Math.max(1, Math.min(8, Math.round(partition.lyricOrder?.verseCount || 3)))
  const [count, setCount] = useState(initialCount)
  const physicalRows = useMemo(() => partitionLyricRows(partition), [partition])
  const [rows, setRows] = useState<Record<string, number>>(() => {
    const automatic = automaticLyricRows(partition, initialCount)
    for (const row of physicalRows) if (automatic[row.key] !== 0) {
      const saved = partition.lyricOrder?.rows[row.key]
      if (saved && saved <= initialCount) automatic[row.key] = saved
    }
    return automatic
  })
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const nextPartition = useMemo(() => withLyricOrder(partition, count, rows), [partition, count, rows])
  const preview = useMemo(() => syncPartition(project, nextPartition, true), [project, nextPartition])
  const pageSegments = preview.segments.filter(segment => segment.pageId === page.id && segment.partitionKey)
  const selectedCount = pageSegments.length
  const skippedTimed = project.segments.some(segment => segment.pageId === page.id && segment.partitionKey &&
    !preview.segments.some(next => next.id === segment.id) && (segment.timingSet || project.flags?.some(flag => flag.segmentId === segment.id)))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLSelectElement>('select')?.focus(), 0)
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('.action-dialog')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') || [])]
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus() }
  }, [])

  const distribute = (value: number) => { setCount(value); setRows(automaticLyricRows(partition, value, rows)) }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="lyric-order-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="lyric-order-title">
      <header className="lyric-order-header"><h2 id="lyric-order-title">自动编号</h2><button className="icon-button" aria-label="关闭编号预览" onClick={onClose}><X size={24}/></button></header>
      <div className="lyric-order-controls"><label htmlFor="lyric-verse-count">每行谱有几段歌词</label><select id="lyric-verse-count" value={count} onChange={event => distribute(Number(event.target.value))}>
        <option value="1">按位置编号</option>{[2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value} 段</option>)}</select>
        <button className="button button-secondary" onClick={() => distribute(count)}>自动分配</button></div>
      <p className="lyric-order-help">先排完第 1 段，再排第 2、3 段；每行从左到右。根据歌词行高度自动跳过较高的谱行，可在下方调整。</p>
      <div className="lyric-order-body"><div className="lyric-order-rows">
        {physicalRows.map((row, index) => <label className="lyric-order-row" key={row.key}>
          <span>第 {index + 1} 行</span>
          <svg className="lyric-row-crop" viewBox={`${row.region.x * page.width} ${row.region.y * page.height} ${row.region.width * page.width} ${row.region.height * page.height}`} role="img" aria-label={`第 ${index + 1} 行歌谱`}>
            <image style={{ filter: page.inverted ? 'invert(1)' : undefined }} href={page.image} width={page.width} height={page.height}/></svg>
          <select aria-label={`第 ${index + 1} 行歌词段落`} value={rows[row.key] ?? 0} onChange={event => setRows(current => ({ ...current, [row.key]: Number(event.target.value) }))}>
            <option value="0">跳过此行</option>{Array.from({ length: count }, (_, verse) => <option key={verse} value={verse + 1}>{count === 1 ? '按位置' : `第 ${verse + 1} 段`}</option>)}</select>
        </label>)}
      </div><div className="lyric-order-preview"><svg viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label="分段编号预览">
        <image style={{ filter: page.inverted ? 'invert(1)' : undefined }} href={page.image} width={page.width} height={page.height}/>
        {pageSegments.map(segment => { const r = segment.region; const n = preview.segments.indexOf(segment) + 1
          return <g key={segment.id} data-preview-number={n}><rect className="lyric-preview-region" x={r.x * page.width} y={r.y * page.height} width={r.width * page.width} height={r.height * page.height}/>
            <rect className="lyric-preview-badge" x={r.x * page.width} y={Math.max(0, r.y * page.height - 30)} width={54} height={30}/>
            <text className="lyric-preview-number" x={r.x * page.width + 27} y={Math.max(0, r.y * page.height - 30) + 23} textAnchor="middle">{n}</text></g>
        })}</svg></div></div>
      <footer className="lyric-order-footer"><div role="status" aria-live="polite">{skippedTimed ? '有已打点的行被设为跳过，请先保留这些行。' : `共 ${selectedCount} 个歌词框；已有打点按原时间顺序对应新编号，可撤销。`}</div>
        <button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={!selectedCount || skippedTimed} onClick={() => onApply(nextPartition)}>应用编号</button></footer>
    </div>
  </div>
}
