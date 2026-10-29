import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Contrast, FileAudio2, FileImage, FileVideo2, Flag, ImagePlus, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Pointer, Redo2, RotateCcw, Scissors, Settings2, Sparkles, Undo2, Upload, WandSparkles, X } from 'lucide-react'
import type { AutoBoxCandidate, AutoCandidate, ExportSettings, KaraokeFlag, Project, Region, ScorePage, Segment } from './types'
import ExportDialog from './components/ExportDialog'
import HighlightColorDialog from './components/HighlightColorDialog'
import AutoAlignDialog from './components/AutoAlignDialog'
import TimelinePanel from './components/TimelinePanel'
import TimelineDivider from './components/TimelineDivider'
import LyricOrderDialog from './components/LyricOrderDialog'
import AutoBoxDialog from './components/AutoBoxDialog'
import ProgressDialog from './components/ProgressDialog'
import HomeImportView from './components/HomeImportView'
import FileDropZone from './components/FileDropZone'
import { emptyProject, removeScorePages } from './projectActions'
import DesktopUpdate from './components/DesktopUpdate'
import PartitionEditor from './components/PartitionEditor'
import ActionDialog, { type ActionNotice, type DialogAction } from './components/ActionDialog'
import DisplaySize, { type TextSize } from './components/DisplaySize'
import InspectorPanel from './components/InspectorPanel'
import ToolMenu from './components/ToolMenu'
import { connectFullTiming, editTiming, insertTiming, rebindAfterMerge, refreshTimingFlags, removeTiming, timedSegmentIds, type TimingEdge } from './timing'
import { emptyPartition, initializePartitionNumbers, numberPartitionCell, partitionLyricRows, removeGuide, resetPartitionNumbers, restoreNumberingSlots, syncPartition, type PartitionTool } from './partitions'
import type { PagePartition } from './types'
import { initialProject } from './types'
import { copyRegionToNextLine, loadInkPage } from './scoreInk'
import { bindTimingToScoreOrder, calculateCameraTarget, calculateKaraokeProgress, fitRegion, formatTime, migrateLegacyCuts, recoverFlagsFromTiming, regionPositionKey, regionReveal, segmentRegions, sharedRegionKey } from './utils'

