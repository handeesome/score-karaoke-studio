import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileAudio2, FileImage, FileVideo2, Flag, ImagePlus, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Redo2, RotateCcw, Scissors, Settings2, Sparkles, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { AutoBoxCandidate, AutoCandidate, ExportSettings, KaraokeFlag, Project, Region, ScorePage, Segment } from './types'
import ExportDialog from './components/ExportDialog'
import AutoAlignDialog from './components/AutoAlignDialog'
import TimelinePanel from './components/TimelinePanel'
import AutoBoxDialog from './components/AutoBoxDialog'
import ProgressDialog from './components/ProgressDialog'
import { initialProject } from './types'
import { bindTimingToScoreOrder, calculateCameraTarget, calculateKaraokeProgress, fitRegion, formatTime, migrateLegacyCuts, recoverFlagsFromTiming, regionPositionKey, regionReveal, segmentRegions, sharedRegionKey } from './utils'

const API = ''
function App() {
  const [project, setProjectState] = useState<Project>(() => {
    try {
      const loaded = recoverFlagsFromTiming(migrateLegacyCuts({ ...initialProject, ...JSON.parse(localStorage.getItem('pujian-project') || '{}') }))
      return loaded.scoreTimingBound ? loaded : bindTimingToScoreOrder(loaded)
    } catch { return initialProject }
  })
  const [activePage, setActivePage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [orderDraft, setOrderDraft] = useState<string | null>(null)
  const [editingNumber, setEditingNumber] = useState<{ id: string; part: number; value: string } | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSettings, setExportSettings] = useState<ExportSettings>(initialProject.export!)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [exportJob, setExportJob] = useState<{ jobId: string; status: string; progress: number; warnings?: string[]; downloadUrl?: string | null; error?: string } | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoStage, setAutoStage] = useState('')
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[] | null>(null)
  const [boxCandidates, setBoxCandidates] = useState<AutoBoxCandidate[] | null>(null)
  const [boxBusy, setBoxBusy] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<{ kind: 'boxes' | 'align'; percent: number; stage: string } | null>(null)
  const [tool, setTool] = useState<'select' | 'row' | 'cut'>('select')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const scoreInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
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
  }
  const redoProject = () => {
    const next = redoHistory.current.pop()
    if (!next) return
    undoHistory.current.push(projectRef.current)
    projectRef.current = next
    lastHistoryAt.current = 0
    setProjectState(next)
  }

  useEffect(() => { localStorage.setItem('pujian-project', JSON.stringify(project)) }, [project])
  useEffect(() => { setOrderDraft(null) }, [selected])
  useEffect(() => { numberInputRef.current?.focus() }, [editingNumber?.id, editingNumber?.part])
  useEffect(() => {
    const repaired = recoverFlagsFromTiming(project)
    if (repaired !== project) setProject(repaired)
  }, [project])
  useEffect(() => {
    if (!project.projectId) return
    const timer = window.setTimeout(() => {
      fetch(`${API}/api/projects/${project.projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }).catch(() => {})
    }, 700)
    return () => window.clearTimeout(timer)
  }, [project])
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current) }, [])
  useEffect(() => { if (project.export) setExportSettings(project.export) }, [project.export])
  useEffect(() => { if (!audioUrl && project.source.audioUrl && audioRef.current) audioRef.current.src = project.source.audioUrl }, [project.source.audioUrl, audioUrl])
  const currentPage: ScorePage | undefined = project.pages[activePage]
  const visibleFlags = recoverFlagsFromTiming(project).flags || []
  const timedIds = new Set(visibleFlags.filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
  const highlightMode = project.highlight?.mode === 'full' ? 'full' : 'wipe'
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
  const activeRegions = activeSegment ? segmentRegions(activeSegment) : []
  const activeReveal = highlightMode === 'full' ? activeRegions.map(() => 1) : regionReveal(activeRegions, progress)
  const unfinishedPart = activeReveal.findIndex(value => value < 1)
  const activePart = highlightMode === 'full' ? 0 : unfinishedPart >= 0 ? unfinishedPart : Math.max(0, activeRegions.length - 1)
  const fileName = (name: string | null) => name ? name.replace(/\.[^.]+$/, '') : null
  const changeHighlightMode = (mode: 'wipe' | 'full') => setProject(current => ({
    ...current, highlight: { ...current.highlight, mode },
  }))
  const changeZoom = (step: number) => setZoom(current => {
    const automatic = (canvasRef.current?.clientWidth || window.innerWidth * .7) * .58 / 510
    return Math.max(.45, Math.min(2.5, +((current ?? automatic) + step).toFixed(2)))
  })

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
          if (next.status === 'completed') { setExportBusy(false); flash('视频已导出完成'); return }
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
    if (!exportOpen || !project.projectId) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams({ time: String(previewTime), width: String(exportSettings.width), height: String(exportSettings.height), scoreZoom: String(exportSettings.scoreZoom) })
      try {
        const response = await fetch(`${API}/api/projects/${project.projectId}/preview?${query}`, { signal: controller.signal })
        if (!response.ok) return
        const nextUrl = URL.createObjectURL(await response.blob())
        if (controller.signal.aborted) { URL.revokeObjectURL(nextUrl); return }
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = nextUrl; setPreviewUrl(nextUrl)
      } catch { /* the preview will retry when settings change */ }
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [exportOpen, project.projectId, previewTime, exportSettings.width, exportSettings.height, exportSettings.scoreZoom])

  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2400) }
  const selectOne = (id: string | null) => { setSelected(id); setSelectedIds(id ? [id] : []); setMergeTarget(null); setOrderDraft(null) }
  const selectSegment = (id: string, additive: boolean) => {
    if (!additive) { selectOne(id); return }
    const ids = selectedIds.includes(id) ? selectedIds.filter(selectedId => selectedId !== id) : [...selectedIds, id]
    setSelectedIds(ids); setSelected(ids[ids.length - 1] || null)
  }
  const moveSegmentTo = (id: string, positionText: string) => {
    const position = Number(positionText)
    if (!/^\d+$/.test(positionText) || !Number.isInteger(position) || position < 1 || position > project.segments.length) {
      flash(`请输入 1 到 ${project.segments.length} 的乐句序号`)
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
      return bindTimingToScoreOrder({ ...previous, segments: reordered })
    })
    setOrderDraft(null)
    flash(`已移到乐句 ${String(position).padStart(2, '0')}；原有时间和打点按序号保留`)
  }
  const updateSegment = (id: string, patch: Partial<Segment>) => setProject(p => {
    const changedTime = patch.startTime !== undefined || patch.endTime !== undefined
    const next = { ...p, segments: p.segments.map(s => s.id === id ? { ...s, ...patch, ...(changedTime ? { timingSet: true } : {}) } : s) }
    return next
  })
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
    setProject(p => {
      const segments = p.segments.filter(s => s.id !== id)
      const flags = p.flags?.filter(flag => flag.segmentId !== id)
        .map((flag, index) => index === 0 ? { ...flag, kind: 'start' as const } : flag)
      return { ...p, segments, flags }
    })
    selectOne(null); setTool('select')
    flash('标注已删除；其余乐句的打点已保留，可按 Ctrl+Z 撤销')
  }
  const onScore = async (selection?: FileList | null) => {
    const files = Array.from(selection || [])
    if (!files.length) return
    const replacing = Boolean(project.source.pdf)
    const form = new FormData(); files.forEach(file => form.append('files', file))
    try {
      const response = await fetch(`${API}/api/import/score`, { method: 'POST', body: form })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(typeof error.detail === 'string' ? error.detail : '乐谱导入失败')
      }
      const data = await response.json()
      const pages: ScorePage[] = data.pages.map((p: any, i: number) => ({ id: `page-${String(i + 1).padStart(3, '0')}`, image: p.image, width: p.width, height: p.height }))
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.currentTime = 0
      const scoreName = data.filename.replace(/\.[^.]+$/, '')
      setProject(p => ({ ...p, projectId: data.projectId, projectName: scoreName, source: { ...p.source, pdf: files.length > 1 ? `${scoreName} 等 ${files.length} 张` : data.filename }, pages, segments: [], flags: [] }))
      setActivePage(0); selectOne(null); setTime(0); setPlaying(false); setTool('row')
      flash(replacing ? '已替换乐谱，原有标注已清空' : `已导入 ${pages.length} 页乐谱`)
    } catch (error) { flash(error instanceof Error ? error.message : '无法连接渲染服务，请先启动后端') }
  }
  const onAudio = async (file?: File) => {
    if (!file) return
    const replacing = Boolean(project.source.audio)
    try {
      const body = new FormData(); body.append('file', file)
      const response = await fetch(`${API}/api/import/audio`, { method: 'POST', body })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '音频导入失败')
      const url = URL.createObjectURL(file)
      audioRef.current?.pause()
      setAudioUrl(url)
      setProject(p => ({ ...p, source: { ...p.source, audio: file.name, audioUrl: data.url }, audioDuration: data.duration || null, flags: [], segments: p.segments.map((segment, index) => ({ ...segment, startTime: index * 4, endTime: (index + 1) * 4, timingSet: false })) }))
      selectOne(null); setTime(0); setDuration(data.duration || 0); setPlaying(false)
      if (audioRef.current) { audioRef.current.src = url; audioRef.current.load() }
      flash(replacing ? '已替换音频，请重新打点校准时间' : '音频已载入，可以开始播放')
    } catch (error) { flash(error instanceof Error ? error.message : '音频导入失败，请重试') }
  }
  const togglePlay = () => { const el = audioRef.current; if (!el) { flash('请先导入 MP3 音频'); return }; if (el.paused) { void el.play(); setPlaying(true) } else { el.pause(); setPlaying(false) } }
  const seek = (next: number) => { const el = audioRef.current; if (!el) return; el.currentTime = Math.max(0, Math.min(duration || 0, next)); setTime(el.currentTime) }
  const addFlag = () => {
    const at = audioRef.current?.currentTime ?? time
    const ordered = project.segments
    const flags = visibleFlags
    if (!audioRef.current || !project.source.audio) { flash('请先导入音频'); return }
    if (!ordered.length) { flash('先为乐句放好标注区域'); return }
    if (flags.some(flag => flag.kind === 'end') && nextUnmarkedIndex < 0) { flash('所有乐句都已打点完成'); return }

    const nextFlags: KaraokeFlag[] = flags.filter(flag => flag.kind !== 'end').map(flag => ({ ...flag }))
    const index = nextUnmarkedIndex < 0 ? ordered.length : nextUnmarkedIndex
    const following = ordered.slice(index + 1).find(segment => markedSegments.has(segment.id))
    if (following && at >= following.startTime) { flash('这个时间已晚于后面已打点的乐句，请先定位到正确位置'); return }
    if (index === 0) {
      const first = ordered[0]
      nextFlags.forEach(flag => { if (flag.kind === 'start') flag.kind = 'transition' })
      nextFlags.unshift({ id: `flag-${Date.now()}`, time: at, segmentId: first.id, kind: 'start' })
      setProject(p => ({ ...p, flags: nextFlags, segments: p.segments.map((s, i) => i === 0 ? { ...s, startTime: at, endTime: Math.max(s.endTime, at + 1), timingSet: true } : s) }))
      selectOne(first.id)
      const pageIndex = project.pages.findIndex(page => page.id === first.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      flash(`已打点 ${formatTime(at)} · 第 1 句开始`)
      return
    }

    const previous = ordered[index - 1]
    if (!previous || at <= previous.startTime) { flash('这个标记早于当前乐句的开始位置'); return }
    const next = ordered[index]
    const keepPreviousEnd = following != null || flags.some(flag => flag.segmentId === previous.id && (flag.kind === 'end' || flag.id.startsWith('recovered-')))
    nextFlags.push({ id: `flag-${Date.now()}`, time: at, segmentId: next?.id || previous.id, kind: next ? 'transition' : 'end' })
    nextFlags.sort((a, b) => a.time - b.time)
    setProject(p => ({
      ...p,
      flags: nextFlags,
      segments: p.segments.map((s, i) => i === index - 1
        ? keepPreviousEnd ? s : { ...s, endTime: at }
        : i === index ? { ...s, startTime: at, endTime: Math.max(s.endTime, at + 1), timingSet: true } : s),
    }))
    if (next) {
      selectOne(next.id)
      const pageIndex = project.pages.findIndex(page => page.id === next.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      flash(`已打点 ${formatTime(at)} · 第 ${index + 1} 句开始`)
    } else flash(`已打点 ${formatTime(at)} · 最后一句结束`)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (resetOpen || autoCandidates || boxCandidates || exportOpen) { if (event.key === 'Escape') { setResetOpen(false); setAutoCandidates(null); setBoxCandidates(null) }; return }
      const target = event.target as HTMLElement
      if (target?.matches('input, textarea, select') || target?.isContentEditable) return
      if (event.code === 'Space') { event.preventDefault(); togglePlay() }
      if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoProject() : undoProject() }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redoProject() }
      if (event.key === 'Enter') { event.preventDefault(); addFlag() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); seek(time - (event.shiftKey ? 1 : .1)) }
      if (event.key === 'ArrowRight') { event.preventDefault(); seek(time + (event.shiftKey ? 1 : .1)) }
      if (event.key.toLowerCase() === 'n') setTool('row')
      if (event.key.toLowerCase() === 'd' && selected) { event.preventDefault(); duplicateBelow() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        deleteSegment(selected)
      }
      if (event.key.toLowerCase() === 's' && selected) updateSegment(selected, { startTime: time })
      if (event.key.toLowerCase() === 'e' && selected) updateSegment(selected, { endTime: time })
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [time, selected, selectedIds, duration, project, resetOpen, autoCandidates, boxCandidates, exportOpen])

  function resetAnnotations() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    lastHistoryAt.current = 0
    setProject(p => ({ ...p, segments: [], flags: [] }))
    selectOne(null); setActivePage(0); setTime(0); setTool(project.pages.length ? 'row' : 'select')
    setResetOpen(false)
    flash('标注已清空，可按 Ctrl+Z 恢复')
  }

  function createSegment(region: Region) {
    if (!currentPage) { flash('请先导入乐谱'); return }
    const id = `segment-${Date.now()}`
    const next: Segment = { id, pageId: currentPage.id, region: fitRegion(region), startTime: time, endTime: Math.min(duration || time + 4, time + 4), direction: 'left-to-right' }
    setProject(p => ({ ...p, segments: [...p.segments, next] })); selectOne(id); setTool('row')
  }
  const mergeSegments = (selectedSegmentIds: string[]) => {
    const picked = project.segments.filter(segment => selectedSegmentIds.includes(segment.id))
    if (picked.length < 2) { flash('请先框选至少两条乐句'); return }
    const firstIndex = project.segments.findIndex(segment => segment.id === picked[0].id)
    const contiguous = picked.every((segment, index) => project.segments[firstIndex + index]?.id === segment.id)
    if (!contiguous) { flash('请选中相邻的乐句再合并'); return }
    const regions = picked.flatMap(segmentRegions)
    const merged: Segment = { ...picked[0], pageId: regions[0].pageId, region: regions[0].region, regions,
      startTime: Math.min(...picked.map(segment => segment.startTime)), endTime: Math.max(...picked.map(segment => segment.endTime)) }
    const ids = new Set(picked.map(segment => segment.id))
    setProject(previous => ({ ...previous,
      segments: previous.segments.flatMap(segment => segment.id === merged.id ? [merged] : ids.has(segment.id) ? [] : [segment]),
      flags: previous.flags?.filter(flag => flag.kind !== 'transition' || !ids.has(flag.segmentId) || flag.segmentId === merged.id)
        .map(flag => ids.has(flag.segmentId) ? { ...flag, segmentId: merged.id } : flag),
    }))
    selectOne(merged.id); setTool('select')
    flash(`已合并为乐句 ${String(firstIndex + 1).padStart(2, '0')}`)
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
    if (!sources.length) { flash('先选中要重复使用的歌词框'); return }
    const assignedIds = new Set((project.flags || []).filter(flag => flag.kind !== 'end').map(flag => flag.segmentId))
    const lastAssignedEnd = Math.max(0, ...project.segments.filter(segment => segment.timingSet || assignedIds.has(segment.id)).map(segment => segment.endTime))
    const audioEnd = duration || project.audioDuration || lastAssignedEnd + sources.length * 1.1 + 2
    const copies = sources.map((source, index): Segment => {
      const startTime = Math.max(0, Math.min(audioEnd - .1, lastAssignedEnd + index * 1.1))
      const regions = segmentRegions(source).map(item => ({ pageId: item.pageId, region: { ...item.region } }))
      return { ...source, id: `repeat-${Date.now()}-${index}`, pageId: regions[0].pageId, region: regions[0].region,
        regions: regions.length > 1 ? regions : undefined, startTime, endTime: Math.min(audioEnd, startTime + 1), timingSet: false }
    })
    lastHistoryAt.current = 0
    setProject(previous => ({ ...previous, segments: [...previous.segments, ...copies] }))
    const ids = copies.map(copy => copy.id)
    setSelectedIds(ids); setSelected(ids[ids.length - 1]); setTool('select')
    flash(`已在结尾重复使用 ${copies.length} 个歌词框；新乐句待打点`)
  }
  const duplicateBelow = () => {
    const sources = project.segments.filter(segment => selectedIds.includes(segment.id))
    if (!sources.length) { flash('先选中要复制的标注'); return }
    const copyRegions = sources.map(source => segmentRegions(source).map(part => ({
      pageId: part.pageId,
      region: { ...part.region, y: part.region.y + part.region.height + Math.min(.006, part.region.height / 4) },
    })))
    const noSpace = copyRegions.findIndex(regions => regions.some(part => part.region.y + part.region.height > 1))
    if (noSpace >= 0) {
      const number = project.segments.indexOf(sources[noSpace]) + 1
      flash(`乐句 ${String(number).padStart(2, '0')} 下方放不下副本；可改用「重复使用选中框」`)
      return
    }
    const copies = sources.map((source, index): Segment => {
      const regions = copyRegions[index].map(part => ({ pageId: part.pageId, region: fitRegion(part.region) }))
      const single = sources.length === 1
      return { ...source, id: `segment-${Date.now()}-${index}`, pageId: regions[0].pageId,
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
    if (part !== 0 || segmentRegions(segment).length > 1) { flash('合并的乐句包含多个框，请先调整各框位置'); return }
    const rect = pageRef.current!.getBoundingClientRect()
    const pageX = (event.clientX - rect.left) / rect.width
    const position = (pageX - segment.region.x) / segment.region.width
    const minimum = Math.max(.03, 12 / (rect.width * segment.region.width))
    if (position <= minimum || position >= 1 - minimum) { flash('请点在框内，离左右边缘稍远一些'); return }
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
  const startAutoBoxes = async () => {
    if (!project.pages.length || boxBusy) return
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
    } catch (error) { flash(error instanceof Error ? error.message : '自动框选失败') }
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
      return { ...previous, segments, flags: replace ? [] : previous.flags }
    })
    setBoxCandidates(null); selectOne(null); setTool('select')
    flash(`已应用 ${chosen.length} 个候选框；新标注时间可用打点校准`)
  }
  const startAutoAlign = async () => {
    if (!project.projectId || !project.pages.length || !project.source.audioUrl) { flash('请先导入乐谱和音频'); return }
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
    } catch (error) { flash(error instanceof Error ? error.message : '自动对齐失败') }
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
      flash('这些乐句已有时间，原有打点保持不变')
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
    if (!project.projectId) { flash('请先选择乐谱'); return }
    const settings = project.export || initialProject.export!
    setExportSettings(settings); setPreviewTime(time); setExportJob(null); setValidation(null); setExportOpen(true)
    try {
      await persistProject({ ...project, export: settings })
      const response = await fetch(`${API}/api/projects/${project.projectId}/validate`, { method: 'POST' })
      if (response.ok) setValidation(await response.json())
    } catch (error) { flash(error instanceof Error ? error.message : '无法检查导出条件') }
  }
  const startVideoExport = async () => {
    if (!project.projectId || exportBusy) return
    setExportBusy(true); setExportJob(null); setValidation(null)
    const snapshot: Project = { ...project, export: exportSettings }
    setProject(snapshot)
    try {
      await persistProject(snapshot)
      const reportResponse = await fetch(`${API}/api/projects/${project.projectId}/validate`, { method: 'POST' })
      const report = await reportResponse.json(); setValidation(report)
      if (!reportResponse.ok || !report.valid) { setExportBusy(false); return }
      const response = await fetch(`${API}/api/projects/${project.projectId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exportSettings) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail?.errors?.join('；') || data.detail || '无法开始导出')
      setExportJob({ ...data, progress: 0 })
    } catch (error) { setExportBusy(false); flash(error instanceof Error ? error.message : '视频导出启动失败') }
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-left"><div className="brand"><div className="brand-mark"><Music2 size={17} strokeWidth={2.4} /></div><span>谱间</span><span className="brand-divider"/><span className="product-label">歌谱同步工作台</span></div><div className="highlight-mode-control" role="group" aria-label="文字高亮方式"><span>高亮</span><button type="button" aria-pressed={highlightMode === 'wipe'} title="播放时从左到右逐渐高亮文字" onClick={() => changeHighlightMode('wipe')}>从左到右</button><button type="button" aria-pressed={highlightMode === 'full'} title="乐句开始时整框高亮，直到下一句开始" onClick={() => changeHighlightMode('full')}>整框</button></div></div>
      <div className="top-actions"><button className="icon-button" title="撤销（Ctrl+Z）" disabled={!undoHistory.current.length} onClick={undoProject}><Undo2 size={17}/></button><button className="icon-button" title="重做（Ctrl+Shift+Z）" disabled={!redoHistory.current.length} onClick={redoProject}><Redo2 size={17}/></button><span className="top-separator"/><button className="button button-primary" onClick={openExport}><Upload size={15}/>导出视频</button></div>
    </header>
    <div className="main-layout">
      <main className="workspace">
        <div className="workspace-toolbar"><div className="toolbar-files"><button className="file-chip" title={project.source.pdf ? `点击重新选择乐谱：${project.source.pdf}` : '选择 PDF 或 JPG、PNG、WebP 乐谱'} onClick={() => scoreInput.current?.click()}><FileImage size={14}/><span>歌谱</span><strong>{fileName(project.source.pdf) || '选择乐谱'}</strong></button><button className="file-chip" title={project.source.audio ? `点击重新选择 MP3：${project.source.audio}` : '选择 MP3 音频'} onClick={() => audioInput.current?.click()}><FileAudio2 size={14}/><span>MP3</span><strong>{fileName(project.source.audio) || '选择音频'}</strong></button></div><div className="toolbar-right"><div className="page-count">{project.pages.length ? <><span>第</span><strong>{activePage + 1}</strong><span>/ {project.pages.length} 页</span><button className="page-arrow" disabled={activePage === 0} onClick={() => setActivePage(activePage - 1)}><ChevronLeft size={15}/></button><button className="page-arrow" disabled={activePage >= project.pages.length - 1} onClick={() => setActivePage(activePage + 1)}><ChevronRight size={15}/></button></> : <span>等待导入乐谱</span>}</div><span className="toolbar-sep"/><div className="zoom-control"><button title="缩小乐谱" onClick={() => changeZoom(-.1)}><ZoomOut size={15}/></button><button className="zoom-value" title="点击恢复自动适配" onClick={() => setZoom(null)}>{zoom === null ? '自动适配' : `${Math.round(zoom * 100)}%`}</button><button title="放大乐谱" onClick={() => changeZoom(.1)}><ZoomIn size={15}/></button></div></div></div>
        <div className="segmentation-toolbar"><span>切分乐谱</span><button className={`button compact ${tool === 'row' ? 'button-active' : 'button-quiet'}`} title="添加标注（N）" onClick={() => setTool(tool === 'row' ? 'select' : 'row')}><span className="horizontal-line-icon"/>添加标注</button><button className={`button compact ${tool === 'cut' ? 'button-active' : 'button-quiet'}`} onClick={() => setTool(tool === 'cut' ? 'select' : 'cut')}><span className="vertical-line-icon"/>竖切成框</button><button className="button button-quiet compact" disabled={boxBusy || !project.pages.length} onClick={() => void startAutoBoxes()}>{boxBusy ? <LoaderCircle className="spin" size={13}/> : <WandSparkles size={13}/>} {boxBusy ? '正在框选' : '自动框选'}</button><button className="button button-quiet compact" disabled={!selected || !project.segments.some(segment => segment.id === selected)} onClick={duplicateBelow} title={selectedIds.length > 1 ? `复制已选的 ${selectedIds.length} 个标注到下一行` : "复制选中标注到下一行"}><Scissors size={13}/>复制到下一行{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}</button><button className={`button compact ${tool === 'select' ? 'button-active' : 'button-quiet'}`} onClick={() => setTool('select')}>框选乐句</button><button className="button button-quiet compact" disabled={selectedIds.length < 2} onClick={mergeSelected}>合并乐句{selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}</button><button className="button button-active compact auto-align-launch" disabled={autoBusy || !project.pages.length || !project.source.audioUrl} onClick={() => void startAutoAlign()}>{autoBusy ? <LoaderCircle className="spin" size={13}/> : <WandSparkles size={13}/>} {autoBusy ? '正在对齐' : '自动对齐'}</button><button className="button button-quiet compact reset-toolbar" disabled={!project.segments.length && !(project.flags || []).length} onClick={() => setResetOpen(true)}><RotateCcw size={13}/>重新标注</button><small>{autoBusy ? autoStage : boxBusy ? '正在查找歌词行和明显留白' : tool === 'row' ? '从一个角拖到对角，自由决定框的宽和高' : tool === 'cut' ? '点击已有标注框，将它分成左右两个独立框' : '在空白处拖框多选；Shift 点击可追加选择'}</small></div>
        <div className="canvas-area" ref={canvasRef}>
          {currentPage ? <div className="page-frame" key={currentPage.id} style={{ width: zoom === null ? '58%' : `${Math.round(510 * zoom)}px`, maxWidth: 'calc(100% - 12px)' }}><div ref={pageRef} className={`score-page ${tool === 'row' ? 'drawing' : ''} ${tool === 'cut' ? 'anchoring' : ''} ${tool === 'select' ? 'marquee-mode' : ''} ${playing ? 'previewing' : ''}`} style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }} onPointerDown={pagePointerDown} onPointerMove={pagePointerMove} onPointerUp={pagePointerUp} onPointerCancel={pagePointerUp}>
              <img src={currentPage.image.startsWith('data:') || currentPage.image.startsWith('blob:') ? currentPage.image : currentPage.image} alt={`乐谱第 ${activePage + 1} 页`} draggable={false}/>
              <svg className="annotation-layer" viewBox="0 0 1000 1414" preserveAspectRatio="none">
                <defs>
                  <filter id="ink-recolor" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 .8706  0 0 0 0 .2941  0 0 0 0 .1765  -1.6667 -1.6667 -1.6667 0 4"/></filter>
                  <clipPath id="ink-reveal">{activeRegions.map((item, index) => item.pageId === currentPage.id && <rect key={index} x={item.region.x * 1000} y={item.region.y * 1414} width={item.region.width * activeReveal[index] * 1000} height={item.region.height * 1414}/>)}</clipPath>
                </defs>
                {activeRegions.some(item => item.pageId === currentPage.id) && progress > 0 && <image href={currentPage.image} x="0" y="0" width="1000" height="1414" preserveAspectRatio="none" filter="url(#ink-recolor)" clipPath="url(#ink-reveal)" pointerEvents="none"/>}
                {project.segments.flatMap(seg => segmentRegions(seg).map((item, part) => ({ seg, item, part })).filter(entry => entry.item.pageId === currentPage.id)).sort((a, b) => Number(selectedIds.includes(a.seg.id)) - Number(selectedIds.includes(b.seg.id))).map(({ seg, item, part }) => { const r = item.region; const matching = project.segments.filter(candidate => sharedRegionKey(candidate) === sharedRegionKey(seg)); const repeatIndex = matching.findIndex(candidate => candidate.id === seg.id); const x = r.x * 1000; const y = r.y * 1414; const badgeX = x + (x + 68 <= 1000 ? repeatIndex % 2 * 36 : -(repeatIndex % 2) * 36); const badgeY = Math.max(2, y - 29 - Math.floor(repeatIndex / 2) * 26); return <g key={`${seg.id}-${part}`} className={`annotation ${selectedIds.includes(seg.id) ? 'is-selected' : ''}`} onPointerDown={e => { e.stopPropagation(); if (e.shiftKey) { selectSegment(seg.id, true); return }; selectSegment(seg.id, false); if (tool === 'row') return; if (tool === 'cut') { splitSegment(seg, part, e); return }; dragRef.current = { id: seg.id, part, kind: 'move', startX: e.clientX, startY: e.clientY, region: { ...r } }; (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId) }}>
                  <rect className="region-hit-area" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  <rect className="region-outline" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  {editingNumber?.id === seg.id && editingNumber.part === part
                    ? <foreignObject className="region-number-editor" x={badgeX} y={badgeY} width="34" height="24" onPointerDown={event => event.stopPropagation()}>
                        <input ref={numberInputRef} type="text" inputMode="numeric" aria-label="乐句的新序号" value={editingNumber.value} onChange={event => { replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: event.target.value.replace(/\D/g, '') }) }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { cancelNumberEdit.current = true; setEditingNumber(null) } else if (replaceNumberOnKey.current && /^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: event.key }) } else if (replaceNumberOnKey.current && (event.key === 'Backspace' || event.key === 'Delete')) { event.preventDefault(); replaceNumberOnKey.current = false; setEditingNumber({ ...editingNumber, value: '' }) } else if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') replaceNumberOnKey.current = false }} onBlur={() => { if (!cancelNumberEdit.current && editingNumber?.value) moveSegmentTo(editingNumber.id, editingNumber.value); setEditingNumber(null) }}/>
                      </foreignObject>
                    : <g className="region-number" transform={`translate(${badgeX},${badgeY})`} onPointerDown={event => { event.stopPropagation(); selectSegment(seg.id, event.shiftKey) }} onClick={event => { event.stopPropagation(); if (event.shiftKey) return; cancelNumberEdit.current = false; replaceNumberOnKey.current = true; setEditingNumber({ id: seg.id, part, value: String(project.segments.indexOf(seg) + 1) }) }}><title>单击修改乐句序号</title><rect className="region-number-bg" width="34" height="24" rx="5"/><text className="region-number-text" x="17" y="17" textAnchor="middle">{String(project.segments.indexOf(seg) + 1).padStart(2, '0')}</text></g>}
                  {selected === seg.id && (['n', 's', 'w', 'e'] as const).map(edge => {
                    const x = r.x * 1000; const y = r.y * 1414
                    const width = r.width * 1000; const height = r.height * 1414
                    const hit = Math.min(14, Math.max(5, Math.min(width, height) / 3))
                    return <rect key={edge} className={`resize-edge edge-${edge}`} x={edge === 'e' ? x + width - hit / 2 : edge === 'w' ? x - hit / 2 : x} y={edge === 's' ? y + height - hit / 2 : edge === 'n' ? y - hit / 2 : y} width={edge === 'n' || edge === 's' ? width : hit} height={edge === 'w' || edge === 'e' ? height : hit} onPointerDown={e => startResize(e, seg, part, edge)}/>
                  })}
                  {selected === seg.id && (['nw', 'ne', 'se', 'sw'] as const).map(edge => {
                    const x = (r.x + (edge.includes('w') ? 0 : edge.includes('e') ? r.width : r.width / 2)) * 1000
                    const y = (r.y + (edge.includes('n') ? 0 : edge.includes('s') ? r.height : r.height / 2)) * 1414
                    return <rect key={edge} className={`resize-handle edge-${edge}`} x={x - 8} y={y - 8} width="16" height="16" rx="3" onPointerDown={e => startResize(e, seg, part, edge)}/>
                  })}
                </g> })}
                {draft && <rect className="draft-region" x={draft.x * 1000} y={draft.y * 1414} width={draft.width * 1000} height={draft.height * 1414} rx="4"/>}
                {marquee && <rect className="marquee-region" x={marquee.x * 1000} y={marquee.y * 1414} width={marquee.width * 1000} height={marquee.height * 1414}/>}
              </svg>
            </div><div className="page-caption"><span>第 {activePage + 1} 页</span><span>{currentPage.width} × {currentPage.height} px · 原始比例标注</span></div></div> : <div className="empty-workspace"><div className="empty-art"><div className="music-note note-a">♪</div><div className="music-note note-b">♫</div><div className="empty-paper"><div className="paper-lines">𝅘𝅥𝅮　1 2 3 5　|　6 — 5 3<br/>　小 星 星　　亮 晶 晶</div><div className="paper-highlight"/></div><div className="upload-orbit"><ImagePlus size={20}/></div></div><div className="empty-copy"><span className="eyebrow">从乐谱开始</span><h1>让每一句歌，都有自己的节奏</h1><p>导入 PDF 或 JPG、PNG、WebP 乐谱，再选择音频，<br/>逐行标注歌词位置并校准播放时间。</p></div><p className="empty-start-note">在上方工具栏选择歌谱和音频即可开始</p><div className="supported-note"><span className="check-mini"><Check size={11}/></span>页面按原始尺寸渲染，标注坐标随缩放保持准确</div></div>}
        </div>
      </main>
      <aside className="right-panel"><div className="right-panel-title"><div><span className="eyebrow">检查器</span><h2>标注属性</h2></div><button className="icon-button"><MoreHorizontal size={17}/></button></div>{selected && project.segments.some(s => s.id === selected) ? (() => { const seg = project.segments.find(s => s.id === selected)!; const index = project.segments.indexOf(seg); const neighbors = [index > 0 ? project.segments[index - 1] : null, project.segments[index + 1] || null].filter((item): item is Segment => Boolean(item)); const targetId = neighbors.some(item => item.id === mergeTarget) ? mergeTarget! : neighbors[0]?.id || ""; return <><div className="inspector-card"><div className="inspector-segment-title"><div className="segment-color-dot"/><div><strong>乐句 {String(project.segments.indexOf(seg) + 1).padStart(2, '0')}</strong><span>页面 {project.pages.findIndex(p => p.id === seg.pageId) + 1} · 左至右</span></div><button className="icon-button tiny" onClick={() => deleteSegment(seg.id)}><X size={15}/></button></div><div className="inspector-order"><label className="field-label" htmlFor="phrase-order">乐句序号</label><div><input id="phrase-order" type="text" inputMode="numeric" value={orderDraft ?? String(index + 1)} onChange={e => setOrderDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); moveSegmentTo(seg.id, e.currentTarget.value) } else if (e.key === "Escape") setOrderDraft(null) }}/><button className="button button-secondary" disabled={orderDraft === null || orderDraft === String(index + 1)} onClick={() => moveSegmentTo(seg.id, orderDraft || "")}>移动到此</button></div></div><label className="field-label">开始时间</label><div className="time-input"><Clock3 size={14}/><input value={formatTime(seg.startTime)} onChange={e => { const v = e.target.value.split(':').reduce((a, b) => a * 60 + Number(b), 0); if (Number.isFinite(v)) updateSegment(seg.id, { startTime: v }) }}/><button onClick={() => updateSegment(seg.id, { startTime: time })}>设为当前</button></div><label className="field-label">结束时间</label><div className="time-input"><Clock3 size={14}/><input value={formatTime(seg.endTime)} onChange={e => { const v = e.target.value.split(':').reduce((a, b) => a * 60 + Number(b), 0); if (Number.isFinite(v)) updateSegment(seg.id, { endTime: v }) }}/><button onClick={() => updateSegment(seg.id, { endTime: time })}>设为当前</button></div><div className="field-divider"/><div className="highlight-setting"><div><strong>高亮样式</strong><span>橘红色文字 · 无底色</span></div><div className="yellow-swatch"/></div>{segmentRegions(seg).length > 1 && <div className="inspector-merge"><label className="field-label">框顺序 · {segmentRegions(seg).length} 个框</label><button className="button button-secondary" onClick={() => reverseSegmentRegions(seg.id)}>反转框顺序</button></div>}<div className="inspector-merge"><label className="field-label" htmlFor="merge-target">与哪句合并</label><select id="merge-target" value={targetId} disabled={!neighbors.length} onChange={e => setMergeTarget(e.target.value)}>{neighbors.map(item => { const itemIndex = project.segments.indexOf(item); return <option key={item.id} value={item.id}>乐句 {String(itemIndex + 1).padStart(2, "0")}（{itemIndex < index ? "上一句" : "下一句"}）</option> })}</select><button className="button button-secondary" disabled={!targetId} onClick={() => mergeSegments([seg.id, targetId])}>合并这两句</button></div><div className="inspector-actions"><button className="button button-secondary repeat-region-button" onClick={repeatSelectedRegions}>重复使用选中框{selectedIds.length > 1 ? `（${selectedIds.length}）` : ""}</button><button className="button button-danger-quiet" onClick={() => deleteSegment(seg.id)}>删除标注</button></div></div></> })() : <div className="inspector-empty"><div className="inspector-empty-icon"><WandSparkles size={19}/></div><strong>选择一条标注</strong><p>选中乐谱上的标注区域，<br/>即可调整时间与位置。</p><div className="inspector-hint"><Sparkles size={14}/><span>拖动框内可移动，拖动边线或四角可调整大小</span></div></div>}
      </aside>
      <div className="transport-panel"><div className="transport-left"><button className="play-button" onClick={togglePlay}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><button className="flag-button" onClick={addFlag} disabled={!project.segments.length || !project.source.audio} title={`下一次打点：${nextFlagLabel === "收尾" ? "最后一句结束" : nextFlagLabel === "完成" ? "已完成" : `乐句 ${nextFlagLabel}`}`}><Flag size={14}/><span>打点</span><em>{nextFlagLabel}</em></button><div className="transport-time"><strong>{formatTime(time)}</strong><span>/ {formatTime(duration)}</span></div><div className="transport-divider"/><div className="speed-control"><span>速度</span><select defaultValue="1" onChange={e => { if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value) }}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1.0×</option><option value="1.25">1.25×</option></select><ChevronDown size={12}/></div></div><div className="transport-right"><span className="now-playing-dot"/><span>{activeSegment ? `正在预览 · 乐句 ${String(project.segments.indexOf(activeSegment) + 1).padStart(2, '0')}` : project.source.audio ? '音频已就绪' : '等待导入音频'}</span><button className="icon-button tiny"><Settings2 size={16}/></button></div></div>
      <TimelinePanel audioUrl={project.source.audioUrl} audioName={project.source.audio} duration={duration || project.audioDuration || 0} flags={visibleFlags} segments={project.segments} selected={selected} time={time} playing={playing} onSelect={id => { selectOne(id); const pageIndex = project.pages.findIndex(page => page.id === project.segments.find(segment => segment.id === id)?.pageId); if (pageIndex >= 0) setActivePage(pageIndex) }} onSeek={seek} onMoveSegment={(id, startTime, endTime) => updateSegment(id, { startTime, endTime })}/>
    </div>
    {resetOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setResetOpen(false) }}><div className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><div className="reset-dialog-icon"><RotateCcw size={20}/></div><h2 id="reset-title">重新标注这首歌？</h2><p id="reset-description">将清空 {project.segments.length} 条乐句标注和 {(project.flags || []).length} 个打点。乐谱与音频会保留。</p><div className="reset-dialog-actions"><button className="button button-secondary" autoFocus onClick={() => setResetOpen(false)}>取消</button><button className="button reset-confirm-button" onClick={resetAnnotations}>清空标注</button></div><small>清空后可立即按 Ctrl+Z 恢复。</small></div></div>}
    {analysisProgress && <ProgressDialog key={analysisProgress.kind} kind={analysisProgress.kind} percent={analysisProgress.percent} stage={analysisProgress.stage}/>}
    {autoCandidates && <AutoAlignDialog candidates={autoCandidates} existingCount={project.segments.length} playing={playing} onClose={() => setAutoCandidates(null)} onListen={at => { seek(at); const audio = audioRef.current; if (audio) { void audio.play(); setPlaying(true) } }} onPause={() => { audioRef.current?.pause(); setPlaying(false) }} onApply={applyAutoCandidates}/>}
    {boxCandidates && <AutoBoxDialog pages={project.pages} candidates={boxCandidates} existingCount={project.segments.length} onClose={() => setBoxCandidates(null)} onApply={applyAutoBoxes}/>}
    <input ref={scoreInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp" multiple hidden onChange={e => { void onScore(e.target.files); e.currentTarget.value = '' }}/><input ref={audioInput} type="file" accept="audio/mpeg,audio/mp3,.mp3,audio/*" hidden onChange={e => { void onAudio(e.target.files?.[0]); e.currentTarget.value = '' }}/><audio ref={audioRef} onLoadedMetadata={e => { const next = e.currentTarget.duration; setDuration(next); setProject(p => ({ ...p, audioDuration: next })) }} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}/>{message && <div className="toast"><Check size={15}/>{message}</div>}
    {exportOpen && <ExportDialog settings={exportSettings} previewUrl={previewUrl} previewTime={previewTime} duration={duration || project.audioDuration || 0} validation={validation} job={exportJob} busy={exportBusy} onSettings={settings => setExportSettings(settings)} onPreviewTime={setPreviewTime} onExport={() => { void startVideoExport() }} onClose={() => setExportOpen(false)}/>}
  </div>
}

export default App