const API = ''
function savedDisplay() {
  try {
    const saved = JSON.parse(localStorage.getItem('pujian-display') || '{}')
    return { textSize: saved?.textSize, inspectorOpen: typeof saved?.inspectorOpen === 'boolean' ? saved.inspectorOpen : undefined,
      timelineHeight: typeof saved?.timelineHeight === 'number' && Number.isFinite(saved.timelineHeight) ? Math.max(110, Math.min(800, saved.timelineHeight)) : undefined }
  } catch { return {} }
}
function App() {
  const [textSize, setTextSize] = useState<TextSize>(() => savedDisplay().textSize === 'extra' ? 'extra' : 'large')
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => savedDisplay().inspectorOpen ?? window.innerWidth >= 1280)
  const [timelineHeight, setTimelineHeight] = useState<number>(() => savedDisplay().timelineHeight ?? 160)
  const [pointFeedback, setPointFeedback] = useState<{ text: string; warning?: boolean } | null>(null)
  useEffect(() => {
    if (!pointFeedback) return
    const timer = window.setTimeout(() => setPointFeedback(null), 4500)
    return () => window.clearTimeout(timer)
  }, [pointFeedback])
  const [project, setProjectState] = useState<Project>(() => {
    try {
      const loaded = initializePartitionNumbers(recoverFlagsFromTiming(migrateLegacyCuts({ ...initialProject, ...JSON.parse(localStorage.getItem('pujian-project') || '{}') })))
      return connectFullTiming(loaded.scoreTimingBound ? loaded : bindTimingToScoreOrder(loaded))
    } catch { return initialProject }
  })
  const [activePage, setActivePage] = useState(0)
  useEffect(() => { setActivePage(index => Math.max(0, Math.min(index, project.pages.length - 1))) }, [project.pages.length])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [orderDraft, setOrderDraft] = useState<string | null>(null)
  const [editingNumber, setEditingNumber] = useState<{ id: string; part: number; value: string } | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState<{ text: string; action?: DialogAction } | null>(null)
  const messageTimer = useRef<number>()
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const [saveIssue, setSaveIssue] = useState<'local' | 'project' | null>(null)
  const localSaveFailed = useRef(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(initialProject.export!)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const previewTimeRef = useRef(0)
  previewTimeRef.current = previewTime
  const [colorOpen, setColorOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const [previewRetry, setPreviewRetry] = useState(0)
  const [exportJob, setExportJob] = useState<{ jobId: string; status: string; progress: number; warnings?: string[]; downloadUrl?: string | null; outputPath?: string; error?: string } | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const exportInput = useMemo(() => JSON.stringify({ ...project, export: exportSettings }), [project, exportSettings])
  const exportedInput = useRef<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [lyricOrderOpen, setLyricOrderOpen] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoStage, setAutoStage] = useState('')
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[] | null>(null)
  const [boxCandidates, setBoxCandidates] = useState<AutoBoxCandidate[] | null>(null)
  const [boxBusy, setBoxBusy] = useState(false)
  const [scoreImporting, setScoreImporting] = useState(false)
  const [audioImporting, setAudioImporting] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<{ kind: 'boxes' | 'align'; percent: number; stage: string } | null>(null)
  const [tool, setTool] = useState<'select' | 'row' | 'cut' | PartitionTool>('select')
  const [selectedLine, setSelectedLine] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const scoreInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const moreScoreInput = useRef<HTMLInputElement>(null)
  const importLock = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const scoreZoomAnchor = useRef<{ page: HTMLElement; x: number; y: number; fractionX: number; fractionY: number } | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const numberInputRef = useRef<HTMLInputElement>(null)
  const cancelNumberEdit = useRef(false)
  const replaceNumberOnKey = useRef(false)
  const dragRef = useRef<{ id: string; part: number; kind: 'move' | 'resize'; edge?: string; startX: number; startY: number; region: Region; historySaved?: boolean } | null>(null)
  const draftRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeRef = useRef<{ x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<Region | null>(null)
  const [draft, setDraft] = useState<Region | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const projectRef = useRef(project)
  const undoHistory = useRef<Project[]>([])
  const redoHistory = useRef<Project[]>([])
  const lastHistoryAt = useRef(0)
  const setProject: Dispatch<SetStateAction<Project>> = (action) => {
    const before = projectRef.current
    const next = typeof action === 'function' ? action(before) : action
    if (next === before) return
    const now = Date.now()
    if (dragRef.current && !dragRef.current.historySaved) {
      undoHistory.current.push(before)
      dragRef.current.historySaved = true
    } else if (!dragRef.current && (now - lastHistoryAt.current > 350 || !undoHistory.current.length)) {
      undoHistory.current.push(before)
      if (undoHistory.current.length > 100) undoHistory.current.shift()
    }
    redoHistory.current = []
    lastHistoryAt.current = now
    projectRef.current = next
    setProjectState(next)
  }
  const undoProject = () => {
    const previous = undoHistory.current.pop()
    if (!previous) return
    redoHistory.current.push(projectRef.current)
    projectRef.current = previous
    lastHistoryAt.current = 0
    setProjectState(previous)
    setPointFeedback(null)
  }
  const redoProject = () => {
    const next = redoHistory.current.pop()
    if (!next) return
    undoHistory.current.push(projectRef.current)
    projectRef.current = next
    lastHistoryAt.current = 0
    setProjectState(next)
    setPointFeedback(null)
  }

  useLayoutEffect(() => { document.documentElement.dataset.textSize = textSize }, [textSize])
  useEffect(() => {
    try { localStorage.setItem('pujian-display', JSON.stringify({ textSize, inspectorOpen, timelineHeight })) } catch { /* Display choices do not affect project saving. */ }
  }, [textSize, inspectorOpen, timelineHeight])
  useEffect(() => {
    try { localStorage.setItem('pujian-project', JSON.stringify(project)); localSaveFailed.current = false; setSaveIssue(null) }
    catch { localSaveFailed.current = true; setSaveIssue('local') }
  }, [project])
  useEffect(() => { setOrderDraft(null) }, [selected])
  useEffect(() => { setPointFeedback(null) }, [project.projectId, project.source.audioUrl])
  useEffect(() => { numberInputRef.current?.focus() }, [editingNumber?.id, editingNumber?.part])
  useEffect(() => {
    const repaired = connectFullTiming(recoverFlagsFromTiming(project))
    if (repaired !== project) setProject(repaired)
  }, [project])
  useEffect(() => {
    if (!project.projectId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetch(`${API}/api/projects/${project.projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) })
        .then(response => { if (!response.ok) throw new Error('保存失败'); if (!cancelled && !localSaveFailed.current) setSaveIssue(null) })
        .catch(() => { if (!cancelled) setSaveIssue(localSaveFailed.current ? 'local' : 'project') })
    }, 700)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [project])
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current) }, [])
  useEffect(() => { if (project.export) setExportSettings(project.export) }, [project.export])
  useEffect(() => { if (!audioUrl && project.source.audioUrl && audioRef.current) audioRef.current.src = project.source.audioUrl }, [project.source.audioUrl, audioUrl])
  const currentPage: ScorePage | undefined = project.pages[activePage]
  const visibleFlags = recoverFlagsFromTiming(project).flags || []
  const timedIds = new Set(visibleFlags.filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
  const highlightMode = project.highlight?.mode === 'full' ? 'full' : 'wipe'
  const pagePartition = project.partitions?.find(item => item.pageId === currentPage?.id) || emptyPartition(currentPage?.id || '')
  const needsFreshPartition = !pagePartition.horizontal.length && !pagePartition.vertical.length && project.segments.some(segment => segment.pageId === currentPage?.id && !segment.partitionKey)
  const partitionTool: PartitionTool = ['line-h', 'line-v', 'cell-cut', 'line-edit', 'number'].includes(tool) ? tool as PartitionTool : 'line-h'
  useEffect(() => {
    if (highlightMode === 'full' && ['row', 'select', 'cut'].includes(tool)) setTool(project.segments.length ? 'line-edit' : 'line-h')
    if (highlightMode === 'wipe' && !['row', 'select', 'cut'].includes(tool)) setTool('select')
  }, [highlightMode, tool])
  useEffect(() => { setSelectedLine(null) }, [activePage, highlightMode])
  const changePartition = (partition: PagePartition, reuseTimes = false) => {
    lastHistoryAt.current = 0
    setProject(previous => {
      const next = syncPartition(previous, partition)
      return reuseTimes ? rebindAfterMerge(previous, next) : next
    })
  }
  const requestLyricOrder = () => {
    if (playing) { explainPlaying(); return }
    if (!partitionLyricRows(pagePartition).length) {
      setNotice({ title: '先用分隔线划出歌词行', description: '用横线分开每段歌词，再用左右两条整页竖线围出歌词区，然后设置段落编号。', primary: { label: '画横线', onClick: () => setTool('line-h') } })
      return
    }
    setLyricOrderOpen(true)
  }
  const applyLyricOrder = (partition: PagePartition) => {
    lastHistoryAt.current = 0
    setProject(previous => {
      let next = syncPartition(previous, partition, true)
      next = restoreNumberingSlots(next, partition.pageId, next.segments.filter(segment => segment.pageId === partition.pageId && !segment.timingSet).map(segment => segment.id))
      const numberedKeys = next.segments.filter(segment => segment.pageId === partition.pageId && segment.partitionKey).map(segment => segment.partitionKey!)
      return bindTimingToScoreOrder({ ...next, partitions: next.partitions?.map(p => p.pageId === partition.pageId ? { ...p, numberedKeys } : p) })
    })
    setLyricOrderOpen(false); selectOne(null); setTool('line-edit')
    flash(partition.lyricOrder ? `已按 ${partition.lyricOrder.verseCount} 段歌词编号` : '已恢复按位置编号', undoAction)
  }
  const startNumbering = () => {
    if (playing) { explainPlaying(); return }
    if (!partitionLyricRows(pagePartition).length) { requestLyricOrder(); return }
    selectOne(null); setTool(tool === 'number' ? 'line-edit' : 'number')
  }
  const assignNumber = (key: string) => {
    if (projectRef.current.segments.some(segment => segment.partitionKey === key)) return
    lastHistoryAt.current = 0
    setProject(previous => numberPartitionCell(previous, previous.partitions?.find(p => p.pageId === currentPage?.id) || pagePartition, key))
  }
  const restartNumbering = () => {
    if (playing) { explainPlaying(); return }
    lastHistoryAt.current = 0
    setProject(previous => resetPartitionNumbers(previous, previous.partitions?.find(p => p.pageId === currentPage?.id) || pagePartition))
    selectOne(null); setTool('number')
  }
  const deletePartitionLine = () => {
    if (playing) { explainPlaying(); return }
    if (!selectedLine) return
    const axis = pagePartition.horizontal.some(line => line.id === selectedLine) ? pagePartition.horizontal : pagePartition.vertical
    const ordered = [...axis].sort((a, b) => a.position - b.position)
    const index = ordered.findIndex(line => line.id === selectedLine)
    const internal = pagePartition.cuts.some(line => line.id === selectedLine) || (index > 0 && index < ordered.length - 1)
    changePartition(removeGuide(pagePartition, selectedLine), internal); setSelectedLine(null); selectOne(null)
    if (internal) flash('已合并分区，原有时间段按顺序保留；多出的末尾时间可继续使用', undoAction)
  }
  const invertScore = () => {
    if (!currentPage) return
    lastHistoryAt.current = 0
    setProject(previous => ({ ...previous, pages: previous.pages.map(page => page.id === currentPage.id ? { ...page, inverted: !page.inverted } : page) }))
  }
  const highlightColor = /^#[0-9a-f]{6}$/i.test(project.highlight.color || '') ? project.highlight.color! : '#de4b2d'
  const tintChannels = [1, 3, 5].map(offset => parseInt(highlightColor.slice(offset, offset + 2), 16) / 255)
  const colorControl = <button className="button" onClick={() => setColorOpen(true)}><span className="highlight-color-chip" style={{ background: highlightColor }}/>高亮颜色</button>
  const invertControl = <button className={`button compact ${currentPage?.inverted ? 'button-active' : 'button-quiet'}`} aria-pressed={Boolean(currentPage?.inverted)} title="切换当前歌谱的黑底白字和白底黑字" onClick={invertScore}><Contrast size={20}/>黑白反色</button>
  const activeSegment = useMemo(() => {
    const timed = project.segments.filter(segment => segment.timingSet || timedIds.has(segment.id))
      .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (highlightMode === 'full') {
      const started = timed.filter(segment => segment.startTime <= time)
      const current = started[started.length - 1]
      return current && (current !== timed[timed.length - 1] || time < current.endTime) ? current : undefined
    }
    const active = timed.filter(segment => segment.startTime <= time && time < segment.endTime)
    return active[active.length - 1]
  }, [project.segments, visibleFlags, time, highlightMode])
  const progress = activeSegment ? highlightMode === 'full' ? 1 : calculateKaraokeProgress(activeSegment.startTime, activeSegment.endTime, [], time) : 0
  const markedSegments = new Set(visibleFlags.filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
  const nextUnmarkedIndex = project.segments.findIndex(segment => !markedSegments.has(segment.id))
  const nextFlagLabel = nextUnmarkedIndex < 0 ? visibleFlags.some(flag => flag.kind === 'end') ? '完成' : '收尾' : String(nextUnmarkedIndex + 1).padStart(2, '0')
  const nextFlagDescription = !project.segments.length && highlightMode === 'full' && partitionLyricRows(pagePartition).length ? '先编号' : nextFlagLabel === '完成' ? '已全部完成' : nextFlagLabel === '收尾' ? '下一次：最后一句结束' : `下一次：第 ${Number(nextFlagLabel)} 句开始`
  const activeRegions = activeSegment ? segmentRegions(activeSegment) : []
  const activeReveal = highlightMode === 'full' ? activeRegions.map(() => 1) : regionReveal(activeRegions, progress)
  const unfinishedPart = activeReveal.findIndex(value => value < 1)
  const activePart = highlightMode === 'full' ? 0 : unfinishedPart >= 0 ? unfinishedPart : Math.max(0, activeRegions.length - 1)
  const fileName = (name: string | null) => name ? name.replace(/\.[^.]+$/, '') : null
  const changeHighlightMode = (mode: 'wipe' | 'full') => {
    if (mode === 'full' && highlightMode !== 'full') {
      const assigned = timedSegmentIds(project)
      const gap = project.segments.findIndex(s => !assigned.has(s.id))
      if (gap >= 0 && project.segments.slice(gap + 1).some(s => assigned.has(s.id))) {
        setNotice({ title: '整框模式需要连续的乐句顺序', description: `第 ${gap + 1} 句还没有安排时间。切换后将移除从这里开始的后续时间，保留所有歌谱框，再从第 ${gap + 1} 句重新打点。前面的时间保持不变。`, closeLabel: '保留从左到右模式', primary: { label: `切换并从第 ${gap + 1} 句重新打点`, danger: true, onClick: () => {
          lastHistoryAt.current = 0
          setProject(p => removeTiming({ ...p, highlight: { ...p.highlight, mode } }, p.segments[gap].id))
          flash('已切换整框模式，请从空缺的乐句重新打点', undoAction)
        } } }); return
      }
      const timed = project.segments.filter(s => assigned.has(s.id))
      const reversed = timed.findIndex((s, i) => i > 0 && s.startTime < timed[i - 1].startTime + .1)
      if (reversed >= 0) { const segment = timed[reversed]; setNotice({ title: '先调整乐句的时间顺序', description: '整框模式需要后一句的开始时间晚于前一句。当前有乐句时间倒置或过于接近，请先调整，再切换。', primary: { label: '选择需要调整的乐句', onClick: () => selectOne(segment.id) } }); return }
    }
    setProject(current => connectFullTiming({ ...current, highlight: { ...current.highlight, mode } }))
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheelZoom = (event: WheelEvent) => {
      const page = pageRef.current
      if (!page || !(event.target instanceof Element) || !page.contains(event.target)) return
      if (!event.deltaY || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      // Keep drawing coordinates stable while a pointer is held down.
      if (event.buttons || dragRef.current || draftRef.current || marqueeRef.current) return
      const rect = page.getBoundingClientRect()
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1)
      const factor = Math.exp(-Math.max(-240, Math.min(240, pixels)) * .0015)
      setZoom(previous => {
        const current = previous ?? rect.width / 510
        const next = Math.max(.45, Math.min(2.5, current * factor))
        if (Math.abs(next - current) < .00001) return previous
        scoreZoomAnchor.current = { page, x: event.clientX, y: event.clientY,
          fractionX: (event.clientX - rect.left) / rect.width, fractionY: (event.clientY - rect.top) / rect.height }
        return next
      })
    }
    canvas.addEventListener('wheel', wheelZoom, { passive: false })
    return () => canvas.removeEventListener('wheel', wheelZoom)
  }, [currentPage?.id, project.source.pdf, project.source.audio, project.source.audioUrl])

  useLayoutEffect(() => {
    const anchor = scoreZoomAnchor.current
    scoreZoomAnchor.current = null
    const canvas = canvasRef.current, page = pageRef.current
    if (!anchor || !canvas || page !== anchor.page) return
    const rect = page.getBoundingClientRect()
    canvas.scrollLeft += rect.left + anchor.fractionX * rect.width - anchor.x
    canvas.scrollTop += rect.top + anchor.fractionY * rect.height - anchor.y
  }, [zoom])

  useEffect(() => {
    if (!playing || !activeSegment || !canvasRef.current) return
    const focus = segmentRegions(activeSegment)[activePart] || segmentRegions(activeSegment)[0]
    const targetPage = project.pages.findIndex(page => page.id === focus.pageId)
    if (targetPage < 0) return
    if (targetPage !== activePage) { setActivePage(targetPage); return }
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current; const page = pageRef.current
      if (!canvas || !page) return
      const canvasRect = canvas.getBoundingClientRect(); const pageRect = page.getBoundingClientRect()
      const centerY = canvas.scrollTop + pageRect.top - canvasRect.top + (focus.region.y + focus.region.height / 2) * pageRect.height
      const target = calculateCameraTarget(centerY, canvas.scrollHeight, canvas.clientHeight, canvas.scrollTop)
      if (Math.abs(target - canvas.scrollTop) > 1) canvas.scrollTo({ top: target, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeSegment?.id, activePart, activePage, playing, project.pages])
  useEffect(() => {
    if (!exportJob || !['queued', 'running'].includes(exportJob.status)) return
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        await new Promise(resolve => window.setTimeout(resolve, 900))
        try {
          const response = await fetch(`${API}/api/exports/${exportJob.jobId}`)
          if (!response.ok) throw new Error('无法读取导出进度')
          const next = await response.json()
          if (cancelled) return
          setExportJob({ ...next, jobId: exportJob.jobId })
          if (next.status === 'completed') { setExportBusy(false); flash('视频已生成完成', { label: '查看并保存视频', onClick: () => setExportOpen(true) }); return }
          if (next.status === 'failed') { setExportBusy(false); return }
        } catch (error) {
          if (!cancelled) { setExportJob(j => j ? { ...j, status: 'failed', error: error instanceof Error ? error.message : '导出状态读取失败' } : j); setExportBusy(false) }
          return
        }
      }
    }
    void poll()
    return () => { cancelled = true }
  }, [exportJob?.jobId, exportJob?.status])
  useEffect(() => {
    if (!exportJob || ['queued', 'running'].includes(exportJob.status) || exportedInput.current === exportInput) return
    setExportJob(null); setValidation(null); setValidationError(null)
    if (exportOpen) { setPreviewRetry(value => value + 1); void checkExport() }
  }, [exportInput, exportJob?.status])
  useEffect(() => {
    if (!exportOpen || !project.projectId) return
    const controller = new AbortController()
    let timer: number
    const load = async () => {
      const scale = Math.max(320 / Math.min(exportSettings.width, exportSettings.height), Math.min(1, 960 / Math.max(exportSettings.width, exportSettings.height)))
      const query = new URLSearchParams({ time: String(previewTimeRef.current), width: String(Math.round(exportSettings.width * scale)), height: String(Math.round(exportSettings.height * scale)), scoreZoom: String(exportSettings.scoreZoom) })
      try {
        const response = await fetch(`${API}/api/projects/${project.projectId}/preview?${query}`, { signal: controller.signal })
        if (!response.ok) throw new Error('预览生成失败')
        const nextUrl = URL.createObjectURL(await response.blob())
        if (controller.signal.aborted) { URL.revokeObjectURL(nextUrl); return }
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = nextUrl; setPreviewUrl(nextUrl); setPreviewError(false)
      } catch { if (!controller.signal.aborted) setPreviewError(true) }
      if (previewPlaying && !controller.signal.aborted) timer = window.setTimeout(load, 100)
    }
    timer = window.setTimeout(load, previewPlaying ? 0 : 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [exportOpen, project.projectId, previewPlaying, previewPlaying ? null : previewTime, exportSettings.width, exportSettings.height, exportSettings.scoreZoom, previewRetry])

  useEffect(() => () => window.clearTimeout(messageTimer.current), [])
  const flash = (text: string, action?: DialogAction) => {
    window.clearTimeout(messageTimer.current)
    setMessage({ text, action })
    messageTimer.current = window.setTimeout(() => setMessage(null), action ? 15000 : 7000)
  }
  const undoAction = { label: '撤销上一步', onClick: () => { undoProject(); setMessage(null) } }
  const fail = (title: string, description: string, error: unknown, primary?: DialogAction, secondary?: DialogAction) => setNotice({
    title, description, tone: 'error', details: error instanceof Error ? error.message : String(error || ''), primary, secondary,
  })
  const chooseScore = () => {
    if (!projectEditingBusy()) scoreInput.current?.click()
  }
  const chooseMoreScores = () => {
    if (!projectEditingBusy()) moreScoreInput.current?.click()
  }
  const projectEditingBusy = () => importLock.current || autoBusy || boxBusy || exportBusy || duplicateBusy
  const requestScoreRemoval = () => {
    if (projectEditingBusy() || projectRef.current.pages.length <= 1) return
    const snapshot = projectRef.current
    const page = snapshot.pages[Math.min(activePage, snapshot.pages.length - 1)]
    const ids = new Set([page.id])
    setNotice({ title: `删除第 ${snapshot.pages.indexOf(page) + 1} 页歌谱？`,
      description: '本页及相关标注、打点会一起移除。音频和其他页保留，可以撤销。',
      closeLabel: '保留', primary: { label: '删除', danger: true, onClick: () => {
        if (projectEditingBusy()) return
        audioRef.current?.pause(); setPlaying(false); lastHistoryAt.current = 0
        setProject(current => removeScorePages(current, ids))
        selectOne(null); setEditingNumber(null); setTool(highlightMode === 'full' ? 'line-edit' : 'select')
        flash('已删除本页', undoAction)
      } },
    })
  }
  const activateProject = (next: Project, current: Project, retainAudio = false) => {
    const keepCurrent = Boolean(current.pages.length || current.source.audio || current.segments.length)
    if (keepCurrent) localStorage.setItem('pujian-previous-project', JSON.stringify(current))
    else localStorage.removeItem('pujian-previous-project')
    localStorage.setItem('pujian-project', JSON.stringify(next))
    audioRef.current?.pause()
    if (retainAudio) {
      if (audioRef.current) audioRef.current.currentTime = 0
      setDuration(next.audioDuration || duration || 0)
    } else {
      if (audioRef.current) { audioRef.current.removeAttribute('src'); audioRef.current.load() }
      setAudioUrl(null); setDuration(0)
    }
    setTime(0); setPlaying(false); setPreviewPlaying(false)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null; setPreviewUrl(null)
    undoHistory.current = []; redoHistory.current = []; lastHistoryAt.current = 0
    projectRef.current = next; setProjectState(next)
    setActivePage(0); selectOne(null); setEditingNumber(null); setZoom(null)
    setPointFeedback(null); setSaveIssue(null); setExportJob(null); setExportOpen(false)
    setAutoCandidates(null); setBoxCandidates(null); setAnalysisProgress(null)
    setLyricOrderOpen(false); setResetOpen(false); setColorOpen(false)
    setDraft(null); setMarquee(null); setIsDrawing(false)
    draftRef.current = null; marqueeRef.current = null; dragRef.current = null
    setTool('select')
  }
  const chooseAudio = () => {
    if (project.source.audio && project.segments.some(s => s.timingSet || timedIds.has(s.id))) {
      setNotice({ title: '更换音频后需要重新设置时间', description: '新音频导入成功后，会清空已有打点和乐句时间。歌谱和分区会保留。取消选择文件不会改变当前项目。', closeLabel: '保留当前音频', primary: { label: '继续选择新音频', danger: true, onClick: () => audioInput.current?.click() } })
    } else audioInput.current?.click()
  }
  const explainPlaying = () => setNotice({ title: '先暂停播放，再修改分区', description: '暂停后可以画线、选择分区或删除分隔线。', primary: { label: '暂停播放', onClick: () => { audioRef.current?.pause(); setPlaying(false) } } })
  const explainPartitionConflict = (nextTool: PartitionTool = 'line-h') => setNotice({
    title: '先重新分区，才能全局画线',
    description: `当前页使用的是已有标注框。重新分区将清空这首歌所有页面的分隔线、${project.segments.length} 条乐句和 ${(project.flags || []).length} 个打点。歌谱与音频会保留。\n想保留现有框，可以继续使用“框内竖切”。`,
    closeLabel: '保留现有标注',
    primary: { label: '清空并重新分区', danger: true, onClick: () => { resetAnnotations(); setTool(nextTool) } },
    secondary: { label: '使用框内竖切', onClick: () => setTool('cell-cut') },
  })
  const requestPartitionTool = (nextTool: PartitionTool) => {
    if (playing) { explainPlaying(); return }
    if (needsFreshPartition && (nextTool === 'line-h' || nextTool === 'line-v')) { explainPartitionConflict(nextTool); return }
    setTool(nextTool)
  }
  const chooseRegions = () => { setTool('select') }
  const beginRegions = () => { setTool(highlightMode === 'full' ? 'line-h' : 'row') }
  const selectOne = (id: string | null) => { setSelectedLine(null); setSelected(id); setSelectedIds(id ? [id] : []); setMergeTarget(null); setOrderDraft(null) }
  const selectSegment = (id: string, additive: boolean) => {
    if (!additive) { selectOne(id); return }
    const ids = selectedIds.includes(id) ? selectedIds.filter(selectedId => selectedId !== id) : [...selectedIds, id]
    setSelectedIds(ids); setSelected(ids[ids.length - 1] || null)
  }
  const moveSegmentTo = (id: string, positionText: string) => {
    const position = Number(positionText)
    if (!/^\d+$/.test(positionText) || !Number.isInteger(position) || position < 1 || position > project.segments.length) {
      setNotice({ title: '乐句序号不在可用范围内', description: `请输入 1 到 ${project.segments.length} 的整数，再点击“移动到此”。`, primary: { label: '修改序号', onClick: () => document.getElementById('phrase-order')?.focus() } })
      return
    }
    const from = project.segments.findIndex(segment => segment.id === id)
    const to = position - 1
    if (from < 0 || from === to) { setOrderDraft(null); return }
    lastHistoryAt.current = 0
    setProject(previous => {
      const reordered = [...previous.segments]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved)
      return bindTimingToScoreOrder({ ...previous, segments: reordered, partitions: previous.partitions?.map(p => p.pageId === moved.pageId ? { ...p, lyricOrder: undefined, numberedKeys: reordered.filter(segment => segment.pageId === p.pageId && segment.partitionKey).map(segment => segment.partitionKey!) } : p) })
    })
    setOrderDraft(null)
    flash(`已移到乐句 ${String(position).padStart(2, '0')}；原有时间和打点按序号保留`)
  }
  const commitNumberEdit = () => {
    const edit = editingNumber
    setEditingNumber(null)
    if (cancelNumberEdit.current || !edit?.value) return
    cancelNumberEdit.current = true
    moveSegmentTo(edit.id, edit.value)
  }
  const updateSegment = (id: string, patch: Partial<Segment>) => {
    const changedTime = patch.startTime !== undefined || patch.endTime !== undefined
    const current = projectRef.current
    const assigned = timedSegmentIds(current)
    if (changedTime && current.highlight.mode === 'full' && !assigned.has(id)) {
      const first = current.segments.find(s => !assigned.has(s.id))
      if (first && first.id !== id) { setNotice({ title: '整框模式需要按顺序设置时间', description: `请先从第 ${current.segments.indexOf(first) + 1} 句开始打点，再继续后面的乐句。`, primary: { label: '选择下一句待打点乐句', onClick: () => selectOne(first.id) } }); return false }
    }
    setProject(p => {
      const source = p.segments.find(s => s.id === id)
      if (!source) return p
      if (changedTime && timedSegmentIds(p).has(id)) return editTiming(p, id, patch.startTime ?? source.startTime, patch.endTime ?? source.endTime,
        patch.startTime !== undefined && patch.endTime !== undefined ? 'both' : patch.startTime !== undefined ? 'start' : 'end', duration || p.audioDuration || 0)
      const next = { ...p, segments: p.segments.map(s => s.id === id ? { ...s, ...patch, ...(changedTime ? { timingSet: true } : {}) } : s) }
      return changedTime ? connectFullTiming(refreshTimingFlags(next)) : next
    })
    return true
  }
  const commitTime = (segment: Segment, field: 'startTime' | 'endTime', value: number) => {
    const end = duration || project.audioDuration || 0
    let reason = ''
    if (!Number.isFinite(value) || value < 0 || (end > 0 && value > end)) reason = `时间需要在 00:00.000 到 ${formatTime(end)} 之间。`
    else if (field === 'startTime' ? value >= segment.endTime : value <= segment.startTime) reason = '结束时间必须晚于开始时间。请先调整相应的开始或结束时间。'
    if (reason) { setNotice({ title: '这个时间不能使用', description: reason, primary: { label: '返回修改时间', onClick: () => document.querySelector<HTMLButtonElement>(`[data-segment-id="${segment.id}"]`)?.focus() } }); return false }
    return updateSegment(segment.id, { [field]: value })
  }
  const moveTimelineSegment = (id: string, start: number, end: number, edge: TimingEdge) => {
    lastHistoryAt.current = 0
    setProject(p => editTiming(p, id, start, end, edge, duration || p.audioDuration || 0))
  }
  const deleteTimelineSegment = (id: string) => {
    const index = project.segments.findIndex(s => s.id === id)
    if (index < 0) return
    const full = highlightMode === 'full'
    const assigned = timedSegmentIds(project)
    const count = project.segments.filter((s, i) => assigned.has(s.id) && (full ? i >= index : s.id === id)).length
    setNotice({ title: full ? `从第 ${index + 1} 句开始重新打点？` : `移除第 ${index + 1} 句的时间？`,
      description: full ? `将移除第 ${index + 1} 句及后面已放入时间轴的 ${count} 条乐句时间，需要从这里重新打点。所有歌谱框和编号都会保留，前面的时间保持不变。`
        : `只移除时间轴上的第 ${index + 1} 句，保留对应歌谱框和编号。后面的乐句不移动，这里会留下空位，可之后重新插入。`,
      closeLabel: '保留现有时间', primary: { label: full ? '移除这些时间，重新打点' : '只移除这句时间', danger: true, onClick: () => {
        audioRef.current?.pause(); setPlaying(false); lastHistoryAt.current = 0
        setProject(p => removeTiming(p, id)); selectOne(id)
        flash(full ? `已移除第 ${index + 1} 句及后面的时间，歌谱框已保留` : `第 ${index + 1} 句已从时间轴移除，歌谱框已保留`, undoAction)
      } },
    })
  }
  const insertTimelineSegment = (id: string, at: number) => {
    if (highlightMode === 'full') {
      const next = project.segments.find(s => !timedSegmentIds(project).has(s.id))
      if (next?.id !== id) { setNotice({ title: '整框模式需要按顺序放入乐句', description: '请先选择下一条待打点的乐句，再放入未分配时间。', primary: next ? { label: '选择下一句', onClick: () => selectOne(next.id) } : undefined }); return }
    }
    lastHistoryAt.current = 0
    setProject(p => insertTiming(p, id, at, duration || p.audioDuration || 0))
    flash('已把选中的乐句放入时间轴，其他乐句的位置保持不变', undoAction)
  }
  const updateSegmentRegion = (id: string, part: number, region: Region) => setProject(p => {
    const source = p.segments.find(segment => segment.id === id)
    const sourcePart = source && segmentRegions(source)[part]
    if (!source || !sourcePart) return p
    const groupKey = sharedRegionKey(source)
    const partKey = regionPositionKey(sourcePart)
    return { ...p, segments: p.segments.map(segment => {
      if (sharedRegionKey(segment) !== groupKey) return segment
      const regions = segmentRegions(segment).map(item => regionPositionKey(item) === partKey ? { ...item, region: fitRegion(region) } : item)
      return { ...segment, pageId: regions[0].pageId, region: regions[0].region, regions: regions.length > 1 ? regions : undefined }
    }) }
  })
  const deleteSegment = (id: string) => {
    const source = project.segments.find(segment => segment.id === id)
    if (source?.partitionKey) {
      const partition = project.partitions?.find(item => item.pageId === source.pageId)
      if (partition) changePartition({ ...partition, excluded: [...partition.excluded, source.partitionKey] })
      selectOne(null)
      flash('已跳过这个分区', undoAction)
      return
    }
    setProject(p => {
      const segments = p.segments.filter(s => s.id !== id)
      const flags = p.flags?.filter(flag => flag.segmentId !== id)
        .map((flag, index) => index === 0 ? { ...flag, kind: 'start' as const } : flag)
      return { ...p, segments, flags }
    })
    selectOne(null); setTool('select')
    flash('已删除标注，其余乐句的打点已保留', undoAction)
  }
  const onScore = async (selection?: FileList | File[] | null, mode: 'new' | 'drop' | 'append' = 'new') => {
    const files = Array.from(selection || [])
    if (!files.length || importLock.current) return false
    if (mode === 'new' && files.length !== 1) {
      setNotice({ title: '一次选择一份歌谱', description: '顶部“歌谱”用于开始新项目。需要追加时，请使用“更多工具 → 更多歌谱”。' }); return false
    }
    importLock.current = true
    setScoreImporting(true)
    const appending = mode === 'append' && projectRef.current.pages.length > 0
    const replacing = !appending && Boolean(projectRef.current.source.pdf)
    const form = new FormData(); files.forEach(file => form.append('files', file))
    try {
      const response = await fetch(`${API}/api/import/score`, { method: 'POST', body: form })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(typeof error.detail === 'string' ? error.detail : '乐谱导入失败')
      }
      const data = await response.json()
      const pages: ScorePage[] = data.pages.map((p: any) => ({ id: `page-${crypto.randomUUID()}`, image: p.image, width: p.width, height: p.height }))
      if ((appending ? projectRef.current.pages.length : 0) + pages.length > 100) throw new Error('歌谱最多支持 100 页，请减少本次添加的文件')
      if (mode !== 'append') {
        const current = projectRef.current
        if (current.pages.length || current.source.audio || current.segments.length) await persistProject(current)
        const scoreName = data.filename.replace(/\.[^.]+$/, '')
        const retainAudio = mode === 'drop' && Boolean(current.source.audioUrl)
        const pdf = files.length > 1 ? `${scoreName} 等 ${files.length} 份` : data.filename
        activateProject({ ...emptyProject(), projectId: data.projectId, projectName: scoreName,
          source: retainAudio ? { ...current.source, pdf } : { pdf, audio: null },
          audioDuration: retainAudio ? current.audioDuration || duration || null : null, pages }, current, retainAudio)
        flash(retainAudio ? '已新建项目，沿用原音频' : `已新建项目，导入 ${pages.length} 页歌谱，请选择音频`)
        return true
      }
      audioRef.current?.pause()
      setPlaying(false)
      lastHistoryAt.current = 0
      if (appending) {
        const firstNewPage = projectRef.current.pages.length
        setProject(p => ({ ...p, pages: [...p.pages, ...pages] }))
        setActivePage(firstNewPage); selectOne(null); setSelectedLine(null)
        flash(`已追加 ${pages.length} 页歌谱，共 ${firstNewPage + pages.length} 页`, undoAction)
        return true
      }
      if (audioRef.current) audioRef.current.currentTime = 0
      const scoreName = data.filename.replace(/\.[^.]+$/, '')
      setProject(p => ({ ...p, projectId: data.projectId, projectName: scoreName, source: { ...p.source, pdf: files.length > 1 ? `${scoreName} 等 ${files.length} 份` : data.filename }, pages, segments: [], flags: [], partitions: [], spareTimings: [] }))
      setActivePage(0); selectOne(null); setTime(0); setPlaying(false); setTool('row')
      flash(replacing ? '已替换乐谱，原有标注已清空' : `已导入 ${pages.length} 页乐谱`)
      return true
    } catch (error) { fail('歌谱没有导入成功', '已有歌谱和标注已保留。请检查文件后重新添加。', error, { label: '重新选择歌谱', onClick: mode === 'append' ? chooseMoreScores : chooseScore }); return false }
    finally { importLock.current = false; setScoreImporting(false) }
  }
  const onAudio = async (file?: File) => {
    if (!file || importLock.current) return
    importLock.current = true
    setAudioImporting(true)
    const replacing = Boolean(project.source.audio)
    try {
      const body = new FormData(); body.append('file', file)
      const response = await fetch(`${API}/api/import/audio`, { method: 'POST', body })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '音频导入失败')
      const url = URL.createObjectURL(file)
      audioRef.current?.pause()
      setAudioUrl(url)
      setProject(p => ({ ...p, source: { ...p.source, audio: file.name, audioUrl: data.url }, audioDuration: data.duration || null, flags: [], spareTimings: [], segments: p.segments.map((segment, index) => ({ ...segment, startTime: index * 4, endTime: (index + 1) * 4, timingSet: false })) }))
      selectOne(null); setTime(0); setDuration(data.duration || 0); setPlaying(false)
      if (audioRef.current) { audioRef.current.src = url; audioRef.current.load() }
      flash(replacing ? '已替换音频，请重新打点校准时间' : '音频已载入，可以开始播放')
    } catch (error) { fail('音频没有导入成功', '请重新选择 MP3、WAV、M4A 或 OGG 音频。', error, { label: '重新选择音频', onClick: () => audioInput.current?.click() }) }
    finally { importLock.current = false; setAudioImporting(false) }
  }
  const importDroppedFiles = (files: File[]) => {
    if (importLock.current || !files.length) return
    const scores = files.filter(file => /\.(pdf|jpe?g|png|webp)$/i.test(file.name))
    const audio = files.filter(file => /\.(mp3|wav|m4a|ogg)$/i.test(file.name))
    if (scores.length + audio.length !== files.length) {
      setNotice({ title: '有文件暂不支持', description: '请添加 PDF、JPG、PNG、WebP 歌谱，或 MP3、WAV、M4A、OGG 音频。本次文件尚未导入。' }); return
    }
    if (audio.length > 1) {
      setNotice({ title: '一次只能添加一份音频', description: '每首歌使用一份音频。请保留所需音频后重新拖入，歌谱可以同时添加多份。' }); return
    }
    const run = async () => {
      if (scores.length && !await onScore(scores, 'drop')) return
      if (audio[0]) await onAudio(audio[0])
    }
    const current = projectRef.current
    if (!scores.length && audio[0] && current.source.audio && timedSegmentIds(current).size) {
      setNotice({ title: '更换音频后需要重新设置时间', description: '新音频导入成功后，会清空已有打点和乐句时间，保留歌谱和分区。', closeLabel: '保留当前音频', primary: { label: '替换音频并导入', danger: true, onClick: () => { void run() } } }); return
    }
    void run()
  }
  const playAudio = (at?: number) => {
    const el = audioRef.current
    if (!el || !project.source.audio) { setNotice({ title: '先添加音频，才能播放', description: '选择这首歌对应的音频文件。', primary: { label: '选择音频', onClick: chooseAudio } }); return }
    if (at !== undefined) seek(at)
    void el.play().then(() => setPlaying(true)).catch(error => {
      setPlaying(false)
      fail('音频暂时无法播放', '可以重新选择原来的音频文件。更换音频前会提示是否清除已有时间。', error, { label: '重新选择音频', onClick: chooseAudio })
    })
  }
  const togglePlay = () => { const el = audioRef.current; if (el && !el.paused) { el.pause(); setPlaying(false) } else playAudio() }
  const seek = (next: number) => { const el = audioRef.current; if (!el) return; el.currentTime = Math.max(0, Math.min(duration || 0, next)); setTime(el.currentTime) }
  const addFlag = () => {
    const at = audioRef.current?.currentTime ?? time
    const ordered = project.segments, flags = visibleFlags
    const report = (text: string, warning = false) => setPointFeedback({ text, warning })
    if (!audioRef.current || !project.source.audio) { report('请先选择音频，再打点。', true); return }
    if (!ordered.length) {
      if (highlightMode === 'full' && partitionLyricRows(pagePartition).length) { setNotice({ title: '先给歌词框编号', description: '点击“编号”，按演唱顺序点击歌词框，数字会立即保存。', primary: { label: '开始编号', onClick: startNumbering } }) }
      else report('请先在歌谱上划分歌词，再打点。', true)
      return
    }
    if (flags.some(flag => flag.kind === 'end') && nextUnmarkedIndex < 0) { report('全部打点已完成，可以继续试听或导出视频。'); return }
    const index = nextUnmarkedIndex < 0 ? ordered.length : nextUnmarkedIndex
    const following = ordered.slice(index + 1).find(segment => markedSegments.has(segment.id))
    const audioEnd = duration || project.audioDuration || 0
    if (index < ordered.length && audioEnd > 0 && at > audioEnd - .1) { report('已经到音频结尾，本次未记录。请回到这一句开始的位置再打点。', true); return }
    if (highlightMode === 'full' && following && at >= following.startTime) { report('当前位置晚于后面已有的打点，本次未记录。请在时间轴上回到这一句的位置再打点。', true); return }
    const previous = ordered[index - 1]
    if (previous && Math.abs(at - previous.startTime) < .1) { report('两次打点太接近，本次未记录。继续播放，唱到下一句时再打点。', true); return }
    if (highlightMode === 'full' && previous && at <= previous.startTime) { report(`当前位置太早，本次未记录。继续播放，唱到第 ${index + 1} 句时再打点。`, true); return }
    const provisionalEnd = (oldEnd: number) => Math.min(audioEnd > 0 ? audioEnd : Infinity, Math.max(oldEnd, at + 1))
    const nextFlags: KaraokeFlag[] = flags.filter(flag => flag.kind !== 'end').map(flag => ({ ...flag }))
    if (index === 0) {
      const first = ordered[0]
      nextFlags.forEach(flag => { if (flag.kind === 'start') flag.kind = 'transition' })
      nextFlags.unshift({ id: `flag-${crypto.randomUUID()}`, time: at, segmentId: first.id, kind: 'start' })
      setProject(p => ({ ...p, flags: nextFlags, segments: p.segments.map((s, i) => i === 0 ? { ...s, startTime: at, endTime: provisionalEnd(s.endTime), timingSet: true } : s) }))
      selectOne(first.id)
      const pageIndex = project.pages.findIndex(page => page.id === first.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      report(`已打点 ${formatTime(at)} · 第 1 句开始`)
      return
    }
    if (!previous) return
    const next = ordered[index]
    const keepPreviousEnd = highlightMode === 'wipe' && (following != null || at <= previous.startTime || flags.some(flag => flag.segmentId === previous.id && (flag.kind === 'end' || flag.id.startsWith('recovered-'))))
    nextFlags.push({ id: `flag-${crypto.randomUUID()}`, time: at, segmentId: next?.id || previous.id, kind: next ? 'transition' : 'end' })
    nextFlags.sort((a, b) => a.time - b.time)
    setProject(p => ({ ...p, flags: nextFlags, segments: p.segments.map((s, i) => i === index - 1
      ? keepPreviousEnd ? s : { ...s, endTime: at }
      : i === index ? { ...s, startTime: at, endTime: provisionalEnd(s.endTime), timingSet: true } : s),
    }))
    if (next) {
      selectOne(next.id)
      const pageIndex = project.pages.findIndex(page => page.id === next.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      report(`已打点 ${formatTime(at)} · 第 ${index + 1} 句开始`)
    } else report(`已打点 ${formatTime(at)} · 最后一句结束`)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!project.pages.length || !project.source.pdf || !project.source.audio || !project.source.audioUrl) return
      if (notice) return
      if (document.querySelector('[aria-modal="true"]')) {
        if (event.key === 'Escape' && !analysisProgress && !document.querySelector('.action-dialog, .desktop-update .modal-backdrop')) { setAutoCandidates(null); setBoxCandidates(null); setExportOpen(false) }
        return
      }
      const target = event.target as HTMLElement
      if (target?.matches('input, textarea, select') || target?.isContentEditable) return
      if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoProject() : undoProject(); return }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redoProject(); return }
      if (event.key === 'Escape' && tool === 'number') { setTool('line-edit'); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && highlightMode === 'full' && selectedLine && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault(); deletePartitionLine(); return
      }
      const focusedControl = target?.closest('button, a, summary')
      // Space controls playback even after clicking Mark. Cancel the button's
      // native activation so releasing Space cannot record another point.
      if (event.code === 'Space' && (!focusedControl || focusedControl.matches('.play-button, .flag-button'))) {
        event.preventDefault()
        if (!event.repeat) togglePlay()
        return
      }
      if (focusedControl) return
      if (event.key === 'Enter') { event.preventDefault(); addFlag() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); seek(time - (event.shiftKey ? 1 : .1)) }
      if (event.key === 'ArrowRight') { event.preventDefault(); seek(time + (event.shiftKey ? 1 : .1)) }
      if (event.key.toLowerCase() === 'n') { if (highlightMode === 'full') requestPartitionTool('line-h'); else setTool('row') }
      if (event.key.toLowerCase() === 'd' && selected && highlightMode !== 'full') { event.preventDefault(); void duplicateBelow() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selected || selectedLine) && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        if (highlightMode === 'full' && selectedLine) deletePartitionLine()
        else if (selected) deleteSegment(selected)
      }
      if (event.key.toLowerCase() === 's' && selected) updateSegment(selected, { startTime: time })
      if (event.key.toLowerCase() === 'e' && selected) updateSegment(selected, { endTime: time })
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [time, selected, selectedIds, selectedLine, duration, project, resetOpen, autoCandidates, boxCandidates, exportOpen, notice, playing, analysisProgress, tool])

  function resetAnnotations() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    lastHistoryAt.current = 0
    setProject(p => ({ ...p, segments: [], flags: [], partitions: [], spareTimings: [] }))
    setSelectedLine(null)
    selectOne(null); setActivePage(0); setTime(0); setPlaying(false); setTool(highlightMode === 'full' ? 'line-h' : project.pages.length ? 'row' : 'select')
    setResetOpen(false)
    flash('已清空标注，歌谱与音频已保留', undoAction)
  }

  function createSegment(region: Region) {
    if (!currentPage) { setNotice({ title: '先添加歌谱，才能画框', description: '选择 PDF 或歌谱图片后，即可划分歌词。', primary: { label: '选择歌谱', onClick: chooseScore } }); return }
    const id = `segment-${Date.now()}`
    const next: Segment = { id, pageId: currentPage.id, region: fitRegion(region), startTime: time, endTime: Math.min(duration || time + 4, time + 4), direction: 'left-to-right' }
    setProject(p => ({ ...p, segments: [...p.segments, next] })); selectOne(id); setTool('row')
  }
  const mergeSegments = (selectedSegmentIds: string[]) => {
    const picked = project.segments.filter(segment => selectedSegmentIds.includes(segment.id))
    if (picked.some(segment => segment.partitionKey)) { setNotice({ title: '这些分区需要通过分隔线合并', description: '切换到整框高亮，用手形工具选中两个分区之间的线，再按 Backspace 删除。', primary: { label: '选择分隔线', onClick: () => { changeHighlightMode('full'); setTool('line-edit') } } }); return }
    if (picked.length < 2) { setNotice({ title: '先选中至少两条乐句', description: '点击“选择乐句”，在歌谱上拖出一个范围，选中相邻的歌词框，再点击“合并乐句”。', primary: { label: '选择乐句', onClick: chooseRegions } }); return }
    const firstIndex = project.segments.findIndex(segment => segment.id === picked[0].id)
    const contiguous = picked.every((segment, index) => project.segments[firstIndex + index]?.id === segment.id)
    if (!contiguous) { setNotice({ title: '只能合并顺序相邻的乐句', description: '当前选择跳过了中间的乐句。请重新选中相邻的歌词框，再进行合并。', primary: { label: '重新选择乐句', onClick: () => { selectOne(null); chooseRegions() } } }); return }
    const regions = picked.flatMap(segmentRegions)
    const merged: Segment = { ...picked[0], pageId: regions[0].pageId, region: regions[0].region, regions,
      startTime: Math.min(...picked.map(segment => segment.startTime)), endTime: Math.max(...picked.map(segment => segment.endTime)) }
    const ids = new Set(picked.map(segment => segment.id))
    lastHistoryAt.current = 0
    setProject(previous => rebindAfterMerge(previous, { ...previous,
      segments: previous.segments.flatMap(segment => segment.id === merged.id ? [merged] : ids.has(segment.id) ? [] : [segment]),
    }))
    selectOne(merged.id); setTool('select')
    flash(`已合并为乐句 ${String(firstIndex + 1).padStart(2, '0')}，后面的乐句已依次接上原时间段`, undoAction)
  }
  const mergeSelected = () => mergeSegments(selectedIds)
  const reverseSegmentRegions = (id: string) => {
    const segment = project.segments.find(item => item.id === id)
    if (!segment || segmentRegions(segment).length < 2) return
    lastHistoryAt.current = 0
    setProject(previous => ({ ...previous, segments: previous.segments.map(item => {
      if (item.id !== id) return item
      const regions = [...segmentRegions(item)].reverse()
      return { ...item, pageId: regions[0].pageId, region: regions[0].region, regions }
    }) }))
    flash('已反转这句的框顺序；时间和打点保持不变')
  }
  const repeatSelectedRegions = () => {
    const sources = project.segments.filter(segment => selectedIds.includes(segment.id))
    if (!sources.length) { setNotice({ title: '先选中要重复使用的歌词框', description: '选择歌词框后，再点击“重复使用选中框”。', primary: { label: '选择歌词框', onClick: chooseRegions } }); return }
    const assignedIds = new Set((project.flags || []).filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
    const lastAssignedEnd = Math.max(0, ...project.segments.filter(segment => segment.timingSet || assignedIds.has(segment.id)).map(segment => segment.endTime))
    const audioEnd = duration || project.audioDuration || lastAssignedEnd + sources.length * 1.1 + 2
    const copies = sources.map((source, index): Segment => {
      const startTime = Math.max(0, Math.min(audioEnd - .1, lastAssignedEnd + index * 1.1))
      const regions = segmentRegions(source).map(item => ({ pageId: item.pageId, region: { ...item.region } }))
      return { ...source, partitionKey: undefined, id: `repeat-${Date.now()}-${index}`, pageId: regions[0].pageId, region: regions[0].region,
        regions: regions.length > 1 ? regions : undefined, startTime, endTime: Math.min(audioEnd, startTime + 1), timingSet: false }
    })
    lastHistoryAt.current = 0
    setProject(previous => ({ ...previous, segments: [...previous.segments, ...copies] }))
    const ids = copies.map(copy => copy.id)
    setSelectedIds(ids); setSelected(ids[ids.length - 1]); setTool('select')
    flash(`已在结尾重复使用 ${copies.length} 个歌词框；新乐句待打点`)
  }
  const duplicateBelow = async () => {
    if (duplicateBusy) return
    const sources = project.segments.filter(segment => selectedIds.includes(segment.id))
    if (!sources.length) { setNotice({ title: '先选中要复制的歌词框', description: '点击“选择歌词框”，再在歌谱上点选一个框。选中后点击“复制到下一行”。', primary: { label: '选择歌词框', onClick: chooseRegions } }); return }
    setDuplicateBusy(true)
    const pageImages = new Map<string, ReturnType<typeof loadInkPage>>()
    const copyRegions: { pageId: string; region: Region }[][] = []
    try {
      for (const source of sources) {
        const regions: { pageId: string; region: Region }[] = []
        for (const part of segmentRegions(source)) {
          const page = project.pages.find(item => item.id === part.pageId)
          if (!page) throw new Error('找不到标注对应的乐谱页')
          if (!pageImages.has(page.id)) pageImages.set(page.id, loadInkPage(page))
          const inkPage = await pageImages.get(page.id)!
          const region = copyRegionToNextLine(inkPage, part.region)
          if (!region) {
            const number = project.segments.indexOf(source) + 1
            setNotice({ title: '没有找到可以复制到的下一行', description: `第 ${number} 句下方没有识别到歌词。可以手动画出下一行的歌词框。`, primary: { label: '手动画歌词框', onClick: () => setTool('row') } })
            return
          }
          regions.push({ pageId: part.pageId, region })
        }
        copyRegions.push(regions)
      }
    } catch {
      fail('暂时无法复制歌词框', '乐谱图片读取失败。可以重试；若仍失败，请重新选择歌谱。', '', { label: '重试复制', onClick: () => { void duplicateBelow() } })
      return
    } finally {
      setDuplicateBusy(false)
    }
    const copies = sources.map((source, index): Segment => {
      const regions = copyRegions[index]
      const single = sources.length === 1
      return { ...source, partitionKey: undefined, id: `segment-${Date.now()}-${index}`, pageId: regions[0].pageId,
        region: regions[0].region, regions: regions.length > 1 ? regions : undefined,
        startTime: single ? source.endTime : 0,
        endTime: single ? source.endTime + (source.endTime - source.startTime) : 4,
        timingSet: false, text: undefined }
    })
    const lastIndex = project.segments.reduce((last, segment, index) => selectedIds.includes(segment.id) ? index : last, -1)
    lastHistoryAt.current = 0
    setProject(previous => {
      const segments = [...previous.segments]
      segments.splice(sources.length === 1 ? segments.length : lastIndex + 1, 0, ...copies)
      return { ...previous, segments, flags: previous.flags?.filter(flag => flag.kind !== 'end') }
    })
    const ids = copies.map(copy => copy.id)
    setSelectedIds(ids); setSelected(ids[ids.length - 1]); setTool('select')
    flash(sources.length > 1 ? `已复制 ${copies.length} 个标注到下一行；新乐句待打点` : '已复制标注到下一行')
  }
  const splitSegment = (segment: Segment, part: number, event: React.PointerEvent<SVGGElement>) => {
    if (segment.partitionKey) { setNotice({ title: '这个分区需要使用“框内竖切”', description: '切换到整框高亮后，点击分区内部即可切开这一行。', primary: { label: '使用框内竖切', onClick: () => { changeHighlightMode('full'); setTool('cell-cut') } } }); return }
    if (part !== 0 || segmentRegions(segment).length > 1) { setNotice({ title: '暂时不能竖切包含多个框的乐句', description: '可以先调整已有框的位置，或另外画一个独立歌词框。', primary: { label: '调整已有框', onClick: chooseRegions }, secondary: { label: '画独立歌词框', onClick: () => setTool('row') } }); return }
    const rect = pageRef.current!.getBoundingClientRect()
    const pageX = (event.clientX - rect.left) / rect.width
    const position = (pageX - segment.region.x) / segment.region.width
    const minimum = Math.max(.03, 12 / (rect.width * segment.region.width))
    if (position <= minimum || position >= 1 - minimum) { setNotice({ title: '点击位置离边线太近', description: '请回到歌词框内部，在离左右边线稍远的位置点击。', closeLabel: '返回框内重试' }); return }
    const rightId = `segment-${Date.now()}-${Math.round(pageX * 1000)}`
    setProject(previous => {
      const index = previous.segments.findIndex(item => item.id === segment.id)
      if (index < 0) return previous
      const source = previous.segments[index]
      const boundary = source.region.x + source.region.width * position
      const provisionalTime = source.startTime + (source.endTime - source.startTime) * position
      const left: Segment = { ...source, region: { ...source.region, width: boundary - source.region.x }, endTime: provisionalTime, text: undefined }
      const right: Segment = { ...source, id: rightId, region: { ...source.region, x: boundary, width: source.region.x + source.region.width - boundary }, startTime: provisionalTime, text: undefined }
      const segments = [...previous.segments]
      segments.splice(index, 1, left, right)
      const flags = [...(previous.flags || [])]
      const markerIndex = flags.findIndex(flag => flag.segmentId === source.id && flag.kind !== 'end')
      if (markerIndex >= 0) {
        const transition: KaraokeFlag = { id: `flag-${rightId}`, time: provisionalTime, segmentId: rightId, kind: 'transition' }
        const endingIndex = flags.findIndex(flag => flag.segmentId === source.id && flag.kind === 'end')
        if (endingIndex >= 0) {
          flags[endingIndex] = { ...flags[endingIndex], segmentId: rightId }
          flags.splice(endingIndex, 0, transition)
        } else flags.splice(markerIndex + 1, 0, transition)
      }
      return { ...previous, segments, flags }
    })
    selectOne(rightId)
    flash('已分成两个独立标注；原有打点已保留')
  }
  const persistProject = async (snapshot: Project) => {
    localStorage.setItem('pujian-project', JSON.stringify(snapshot))
    if (snapshot.projectId) {
      const response = await fetch(`${API}/api/projects/${snapshot.projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })
      if (!response.ok) throw new Error('当前编辑内容暂存失败')
    }
  }
  const retrySave = async () => {
    let localSaved = false
    try {
      localStorage.setItem('pujian-project', JSON.stringify(projectRef.current)); localSaved = true; localSaveFailed.current = false
      await persistProject(projectRef.current)
      setSaveIssue(null); flash('当前更改已保存')
    } catch (error) {
      setSaveIssue(localSaved ? 'project' : 'local')
      fail('本次保存没有完成', localSaved ? '当前更改已保存在本机，但项目文件暂时没有保存成功。可以重试保存。' : '当前更改尚未保存。请先重试保存，暂时不要关闭软件。', error, { label: '重试保存', onClick: () => { void retrySave() } })
    }
  }
  const startAutoBoxes = async () => {
    if (boxBusy) return
    if (!project.pages.length) { setNotice({ title: '先添加歌谱，才能自动框选', description: '选择 PDF 或歌谱图片后，再查找歌词框。', primary: { label: '选择歌谱', onClick: chooseScore } }); return }
    setBoxBusy(true)
    setAnalysisProgress({ kind: 'boxes', percent: 0, stage: '正在准备乐谱' })
    const projectId = project.projectId
    try {
      const response = await fetch(`${API}/api/auto-boxes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: project.pages }) })
      const started = await response.json()
      if (!response.ok) throw new Error(typeof started.detail === 'string' ? started.detail : '自动框选失败')
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 600))
        const statusResponse = await fetch(`${API}/api/auto-boxes/${started.jobId}`)
        if (!statusResponse.ok) throw new Error('无法读取自动框选进度')
        const status = await statusResponse.json()
        if (projectRef.current.projectId !== projectId) return
        setAnalysisProgress({ kind: 'boxes', percent: status.progress || 0, stage: status.stage || '正在识别乐谱' })
        if (status.status === 'failed') throw new Error(status.error || '自动框选失败')
        if (status.status === 'completed') { setBoxCandidates(status.candidates || []); return }
      }
    } catch (error) { fail('自动框选没有完成', '可以重试识别，也可以直接手动画出歌词框。', error, { label: '重试自动框选', onClick: () => { void startAutoBoxes() } }, { label: '手动画歌词框', onClick: () => setTool('row') }) }
    finally { setBoxBusy(false); setAnalysisProgress(null) }
  }
  const applyAutoBoxes = (indices: number[], replace: boolean) => {
    if (!boxCandidates || !indices.length) return
    const chosen = indices.map(index => boxCandidates[index]).filter(Boolean)
    lastHistoryAt.current = 0
    setProject(previous => {
      const existing = replace ? [] : previous.segments
      const used = new Set<string>()
      const intersects = (a: Region, b: Region) => {
        const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
        return width * height / Math.max(.000001, Math.min(a.width * a.height, b.width * b.height))
      }
      const ordered = chosen.map((candidate, index): Segment => {
        const match = existing.find(segment => !used.has(segment.id) && segment.pageId === candidate.pageId && intersects(segment.region, candidate.region) > .45)
        if (match) { used.add(match.id); return match }
        return { id: `box-${Date.now()}-${index}`, pageId: candidate.pageId, region: fitRegion(candidate.region), startTime: index * 4, endTime: (index + 1) * 4, timingSet: false, direction: 'left-to-right' }
      })
      const unmatched = existing.filter(segment => !used.has(segment.id))
      const segments = !replace && previous.flags?.length
        ? [...existing, ...ordered.filter(segment => !used.has(segment.id))]
        : [...ordered, ...unmatched]
      return { ...previous, segments, flags: replace ? [] : previous.flags, partitions: replace ? [] : previous.partitions, spareTimings: replace ? [] : previous.spareTimings }
    })
    setBoxCandidates(null); selectOne(null); setTool('select')
    flash(`已应用 ${chosen.length} 个候选框；新标注时间可用打点校准`, undoAction)
  }
  const startAutoAlign = async () => {
    if (!project.projectId || !project.pages.length) { setNotice({ title: '先添加歌谱，才能自动对齐', description: '请先选择这首歌的歌谱。', primary: { label: '选择歌谱', onClick: chooseScore } }); return }
    if (!project.source.audioUrl) { setNotice({ title: '先添加音频，才能自动对齐', description: '请先选择这首歌对应的音频。', primary: { label: '选择音频', onClick: chooseAudio } }); return }
    if (autoBusy) return
    setAutoBusy(true); setAutoStage('正在准备自动对齐')
    setAnalysisProgress({ kind: 'align', percent: 0, stage: '正在准备自动对齐' })
    const projectId = project.projectId
    try {
      await persistProject(project)
      const response = await fetch(`${API}/api/projects/${projectId}/auto-align`, { method: 'POST' })
      const started = await response.json()
      if (!response.ok) throw new Error(typeof started.detail === 'string' ? started.detail : '无法启动自动对齐')
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 1200))
        const statusResponse = await fetch(`${API}/api/alignments/${started.jobId}`)
        if (!statusResponse.ok) throw new Error('无法读取自动对齐进度')
        const status = await statusResponse.json()
        if (projectRef.current.projectId !== projectId) return
        setAutoStage(status.stage || '正在处理')
        setAnalysisProgress({ kind: 'align', percent: status.progress || 0, stage: status.stage || '正在处理' })
        if (status.status === 'failed') throw new Error(status.error || '自动对齐失败')
        if (status.status === 'completed') { setAutoCandidates(status.candidates || []); return }
      }
    } catch (error) { fail('自动对齐没有完成', '可以重试，也可以播放音频，手动记录每句开始的位置。', error, { label: '重试自动对齐', onClick: () => { void startAutoAlign() } }, { label: '手动打点', onClick: () => flash('播放音频，唱到每句开始时点击“打点”') }) }
    finally { setAutoBusy(false); setAutoStage(''); setAnalysisProgress(null) }
  }
  const applyAutoCandidates = (indices: number[]) => {
    if (!autoCandidates) return
    const chosen = indices.map(index => autoCandidates[index]).filter(Boolean)
    if (!chosen.length) return
    const marked = new Set((project.flags || []).filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
    const actionable = chosen.filter(candidate => {
      const segment = project.segments.find(item => item.id === candidate.segmentId)
      return !segment || (!segment.timingSet && !marked.has(segment.id))
    })
    if (!actionable.length) {
      setAutoCandidates(null)
      setNotice({ title: '这些乐句已经设置过时间', description: '自动对齐只补充没有时间的乐句，因此这次没有改动。可以选中乐句，在右侧调整开始和结束时间。', tone: 'info', primary: { label: '选择乐句并检查时间', onClick: () => { if (highlightMode === 'full') setTool('line-edit'); else chooseRegions() } } })
      return
    }
    lastHistoryAt.current = 0
    setProject(previous => {
      const updates = new Map(actionable.filter(candidate => candidate.segmentId).map(candidate => [candidate.segmentId!, candidate]))
      const additions: Segment[] = actionable.filter(candidate => !candidate.segmentId || !previous.segments.some(segment => segment.id === candidate.segmentId)).map((candidate, index) => ({
        id: `auto-${Date.now()}-${index}`, pageId: candidate.pageId, region: fitRegion(candidate.region),
        startTime: candidate.startTime, endTime: candidate.endTime, timingSet: true,
        direction: 'left-to-right', text: candidate.text,
      }))
      return { ...previous, segments: [
        ...previous.segments.map(segment => {
          const candidate = updates.get(segment.id)
          return candidate ? { ...segment, text: candidate.text || segment.text, startTime: candidate.startTime, endTime: candidate.endTime, timingSet: true } : segment
        }), ...additions,
      ] }
    })
    setAutoCandidates(null); selectOne(null); setTool('select')
    flash(`已填入 ${actionable.length} 条乐句的时间；原有打点已保留`)
  }
  const openExport = async () => {
    audioRef.current?.pause(); setPlaying(false)
    if (!project.projectId) { setNotice({ title: '先添加歌谱，才能生成视频', description: '请选择歌谱和对应音频，完成分区与时间设置后再生成视频。', primary: { label: '选择歌谱', onClick: chooseScore } }); return }
    if (exportJob && (['queued', 'running'].includes(exportJob.status) || exportedInput.current === exportInput)) { setExportOpen(true); return }
    const settings = project.export || initialProject.export!
    setExportSettings(settings); setPreviewTime(time); setExportJob(null); setValidation(null); setValidationError(null); setPreviewError(false); setPreviewUrl(null); setExportOpen(true)
    await checkExport({ ...project, export: settings })
  }
  const checkExport = async (snapshot: Project = { ...project, export: exportSettings }) => {
    setValidationError(null); setValidation(null)
    try {
      await persistProject(snapshot)
      const response = await fetch(`${API}/api/projects/${snapshot.projectId}/validate`, { method: 'POST' })
      if (!response.ok) throw new Error('无法读取检查结果，请重试。')
      setValidation(await response.json())
    } catch (error) { setValidationError(error instanceof Error ? error.message : '无法检查导出条件') }
  }
  const fixExport = (error: string) => {
    setExportOpen(false)
    if (error.includes('音频')) { chooseAudio(); return }
    if (error.includes('导入乐谱')) { chooseScore(); return }
    if (error.includes('至少添加')) { beginRegions(); return }
    // Validation numbers refer to the backend's time-sorted list, not the score order.
    const number = error.match(/第\s*(\d+)\s*句/)
    const segment = number ? [...project.segments].sort((a, b) => a.startTime - b.startTime)[Number(number[1]) - 1] : undefined
    if (segment) {
      selectOne(segment.id)
      const index = project.pages.findIndex(p => p.id === segment.pageId)
      if (index >= 0) setActivePage(index)
      setTool(highlightMode === 'full' ? 'line-edit' : 'select')
      flash('已选中需要修改的乐句，请在右侧调整时间或标注')
      setInspectorOpen(true); window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-segment-id="${segment.id}"]`)?.focus(), 0)
    }
  }
  const startVideoExport = async () => {
    if (!project.projectId || exportBusy) return
    setExportBusy(true); setValidationError(null)
    try {
      let outputDirectory: string | undefined
      let outputPath: string | undefined
      const chooser = window.pywebview?.api?.choose_export_directory
      const fileChooser = window.pywebview?.api?.choose_export_file
      if (fileChooser) {
        const selected = await fileChooser(`${project.projectName || '歌谱视频'}.mp4`)
        if (!selected) { setExportBusy(false); return }
        outputPath = selected
      } else if (chooser) {
        const selected = await chooser()
        if (!selected) { setExportBusy(false); return }
        outputDirectory = selected
      }
      setExportJob(null); setValidation(null)
      const snapshot: Project = { ...project, export: exportSettings }
      setProject(snapshot)
      await persistProject(snapshot)
      const reportResponse = await fetch(`${API}/api/projects/${project.projectId}/validate`, { method: 'POST' })
      if (!reportResponse.ok) throw new Error('无法检查导出条件，请重新检查。')
      const report = await reportResponse.json(); setValidation(report)
      if (!report.valid) { setExportBusy(false); return }
      const response = await fetch(`${API}/api/projects/${project.projectId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...exportSettings, outputDirectory, outputPath }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail?.errors?.join('；') || data.detail || '无法开始导出')
      exportedInput.current = JSON.stringify(snapshot)
      setExportJob({ ...data, progress: 0 })
    } catch (error) { setExportBusy(false); setValidationError(error instanceof Error ? error.message : '视频没有开始生成，请重试。') }
  }
  const pointerPosition = (event: React.PointerEvent) => {
    const rect = pageRef.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const rowRegion = (origin: { x: number; y: number }, point: { x: number; y: number }): Region =>
    fitRegion({ x: Math.min(.995, Math.min(origin.x, point.x)), y: Math.min(.995, Math.min(origin.y, point.y)), width: Math.max(.005, Math.abs(point.x - origin.x)), height: Math.max(.005, Math.abs(point.y - origin.y)) })
  const pagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPage || (tool !== 'row' && tool !== 'select')) return
    event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    const point = pointerPosition(event)
    if (tool === 'select') { marqueeRef.current = point; setMarquee(null); return }
    draftRef.current = point; setIsDrawing(true)
    setDraft(rowRegion(point, point))
  }
  const pagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointerPosition(event)
    if (isDrawing && draftRef.current) {
      const origin = draftRef.current
      setDraft(rowRegion(origin, point))
    }
    if (marqueeRef.current) {
      const origin = marqueeRef.current
      setMarquee({ x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y), width: Math.abs(point.x - origin.x), height: Math.abs(point.y - origin.y) })
    }
    if (dragRef.current) {
      const drag = dragRef.current; const rect = pageRef.current!.getBoundingClientRect(); const dx = (event.clientX - drag.startX) / rect.width; const dy = (event.clientY - drag.startY) / rect.height
      let region = { ...drag.region }
      if (drag.kind === 'move') {
        region.x = Math.max(0, Math.min(1 - region.width, region.x + dx))
        region.y = Math.max(0, Math.min(1 - region.height, region.y + dy))
      } else {
        const edge = drag.edge || 'se'
        const minimum = .005
        let left = region.x; let top = region.y
        let right = left + region.width; let bottom = top + region.height
        if (edge.includes('w')) left = Math.max(0, Math.min(right - minimum, left + dx))
        if (edge.includes('e')) right = Math.min(1, Math.max(left + minimum, right + dx))
        if (edge.includes('n')) top = Math.max(0, Math.min(bottom - minimum, top + dy))
        if (edge.includes('s')) bottom = Math.min(1, Math.max(top + minimum, bottom + dy))
        region = { x: left, y: top, width: right - left, height: bottom - top }
      }
      updateSegmentRegion(drag.id, drag.part, region)
    }
  }
  const pagePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDrawing && draftRef.current && tool === 'row' && event.type !== 'pointercancel') {
      const origin = draftRef.current
      const point = pointerPosition(event)
      const pageRect = pageRef.current!.getBoundingClientRect()
      const moved = Math.hypot((point.x - origin.x) * pageRect.width, (point.y - origin.y) * pageRect.height) >= 3
      const region = moved ? rowRegion(origin, point) : fitRegion({ x: Math.min(.995, origin.x), y: Math.min(.995, origin.y), width: .16, height: .035 })
      createSegment(region)
      flash('已添加标注；可继续画框，或用竖切分成多个框')
    }
    if (marqueeRef.current) {
      const origin = marqueeRef.current
      const point = pointerPosition(event)
      const bounds = { x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y), width: Math.abs(point.x - origin.x), height: Math.abs(point.y - origin.y) }
      if (bounds.width > .005 && bounds.height > .005) {
        const ids = project.segments.filter(segment => segmentRegions(segment).some(item => item.pageId === currentPage?.id &&
          item.region.x < bounds.x + bounds.width && item.region.x + item.region.width > bounds.x &&
          item.region.y < bounds.y + bounds.height && item.region.y + item.region.height > bounds.y)).map(segment => segment.id)
        setSelectedIds(ids); setSelected(ids[ids.length - 1] || null)
      } else selectOne(null)
    }
    marqueeRef.current = null; setMarquee(null)
    setIsDrawing(false); draftRef.current = null; setDraft(null); dragRef.current = null
  }
  const startResize = (event: React.PointerEvent<SVGRectElement>, segment: Segment, part: number, edge: string) => {
    event.stopPropagation()
    dragRef.current = { id: segment.id, part, kind: 'resize', edge, startX: event.clientX, startY: event.clientY, region: { ...segmentRegions(segment)[part].region } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const importControls = <>
    <input ref={scoreInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp" aria-label="选择新项目歌谱" hidden onChange={e => { void onScore(e.target.files); e.currentTarget.value = '' }}/>
    <input ref={moreScoreInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp" aria-label="更多歌谱" multiple hidden onChange={e => { void onScore(e.target.files, 'append'); e.currentTarget.value = '' }}/>
    <input ref={audioInput} type="file" accept="audio/mpeg,audio/mp3,.mp3,audio/wav,.wav,audio/mp4,.m4a,audio/ogg,.ogg" hidden onChange={e => { void onAudio(e.target.files?.[0]); e.currentTarget.value = '' }}/>
    <audio ref={audioRef} src={audioUrl || project.source.audioUrl || undefined} onLoadedMetadata={e => { const next = e.currentTarget.duration; setDuration(next); setProject(p => ({ ...p, audioDuration: next })) }} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}/>
  </>
  const hasScore = project.pages.length > 0 && Boolean(project.source.pdf)
  const hasAudio = Boolean(project.source.audio && project.source.audioUrl)
  const updateControl = <DesktopUpdate busy={autoBusy || boxBusy || exportBusy || scoreImporting || audioImporting || duplicateBusy}
    save={() => localStorage.setItem('pujian-project', JSON.stringify(projectRef.current))}/>
  const feedback = <>
    {saveIssue && <div className="feedback-panel feedback-error save-feedback" role="alert"><strong>{saveIssue === 'local' ? '当前更改尚未保存' : '项目文件暂时没有保存成功'}</strong><p>{saveIssue === 'local' ? '请先重试保存，暂时不要关闭软件。' : '当前更改已保存在本机，可以重试保存项目文件。'}</p><button className="button button-primary" onClick={() => { void retrySave() }}>重试保存</button></div>}
    {notice && <ActionDialog notice={notice} onClose={() => setNotice(null)}/>}
    {message && <div className="toast" role="status"><Check size={22}/><span>{message.text}</span>{message.action && <button onClick={message.action.onClick}>{message.action.label}</button>}<button className="toast-close" aria-label="关闭通知" onClick={() => setMessage(null)}><X size={20}/></button></div>}
  </>
  const dropDisabled = scoreImporting || audioImporting || autoBusy || boxBusy || exportBusy || duplicateBusy
  const deletePageControl = hasScore && project.pages.length > 1 && <button className="button score-delete" title="删除当前页歌谱" disabled={dropDisabled} onClick={requestScoreRemoval}>删本页</button>
  const moreScoreControl = <button className="button" onClick={chooseMoreScores} disabled={dropDisabled}>更多歌谱</button>
  const pageNavigation = <>{project.pages.length > 1 && <nav className="score-page-nav" aria-label="歌谱翻页" data-page-count={project.pages.length} data-page-index={Math.min(activePage, project.pages.length - 1)}>
    <button className="button button-secondary" aria-label="上一页歌谱" disabled={activePage === 0} onClick={() => { setActivePage(page => page - 1); selectOne(null) }}>上一页</button>
    <span aria-live="polite">{Math.min(activePage + 1, project.pages.length)} / {project.pages.length}</span>
    <button className="button button-secondary" aria-label="下一页歌谱" disabled={activePage >= project.pages.length - 1} onClick={() => { setActivePage(page => page + 1); selectOne(null) }}>下一页</button>
  </nav>}{deletePageControl}</>
  if (!hasScore || !hasAudio) return <FileDropZone disabled={dropDisabled} onFiles={importDroppedFiles}>
    <HomeImportView scoreName={hasScore ? fileName(project.source.pdf) : null} audioName={hasAudio ? fileName(project.source.audio) : null} scoreImporting={scoreImporting} audioImporting={audioImporting} onChooseScore={chooseScore} onChooseAudio={chooseAudio}/>
    {importControls}
    <div className="home-update">{deletePageControl}<button className="button button-secondary" disabled={!undoHistory.current.length} onClick={undoProject}>撤销</button><button className="button button-secondary" disabled={!redoHistory.current.length} onClick={redoProject}>重做</button><DisplaySize value={textSize} onChange={setTextSize}/>{updateControl}</div>
    {feedback}
  </FileDropZone>

  return <FileDropZone disabled={dropDisabled} onFiles={importDroppedFiles}><div className="app-shell">
    <header className="topbar">
      <div className="topbar-left"><div className="brand"><div className="brand-mark"><Music2 size={17} strokeWidth={2.4} /></div><span>谱间</span><span className="brand-divider"/><span className="product-label">歌谱同步工作台</span></div><div className="highlight-mode-control" role="group" aria-label="文字高亮方式"><span>高亮</span><button type="button" aria-pressed={highlightMode === 'wipe'} title="播放时从左到右逐渐高亮文字" onClick={() => changeHighlightMode('wipe')}>从左到右</button><button type="button" aria-pressed={highlightMode === 'full'} title="乐句开始时整框高亮，直到下一句开始" onClick={() => changeHighlightMode('full')}>整框</button></div><div className="workspace-controls"><button className="file-chip" aria-label="歌谱" title={project.source.pdf ? `选择一个歌谱文件开始新项目，当前为：${project.source.pdf}` : '选择歌谱'} onClick={chooseScore}><FileImage size={20}/><span>歌谱</span></button><button className="file-chip" aria-label="音频" title={project.source.audio ? `点击重新选择音频：${project.source.audio}` : '选择音频'} onClick={chooseAudio}><FileAudio2 size={20}/><span>音频</span></button><button className="button button-secondary inspector-toggle" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(open => !open)}>{inspectorOpen ? '收起乐句设置' : '乐句设置'}</button></div></div>
      <div className="top-actions"><DisplaySize value={textSize} onChange={setTextSize}/>{updateControl}<button className="button button-secondary history-button" title="撤销（Ctrl+Z）" disabled={!undoHistory.current.length} onClick={undoProject}><Undo2 size={22}/>撤销</button><button className="button button-secondary history-button" title="重做（Ctrl+Shift+Z）" disabled={!redoHistory.current.length} onClick={redoProject}><Redo2 size={22}/>重做</button><button className="button button-primary" onClick={openExport}><Upload size={15}/>导出视频</button></div>
    </header>
    <div className={`main-layout ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`} style={{ '--timeline-height': `${timelineHeight}px` } as CSSProperties}>
      <main className="workspace">
        {highlightMode === 'full' ? <div className="segmentation-toolbar partition-toolbar">
          <button className={`button selection-tool ${partitionTool === 'line-edit' ? 'button-active' : 'button-quiet'}`} aria-label="选择工具" title="选择、移动分隔线；选中后按 Backspace 删除" aria-pressed={partitionTool === 'line-edit'} onClick={() => requestPartitionTool('line-edit')}><Pointer size={24} aria-hidden="true"/></button>
          <span>直线分区</span>
          {([['line-h', '整页横线'], ['line-v', '整页竖线'], ['cell-cut', '框内竖切']] as const).map(([value, label]) =>
            <button key={value} className={`button compact ${partitionTool === value ? 'button-active' : 'button-quiet'}`} aria-pressed={partitionTool === value} onClick={() => requestPartitionTool(value)}>{label}</button>)}
          <button className={`button ${tool === 'number' ? 'button-active' : 'button-secondary'}`} aria-pressed={tool === 'number'} onClick={startNumbering}>编号</button>
          <div className="score-tool-actions"><ToolMenu>{moreScoreControl}{invertControl}{colorControl}<button className="button" onClick={requestLyricOrder}>自动编号</button><button className="button" disabled={!project.segments.some(segment => segment.pageId === currentPage?.id && segment.partitionKey)} onClick={restartNumbering}>重新编号</button><button className="button reset-toolbar" disabled={!project.segments.length && !project.partitions?.some(item => item.horizontal.length || item.vertical.length)} onClick={() => setResetOpen(true)}>重新分区</button></ToolMenu>{pageNavigation}</div>
        </div> : <div className="segmentation-toolbar">
          <button className={`button selection-tool ${tool === 'select' ? 'button-active' : 'button-quiet'}`} aria-label="选择工具" title="选择乐句" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Pointer size={24} aria-hidden="true"/></button>
          <span>歌词框</span>
          <button className={`button ${tool === 'row' ? 'button-active' : 'button-quiet'}`} title="添加标注（N）" aria-pressed={tool === 'row'} onClick={() => setTool(tool === 'row' ? 'select' : 'row')}><span className="horizontal-line-icon"/>添加标注</button>
          <button className={`button ${tool === 'cut' ? 'button-active' : 'button-quiet'}`} aria-pressed={tool === 'cut'} onClick={() => setTool(tool === 'cut' ? 'select' : 'cut')}><span className="vertical-line-icon"/>竖切成框</button>
          <div className="score-tool-actions"><ToolMenu>{moreScoreControl}{invertControl}{colorControl}
            <button className="button" disabled={boxBusy || !project.pages.length} onClick={() => void startAutoBoxes()}>{boxBusy ? '正在框选' : '自动框选'}</button>
            <button className="button" disabled={duplicateBusy} onClick={() => void duplicateBelow()}>{duplicateBusy ? '正在复制' : '复制到下一行'}</button>
            <button className="button" onClick={mergeSelected}>合并乐句{selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}</button>
            <button className="button" disabled={autoBusy} onClick={() => void startAutoAlign()}>{autoBusy ? '正在对齐' : '自动对齐'}</button>
            <button className="button reset-toolbar" disabled={!project.segments.length && !(project.flags || []).length} onClick={() => setResetOpen(true)}>重新标注</button>
          </ToolMenu>{pageNavigation}</div>
          {(autoBusy || boxBusy) && <div className="tool-instruction">{autoBusy ? autoStage : '正在查找歌词行和明显留白'}</div>}
        </div>}

        <div className="canvas-area" ref={canvasRef}>
          {currentPage ? <div className="page-frame" key={currentPage.id} style={{ width: zoom === null ? '100%' : `${Math.round(510 * zoom)}px`, maxWidth: zoom === null ? 'min(960px, calc(100% - 12px))' : undefined }}><div ref={pageRef} className={`score-page ${tool === 'row' ? 'drawing' : ''} ${tool === 'cut' ? 'anchoring' : ''} ${tool === 'select' ? 'marquee-mode' : ''} ${playing ? 'previewing' : ''} ${highlightMode === 'full' ? 'partition-mode' : ''}`} style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }} onPointerDown={pagePointerDown} onPointerMove={pagePointerMove} onPointerUp={pagePointerUp} onPointerCancel={pagePointerUp}>
              <img src={currentPage.image.startsWith('data:') || currentPage.image.startsWith('blob:') ? currentPage.image : currentPage.image} alt={`乐谱第 ${activePage + 1} 页`} style={{ filter: currentPage.inverted ? 'invert(1)' : undefined }} draggable={false}/>
              <svg className="annotation-layer" viewBox="0 0 1000 1414" preserveAspectRatio="none">
                <defs>
                  <filter id="ink-recolor" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={`0 0 0 0 ${tintChannels[0]}  0 0 0 0 ${tintChannels[1]}  0 0 0 0 ${tintChannels[2]}  ${currentPage.inverted ? '1.6667 1.6667 1.6667 0 -1' : '-1.6667 -1.6667 -1.6667 0 4'}`}/></filter>
                  <clipPath id="ink-reveal">{activeRegions.map((item, index) => item.pageId === currentPage.id && <rect key={index} x={item.region.x * 1000} y={item.region.y * 1414} width={item.region.width * activeReveal[index] * 1000} height={item.region.height * 1414}/>)}</clipPath>
                </defs>
                {activeRegions.some(item => item.pageId === currentPage.id) && progress > 0 && <image href={currentPage.image} x="0" y="0" width="1000" height="1414" preserveAspectRatio="none" filter="url(#ink-recolor)" clipPath="url(#ink-reveal)" pointerEvents="none"/>}
                {highlightMode === 'full' && !playing && <PartitionEditor key={currentPage.id} partition={pagePartition} tool={partitionTool} blocked={needsFreshPartition} selectedLine={selectedLine}
                  segments={project.segments.filter(segment => segment.pageId === currentPage.id)} onChange={changePartition}
                  onNumber={assignNumber}
                  onLine={setSelectedLine} onSegment={selectOne} onMessage={flash} onBlocked={() => explainPartitionConflict(partitionTool)} onInvalidCut={() => setNotice({ title: '这里还不能画框内竖线', description: '请点击由上、下、左、右四条边围成的分区内部，并避开左右边线。还没形成分区时，先画横线和左右两条整页竖线。', primary: { label: '画横线', onClick: () => requestPartitionTool('line-h') }, secondary: { label: '画整页竖线', onClick: () => requestPartitionTool('line-v') } })} onLegacyCut={(segment, event) => splitSegment(segment, 0, event)}/>}
                {project.segments.flatMap(seg => segmentRegions(seg).map((item, part) => ({ seg, item, part })).filter(entry => entry.item.pageId === currentPage.id)).sort((a, b) => Number(selectedIds.includes(a.seg.id)) - Number(selectedIds.includes(b.seg.id))).map(({ seg, item, part }) => { const r = item.region; const matching = project.segments.filter(candidate => sharedRegionKey(candidate) === sharedRegionKey(seg)); const repeatIndex = matching.findIndex(candidate => candidate.id === seg.id); const x = r.x * 1000; const y = r.y * 1414; const badgeX = x + (x + 68 <= 1000 ? repeatIndex % 2 * 36 : -(repeatIndex % 2) * 36); const badgeY = Math.max(2, y - 29 - Math.floor(repeatIndex / 2) * 26); return <g key={`${seg.id}-${part}`} data-score-id={seg.id} data-partition-key={seg.partitionKey} className={`annotation ${selectedIds.includes(seg.id) ? 'is-selected' : ''}`} onPointerDown={e => { if (highlightMode === 'full') return; e.stopPropagation(); if (e.shiftKey) { selectSegment(seg.id, true); return }; const wasSelected = selectedIds.includes(seg.id); selectSegment(seg.id, false); if (tool === 'row') return; if (tool === 'cut') { splitSegment(seg, part, e); return }; if (seg.partitionKey || !wasSelected) return; dragRef.current = { id: seg.id, part, kind: 'move', startX: e.clientX, startY: e.clientY, region: { ...r } }; (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId) }}>
                  <rect className="region-hit-area" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  <rect className="region-outline" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  {editingNumber?.id === seg.id && editingNumber.part === part
                    ? <foreignObject className="region-number-editor" x={badgeX} y={badgeY} width="34" height="24" onPointerDown={event => event.stopPropagation()}>
                        <input ref={numberInputRef} type="text" inputMode="numeric" aria-label="乐句的新序号" value={editingNumber.value} onChange={event => { replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: event.target.value.replace(/\D/g, '') }) }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commitNumberEdit() } else if (event.key === 'Escape') { cancelNumberEdit.current = true; setEditingNumber(null) } else if (replaceNumberOnKey.current && /^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: event.key }) } else if (replaceNumberOnKey.current && (event.key === 'Backspace' || event.key === 'Delete')) { event.preventDefault(); replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: '' }) } else if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') replaceNumberOnKey.current = false }} onBlur={commitNumberEdit}/>
                      </foreignObject>
                    : <g className="region-number" transform={`translate(${badgeX},${badgeY})`} onPointerDown={event => { event.stopPropagation(); selectSegment(seg.id, event.shiftKey) }} onDoubleClick={event => { event.stopPropagation(); if (event.shiftKey) return; cancelNumberEdit.current = false; replaceNumberOnKey.current = true; setEditingNumber({ id: seg.id, part, value: String(project.segments.indexOf(seg) + 1) }) }}><title>双击修改乐句序号</title><rect className="region-number-bg" width="34" height="24" rx="5"/><text className="region-number-text" x="17" y="17" textAnchor="middle">{String(project.segments.indexOf(seg) + 1).padStart(2, '0')}</text></g>}
                  {highlightMode !== 'full' && !seg.partitionKey && selected === seg.id && (['n', 's', 'w', 'e'] as const).map(edge => {
                    const x = r.x * 1000; const y = r.y * 1414
                    const width = r.width * 1000; const height = r.height * 1414
                    const hit = Math.min(14, Math.max(5, Math.min(width, height) / 3))
                    return <rect key={edge} className={`resize-edge edge-${edge}`} x={edge === 'e' ? x + width - hit / 2 : edge === 'w' ? x - hit / 2 : x} y={edge === 's' ? y + height - hit / 2 : edge === 'n' ? y - hit / 2 : y} width={edge === 'n' || edge === 's' ? width : hit} height={edge === 'w' || edge === 'e' ? height : hit} onPointerDown={e => startResize(e, seg, part, edge)}/>
                  })}
                  {highlightMode !== 'full' && !seg.partitionKey && selected === seg.id && (['nw', 'ne', 'se', 'sw'] as const).map(edge => {
                    const x = (r.x + (edge.includes('w') ? 0 : edge.includes('e') ? r.width : r.width / 2)) * 1000
                    const y = (r.y + (edge.includes('n') ? 0 : edge.includes('s') ? r.height : r.height / 2)) * 1414
                    return <rect key={edge} className={`resize-handle edge-${edge}`} x={x - 8} y={y - 8} width="16" height="16" rx="3" onPointerDown={e => startResize(e, seg, part, edge)}/>
                  })}
                </g> })}
                {draft && <rect className="draft-region" x={draft.x * 1000} y={draft.y * 1414} width={draft.width * 1000} height={draft.height * 1414} rx="4"/>}
                {marquee && <rect className="marquee-region" x={marquee.x * 1000} y={marquee.y * 1414} width={marquee.width * 1000} height={marquee.height * 1414}/>}
              </svg>
            </div></div> : <div className="empty-workspace"><div className="empty-art"><div className="music-note note-a">♪</div><div className="music-note note-b">♫</div><div className="empty-paper"><div className="paper-lines">𝅘𝅥𝅮　1 2 3 5　|　6 — 5 3<br/>　小 星 星　　亮 晶 晶</div><div className="paper-highlight"/></div><div className="upload-orbit"><ImagePlus size={20}/></div></div><div className="empty-copy"><span className="eyebrow">从乐谱开始</span><h1>让每一句歌，都有自己的节奏</h1><p>导入 PDF 或 JPG、PNG、WebP 乐谱，再选择音频，<br/>逐行标注歌词位置并校准播放时间。</p></div><p className="empty-start-note">在上方工具栏选择歌谱和音频即可开始</p><div className="supported-note"><span className="check-mini"><Check size={11}/></span>页面按原始尺寸渲染，标注坐标随缩放保持准确</div></div>}
        </div>
      </main>
      {inspectorOpen && <InspectorPanel project={project} selected={selected} selectedCount={selectedIds.length} timed={timedIds} full={highlightMode === 'full'} currentTime={time} orderDraft={orderDraft} mergeTarget={mergeTarget}
        onClose={() => setInspectorOpen(false)} onOrderDraft={setOrderDraft} onMoveOrder={moveSegmentTo} onMergeTarget={setMergeTarget} onMerge={mergeSegments} onTime={commitTime} onSeek={seek} onReverse={reverseSegmentRegions} onRepeat={repeatSelectedRegions} onDelete={deleteSegment}/>}

      <TimelineDivider height={timelineHeight} onChange={setTimelineHeight}/>

      <TimelinePanel controls={<div className="transport-panel">
        <div className="transport-left"><button className="play-button" onClick={togglePlay} aria-label={playing ? '暂停播放' : '播放音频'}>{playing ? <Pause size={24}/> : <Play size={24}/>}<span>{playing ? '暂停' : '播放'}</span></button>
          <button className="flag-button" onClick={addFlag}><Flag size={24}/><strong>打点</strong><span className="next-flag">{nextFlagDescription}</span></button>
          <div className="transport-time"><strong>{formatTime(time)}</strong><span>/ {formatTime(duration || project.audioDuration || 0)}</span></div>
        </div>
        <div className="transport-right"><label className="speed-control"><span>播放速度</span><select aria-label="播放速度" defaultValue="1" onChange={e => { if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value) }}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1.0×</option><option value="1.25">1.25×</option></select></label></div>
        {pointFeedback && <div className={`point-feedback ${pointFeedback.warning ? 'point-warning' : ''}`} role="status" aria-live="polite">{pointFeedback.text}</div>}
      </div>} audioUrl={project.source.audioUrl} audioName={project.source.audio} duration={duration || project.audioDuration || 0} flags={visibleFlags} segments={project.segments} selected={selected} time={time} playing={playing} onSelect={id => { selectOne(id); const pageIndex = project.pages.findIndex(page => page.id === project.segments.find(segment => segment.id === id)?.pageId); if (pageIndex >= 0) setActivePage(pageIndex) }} onSeek={seek} onChooseAudio={chooseAudio} highlightMode={highlightMode} spareTimings={project.spareTimings} onMoveSegment={moveTimelineSegment} onDeleteTiming={deleteTimelineSegment} onInsertTiming={insertTimelineSegment}/>
    </div>
    {lyricOrderOpen && currentPage && <LyricOrderDialog project={project} partition={pagePartition} page={currentPage} onClose={() => setLyricOrderOpen(false)} onApply={applyLyricOrder}/>}
    {resetOpen && <ActionDialog notice={{
      title: highlightMode === 'full' ? '清空现有标注，重新分区？' : '清空现有标注，重新标注？',
      description: `将清空这首歌所有页面的分隔线、${project.segments.length} 条乐句和 ${(project.flags || []).length} 个打点。歌谱与音频会保留。清空后可点击通知中的“撤销上一步”恢复。`,
      closeLabel: '保留现有标注', primary: { label: highlightMode === 'full' ? '清空并重新分区' : '清空并重新标注', danger: true, onClick: resetAnnotations },
    }} onClose={() => setResetOpen(false)}/>}
    {analysisProgress && <ProgressDialog key={analysisProgress.kind} kind={analysisProgress.kind} percent={analysisProgress.percent} stage={analysisProgress.stage}/>}
    {autoCandidates && <AutoAlignDialog candidates={autoCandidates} existingCount={project.segments.length} playing={playing} onClose={() => setAutoCandidates(null)} onListen={at => playAudio(at)} onPause={() => { audioRef.current?.pause(); setPlaying(false) }} onApply={applyAutoCandidates} onManual={() => { setAutoCandidates(null); flash('播放音频，唱到每句开始时点击“打点”') }}/>}
    {boxCandidates && <AutoBoxDialog pages={project.pages} candidates={boxCandidates} existingCount={project.segments.length} onClose={() => setBoxCandidates(null)} onApply={applyAutoBoxes} onManual={() => { setBoxCandidates(null); setTool('row') }}/>}
    {importControls}{feedback}
    {colorOpen && <HighlightColorDialog value={highlightColor} onClose={() => setColorOpen(false)} onApply={color => { lastHistoryAt.current = 0; setProject(previous => ({ ...previous, highlight: { ...previous.highlight, color } })); setColorOpen(false) }}/>}
    {exportOpen && <ExportDialog audioUrl={project.source.audioUrl} playing={previewPlaying} onPlaying={setPreviewPlaying} settings={exportSettings} previewUrl={previewUrl} previewTime={previewTime} duration={duration || project.audioDuration || 0} validation={validation} job={exportJob} busy={exportBusy} validationError={validationError} previewError={previewError} onRetryPreview={() => setPreviewRetry(n => n + 1)} onRecheck={() => { void checkExport() }} onFix={fixExport} onSettings={settings => setExportSettings(settings)} onPreviewTime={setPreviewTime} onExport={() => { void startVideoExport() }} onClose={() => { setPreviewPlaying(false); setExportOpen(false) }}/>}
  </div></FileDropZone>
}

export default App
