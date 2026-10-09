import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileAudio2, FileImage, FileVideo2, Flag, ImagePlus, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Redo2, RotateCcw, Scissors, Settings2, Sparkles, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { AutoBoxCandidate, AutoCandidate, ExportSettings, KaraokeFlag, Project, Region, ScorePage, Segment } from './types'
import ExportDialog from './components/ExportDialog'
import AutoAlignDialog from './components/AutoAlignDialog'
import TimelinePanel from './components/TimelinePanel'
import AutoBoxDialog from './components/AutoBoxDialog'
import { initialProject } from './types'
import { calculateCameraTarget, calculateKaraokeProgress, fitRegion, formatTime, migrateLegacyCuts } from './utils'

const API = ''
function App() {
  const [project, setProjectState] = useState<Project>(() => {
    try { return migrateLegacyCuts({ ...initialProject, ...JSON.parse(localStorage.getItem('pujian-project') || '{}') }) } catch { return initialProject }
  })
  const [activePage, setActivePage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
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
  const [tool, setTool] = useState<'select' | 'row' | 'cut'>('select')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; kind: 'move' | 'resize'; edge?: string; startX: number; startY: number; region: Region; historySaved?: boolean } | null>(null)
  const draftRef = useRef<{ x: number; y: number } | null>(null)
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
  const activeSegment = useMemo(() => project.segments.find(s => s.startTime <= time && s.endTime >= time), [project.segments, time])
  const progress = activeSegment ? calculateKaraokeProgress(activeSegment.startTime, activeSegment.endTime, [], time) : 0
  const fileName = (name: string | null) => name ? name.replace(/\.[^.]+$/, '') : null
  const changeZoom = (step: number) => setZoom(current => {
    const automatic = (canvasRef.current?.clientWidth || window.innerWidth * .7) * .58 / 510
    return Math.max(.45, Math.min(2.5, +((current ?? automatic) + step).toFixed(2)))
  })

  useEffect(() => {
    if (!playing || !activeSegment || !canvasRef.current) return
    const targetPage = project.pages.findIndex(page => page.id === activeSegment.pageId)
    if (targetPage < 0) return
    if (targetPage !== activePage) { setActivePage(targetPage); return }
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current; const page = pageRef.current
      if (!canvas || !page) return
      const canvasRect = canvas.getBoundingClientRect(); const pageRect = page.getBoundingClientRect()
      const centerY = canvas.scrollTop + pageRect.top - canvasRect.top + (activeSegment.region.y + activeSegment.region.height / 2) * pageRect.height
      const target = calculateCameraTarget(centerY, canvas.scrollHeight, canvas.clientHeight, canvas.scrollTop)
      if (Math.abs(target - canvas.scrollTop) > 1) canvas.scrollTo({ top: target, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeSegment?.id, activePage, playing, project.pages])
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
  const updateSegment = (id: string, patch: Partial<Segment>) => setProject(p => ({ ...p, segments: p.segments.map(s => s.id === id ? { ...s, ...patch } : s) }))
  const deleteSegment = (id: string) => {
    const hadFlags = Boolean(project.flags?.length)
    setProject(p => ({ ...p, segments: p.segments.filter(s => s.id !== id), flags: hadFlags ? [] : p.flags }))
    setSelected(null); setTool('select')
    flash(hadFlags ? '标注已删除，旧打点已清空；可按 Ctrl+Z 撤销' : '标注已删除；可按 Ctrl+Z 撤销')
  }
  const onPdf = async (file?: File) => {
    if (!file) return
    const replacing = Boolean(project.source.pdf)
    const form = new FormData(); form.append('file', file)
    try {
      const response = await fetch(`${API}/api/import/pdf`, { method: 'POST', body: form })
      if (!response.ok) throw new Error((await response.json()).detail || 'PDF 导入失败')
      const data = await response.json()
      const pages: ScorePage[] = data.pages.map((p: any, i: number) => ({ id: `page-${String(i + 1).padStart(3, '0')}`, image: p.image, width: p.width, height: p.height }))
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.currentTime = 0
      setProject(p => ({ ...p, projectId: data.projectId, projectName: data.filename.replace(/\.pdf$/i, ''), source: { ...p.source, pdf: data.filename }, pages, segments: [], flags: [] }))
      setActivePage(0); setSelected(null); setTime(0); setPlaying(false); setTool('row')
      flash(replacing ? `已替换乐谱，原有标注已清空` : `已导入 ${pages.length} 页 PDF`)
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
      setProject(p => ({ ...p, source: { ...p.source, audio: file.name, audioUrl: data.url }, audioDuration: data.duration || null, flags: [], segments: p.segments.map((segment, index) => ({ ...segment, startTime: index * 4, endTime: (index + 1) * 4 })) }))
      setSelected(null); setTime(0); setDuration(data.duration || 0); setPlaying(false)
      if (audioRef.current) { audioRef.current.src = url; audioRef.current.load() }
      flash(replacing ? '已替换音频，请重新打点校准时间' : '音频已载入，可以开始播放')
    } catch (error) { flash(error instanceof Error ? error.message : '音频导入失败，请重试') }
  }
  const togglePlay = () => { const el = audioRef.current; if (!el) { flash('请先导入 MP3 音频'); return }; if (el.paused) { void el.play(); setPlaying(true) } else { el.pause(); setPlaying(false) } }
  const seek = (next: number) => { const el = audioRef.current; if (!el) return; el.currentTime = Math.max(0, Math.min(duration || 0, next)); setTime(el.currentTime) }
  const addFlag = () => {
    const at = audioRef.current?.currentTime ?? time
    const ordered = project.segments
    const flags = project.flags || []
    if (!audioRef.current || !project.source.audio) { flash('请先导入音频'); return }
    if (!ordered.length) { flash('先为乐句放好标注区域'); return }
    if (flags.length > ordered.length) { flash('所有乐句都已打点完成'); return }
    if (flags.length && at <= flags[flags.length - 1].time) { flash('新标记需要晚于上一个标记'); return }

    const nextFlags: KaraokeFlag[] = [...flags]
    const index = flags.length
    if (index === 0) {
      const first = ordered[0]
      nextFlags.push({ id: `flag-${Date.now()}`, time: at, segmentId: first.id, kind: 'start' })
      setProject(p => ({ ...p, flags: nextFlags, segments: p.segments.map((s, i) => i === 0 ? { ...s, startTime: at, endTime: Math.max(s.endTime, at + .25) } : s) }))
      setSelected(first.id)
      const pageIndex = project.pages.findIndex(page => page.id === first.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      flash(`已打点 ${formatTime(at)} · 第 1 句开始`)
      return
    }

    const previous = ordered[index - 1]
    if (!previous || at <= previous.startTime) { flash('这个标记早于当前乐句的开始位置'); return }
    const next = ordered[index]
    nextFlags.push({ id: `flag-${Date.now()}`, time: at, segmentId: next?.id || previous.id, kind: next ? 'transition' : 'end' })
    setProject(p => ({
      ...p,
      flags: nextFlags,
      segments: p.segments.map((s, i) => i === index - 1
        ? { ...s, endTime: at }
        : i === index ? { ...s, startTime: at, endTime: Math.max(s.endTime, at + .25) } : s),
    }))
    if (next) {
      setSelected(next.id)
      const pageIndex = project.pages.findIndex(page => page.id === next.pageId); if (pageIndex >= 0) setActivePage(pageIndex)
      flash(`已打点 ${formatTime(at)} · 第 ${index + 1} 句开始`)
    } else flash(`已打点 ${formatTime(at)} · 最后一句结束`)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (resetOpen || autoCandidates || boxCandidates) { if (event.key === 'Escape') { setResetOpen(false); setAutoCandidates(null); setBoxCandidates(null) }; return }
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
      if (event.key === 'Delete' && selected && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        deleteSegment(selected)
      }
      if (event.key.toLowerCase() === 's' && selected) updateSegment(selected, { startTime: time })
      if (event.key.toLowerCase() === 'e' && selected) updateSegment(selected, { endTime: time })
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [time, selected, duration, project, resetOpen, autoCandidates, boxCandidates])

  function resetAnnotations() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    lastHistoryAt.current = 0
    setProject(p => ({ ...p, segments: [], flags: [] }))
    setSelected(null); setActivePage(0); setTime(0); setTool(project.pages.length ? 'row' : 'select')
    setResetOpen(false)
    flash('标注已清空，可按 Ctrl+Z 恢复')
  }

  function createSegment(region: Region) {
    if (!currentPage) { flash('请先导入 PDF 乐谱'); return }
    const id = `segment-${Date.now()}`
    const next: Segment = { id, pageId: currentPage.id, region: fitRegion(region), startTime: time, endTime: Math.min(duration || time + 4, time + 4), direction: 'left-to-right' }
    setProject(p => ({ ...p, segments: [...p.segments, next] })); setSelected(id); setTool('row')
  }
  const duplicateBelow = () => {
    const source = project.segments.find(s => s.id === selected)
    if (!source) { flash('先选中一条标注'); return }
    const id = `segment-${Date.now()}`
    const startTime = source.endTime; const endTime = startTime + (source.endTime - source.startTime)
    setProject(p => ({ ...p, segments: [...p.segments, { ...source, id, region: fitRegion({ ...source.region, y: source.region.y + source.region.height + .025 }), startTime, endTime }] })); setSelected(id)
  }
  const splitSegment = (segment: Segment, event: React.PointerEvent<SVGGElement>) => {
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
      return { ...previous, segments, flags: previous.flags?.length ? [] : previous.flags }
    })
    setSelected(rightId)
    flash(project.flags?.length ? '已分成两个独立标注；旧打点已清空，请重新校准时间' : '已分成两个独立标注，可继续竖切或单独调整时间')
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
    try {
      const response = await fetch(`${API}/api/auto-boxes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: project.pages }) })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '自动框选失败')
      setBoxCandidates(data.candidates || [])
    } catch (error) { flash(error instanceof Error ? error.message : '自动框选失败') }
    finally { setBoxBusy(false) }
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
        return { id: `box-${Date.now()}-${index}`, pageId: candidate.pageId, region: fitRegion(candidate.region), startTime: index * 4, endTime: (index + 1) * 4, direction: 'left-to-right' }
      })
      const unmatched = existing.filter(segment => !used.has(segment.id))
      const segments = !replace && previous.flags?.length
        ? [...existing, ...ordered.filter(segment => !used.has(segment.id))]
        : [...ordered, ...unmatched]
      return { ...previous, segments, flags: replace ? [] : previous.flags }
    })
    setBoxCandidates(null); setSelected(null); setTool('select')
    flash(`已应用 ${chosen.length} 个候选框；新标注时间可用打点校准`)
  }
  const startAutoAlign = async () => {
    if (!project.projectId || !project.pages.length || !project.source.audioUrl) { flash('请先导入 PDF 乐谱和 MP3 音频'); return }
    if (autoBusy) return
    setAutoBusy(true); setAutoStage('正在准备自动对齐')
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
        if (status.status === 'failed') throw new Error(status.error || '自动对齐失败')
        if (status.status === 'completed') { setAutoCandidates(status.candidates || []); return }
      }
    } catch (error) { flash(error instanceof Error ? error.message : '自动对齐失败') }
    finally { setAutoBusy(false); setAutoStage('') }
  }
  const applyAutoCandidates = (indices: number[]) => {
    if (!autoCandidates) return
    const chosen = indices.map(index => autoCandidates[index]).filter(Boolean)
    if (!chosen.length) return
    lastHistoryAt.current = 0
    setProject(previous => {
      const used = new Set<string>()
      const proposed = chosen.map((candidate, index): Segment => {
        const cy = candidate.region.y + candidate.region.height / 2
        const cx = candidate.region.x + candidate.region.width / 2
        const existing = previous.segments.filter(segment => {
          if (used.has(segment.id) || segment.pageId !== candidate.pageId) return false
          const top = Math.max(segment.region.y, candidate.region.y)
          const bottom = Math.min(segment.region.y + segment.region.height, candidate.region.y + candidate.region.height)
          const overlap = Math.max(0, bottom - top) / Math.min(segment.region.height, candidate.region.height)
          return overlap > .28 && segment.region.height <= candidate.region.height * 2 && Math.abs(segment.region.x + segment.region.width / 2 - cx) < .25
        }).sort((a, b) => Math.abs(a.region.y + a.region.height / 2 - cy) - Math.abs(b.region.y + b.region.height / 2 - cy))[0]
        if (!existing) return { id: `auto-${Date.now()}-${index}`, pageId: candidate.pageId, region: fitRegion(candidate.region), startTime: candidate.startTime, endTime: candidate.endTime, direction: 'left-to-right', text: candidate.text }
        used.add(existing.id)
        return { ...existing, text: candidate.text, startTime: candidate.startTime, endTime: candidate.endTime }
      })
      return { ...previous, segments: [...previous.segments.filter(segment => !used.has(segment.id)), ...proposed].sort((a, b) => a.startTime - b.startTime), flags: [] }
    })
    setAutoCandidates(null); setSelected(null); setTool('select')
    flash(`已应用 ${chosen.length} 条候选；请重点试听待核对的乐句`)
  }
  const openExport = async () => {
    if (!project.projectId) { flash('请先选择乐谱 PDF'); return }
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
  const pagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'row' || !currentPage) return
    event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    const point = pointerPosition(event); draftRef.current = point; setIsDrawing(true)
    setDraft(fitRegion({ x: point.x, y: point.y, width: .005, height: .016 }))
  }
  const pagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointerPosition(event)
    if (isDrawing && draftRef.current) {
      const origin = draftRef.current
      setDraft(fitRegion({ x: origin.x, y: origin.y, width: Math.max(.005, point.x - origin.x), height: .016 }))
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
      updateSegment(drag.id, { region })
    }
  }
  const pagePointerUp = () => {
    if (isDrawing && draft && tool === 'row') {
      const region = draft.width > .02 ? draft : fitRegion({ ...draft, width: .8 })
      createSegment(region)
      flash('已添加标注；可继续画下一行，或用竖切把一行分成多个框')
    }
    setIsDrawing(false); draftRef.current = null; setDraft(null); dragRef.current = null
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Music2 size={17} strokeWidth={2.4} /></div><span>谱间</span><span className="brand-divider"/><span className="product-label">歌谱同步工作台</span></div>
      <div className="top-actions"><button className="icon-button" title="撤销（Ctrl+Z）" disabled={!undoHistory.current.length} onClick={undoProject}><Undo2 size={17}/></button><button className="icon-button" title="重做（Ctrl+Shift+Z）" disabled={!redoHistory.current.length} onClick={redoProject}><Redo2 size={17}/></button><span className="top-separator"/><button className="button button-primary" onClick={openExport}><Upload size={15}/>导出视频</button></div>
    </header>
    <div className="main-layout">
      <main className="workspace">
        <div className="workspace-toolbar"><div className="toolbar-files"><button className="file-chip" title={project.source.pdf ? `点击重新选择 PDF：${project.source.pdf}` : '选择 PDF 乐谱'} onClick={() => pdfInput.current?.click()}><FileImage size={14}/><span>PDF</span><strong>{fileName(project.source.pdf) || '选择乐谱'}</strong></button><button className="file-chip" title={project.source.audio ? `点击重新选择 MP3：${project.source.audio}` : '选择 MP3 音频'} onClick={() => audioInput.current?.click()}><FileAudio2 size={14}/><span>MP3</span><strong>{fileName(project.source.audio) || '选择音频'}</strong></button></div><div className="toolbar-right"><div className="page-count">{project.pages.length ? <><span>第</span><strong>{activePage + 1}</strong><span>/ {project.pages.length} 页</span><button className="page-arrow" disabled={activePage === 0} onClick={() => setActivePage(activePage - 1)}><ChevronLeft size={15}/></button><button className="page-arrow" disabled={activePage >= project.pages.length - 1} onClick={() => setActivePage(activePage + 1)}><ChevronRight size={15}/></button></> : <span>等待导入乐谱</span>}</div><span className="toolbar-sep"/><div className="zoom-control"><button title="缩小乐谱" onClick={() => changeZoom(-.1)}><ZoomOut size={15}/></button><button className="zoom-value" title="点击恢复自动适配" onClick={() => setZoom(null)}>{zoom === null ? '自动适配' : `${Math.round(zoom * 100)}%`}</button><button title="放大乐谱" onClick={() => changeZoom(.1)}><ZoomIn size={15}/></button></div></div></div>
        <div className="segmentation-toolbar"><span>切分乐谱</span><button className={`button compact ${tool === 'row' ? 'button-active' : 'button-quiet'}`} title="添加标注（N）" onClick={() => setTool(tool === 'row' ? 'select' : 'row')}><span className="horizontal-line-icon"/>添加标注</button><button className={`button compact ${tool === 'cut' ? 'button-active' : 'button-quiet'}`} onClick={() => setTool(tool === 'cut' ? 'select' : 'cut')}><span className="vertical-line-icon"/>竖切成框</button><button className="button button-quiet compact" disabled={boxBusy || !project.pages.length} onClick={() => void startAutoBoxes()}>{boxBusy ? <LoaderCircle className="spin" size={13}/> : <WandSparkles size={13}/>} {boxBusy ? '正在框选' : '自动框选'}</button><button className="button button-active compact auto-align-launch" disabled={autoBusy || !project.pages.length || !project.source.audioUrl} onClick={() => void startAutoAlign()}>{autoBusy ? <LoaderCircle className="spin" size={13}/> : <WandSparkles size={13}/>} {autoBusy ? '正在对齐' : '自动对齐'}</button><button className="button button-quiet compact reset-toolbar" disabled={!project.segments.length && !(project.flags || []).length} onClick={() => setResetOpen(true)}><RotateCcw size={13}/>重新标注</button><small>{autoBusy ? autoStage : boxBusy ? '正在查找歌词行和明显留白' : tool === 'row' ? '在歌词行左上角单击，或向右拖出标注宽度' : tool === 'cut' ? '点击已有标注框，将它分成左右两个独立框' : '自动框选只找位置；自动对齐还会估计音频时间'}</small></div>
        <div className="canvas-area" ref={canvasRef}>
          {currentPage ? <div className="page-frame" key={currentPage.id} style={{ width: zoom === null ? '58%' : `${Math.round(510 * zoom)}px`, maxWidth: 'calc(100% - 12px)' }}><div ref={pageRef} className={`score-page ${tool === 'row' ? 'drawing' : ''} ${tool === 'cut' ? 'anchoring' : ''} ${playing ? 'previewing' : ''}`} style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }} onPointerDown={pagePointerDown} onPointerMove={pagePointerMove} onPointerUp={pagePointerUp} onPointerCancel={pagePointerUp}>
              <img src={currentPage.image.startsWith('data:') || currentPage.image.startsWith('blob:') ? currentPage.image : currentPage.image} alt={`乐谱第 ${activePage + 1} 页`} draggable={false}/>
              <svg className="annotation-layer" viewBox="0 0 1000 1414" preserveAspectRatio="none">
                <defs>
                  <filter id="ink-recolor" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 .8706  0 0 0 0 .2941  0 0 0 0 .1765  -1.6667 -1.6667 -1.6667 0 4"/></filter>
                  <clipPath id="ink-reveal"><rect x={(activeSegment?.region.x || 0) * 1000} y={(activeSegment?.region.y || 0) * 1414} width={(activeSegment?.region.width || 0) * progress * 1000} height={(activeSegment?.region.height || 0) * 1414}/></clipPath>
                </defs>
                {activeSegment?.pageId === currentPage.id && progress > 0 && <image href={currentPage.image} x="0" y="0" width="1000" height="1414" preserveAspectRatio="none" filter="url(#ink-recolor)" clipPath="url(#ink-reveal)" pointerEvents="none"/>}
                {project.segments.filter(s => s.pageId === currentPage.id).map(seg => { const r = seg.region; return <g key={seg.id} className={`annotation ${selected === seg.id ? 'is-selected' : ''}`} onPointerDown={e => { e.stopPropagation(); setSelected(seg.id); if (tool === 'row') return; if (tool === 'cut') { splitSegment(seg, e); return }; dragRef.current = { id: seg.id, kind: 'move', startX: e.clientX, startY: e.clientY, region: { ...r } }; (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId) }}>
                  <rect className="region-hit-area" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  <rect className="region-outline" x={r.x * 1000} y={r.y * 1414} width={r.width * 1000} height={r.height * 1414} rx="4"/>
                  <g className="region-number" transform={`translate(${r.x * 1000},${Math.max(2, r.y * 1414 - 29)})`}><rect className="region-number-bg" width="34" height="24" rx="5"/><text className="region-number-text" x="17" y="17" textAnchor="middle">{String(project.segments.indexOf(seg) + 1).padStart(2, '0')}</text></g>
                  {selected === seg.id && (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(edge => {
                    const x = (r.x + (edge.includes('w') ? 0 : edge.includes('e') ? r.width : r.width / 2)) * 1000
                    const y = (r.y + (edge.includes('n') ? 0 : edge.includes('s') ? r.height : r.height / 2)) * 1414
                    return <rect key={edge} className={`resize-handle edge-${edge}`} x={x - 8} y={y - 8} width="16" height="16" rx="3" onPointerDown={e => { e.stopPropagation(); dragRef.current = { id: seg.id, kind: 'resize', edge, startX: e.clientX, startY: e.clientY, region: { ...r } }; (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId) }}/>
                  })}
                </g> })}
                {draft && <rect className="draft-region" x={draft.x * 1000} y={draft.y * 1414} width={draft.width * 1000} height={draft.height * 1414} rx="4"/>}
              </svg>
            </div><div className="page-caption"><span>第 {activePage + 1} 页</span><span>{currentPage.width} × {currentPage.height} px · 原始比例标注</span></div></div> : <div className="empty-workspace"><div className="empty-art"><div className="music-note note-a">♪</div><div className="music-note note-b">♫</div><div className="empty-paper"><div className="paper-lines">𝅘𝅥𝅮　1 2 3 5　|　6 — 5 3<br/>　小 星 星　　亮 晶 晶</div><div className="paper-highlight"/></div><div className="upload-orbit"><ImagePlus size={20}/></div></div><div className="empty-copy"><span className="eyebrow">从乐谱开始</span><h1>让每一句歌，都有自己的节奏</h1><p>导入一份简谱 PDF 和伴奏 MP3，逐行标注歌词位置，<br/>再为每段旋律校准准确的播放时间。</p></div><p className="empty-start-note">在上方工具栏选择 PDF 和 MP3 即可开始</p><div className="supported-note"><span className="check-mini"><Check size={11}/></span>页面按原始尺寸渲染，标注坐标随缩放保持准确</div></div>}
        </div>
        <div className="transport-panel"><div className="transport-left"><button className="play-button" onClick={togglePlay}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><button className="flag-button" onClick={addFlag} disabled={!project.segments.length || !project.source.audio} title="记录此刻的音频时间（Enter）"><Flag size={14}/><span>打点</span>{Boolean(project.flags?.length) && <em>{project.flags?.length}</em>}</button><div className="transport-time"><strong>{formatTime(time)}</strong><span>/ {formatTime(duration)}</span></div><div className="transport-divider"/><div className="speed-control"><span>速度</span><select defaultValue="1" onChange={e => { if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value) }}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1.0×</option><option value="1.25">1.25×</option></select><ChevronDown size={12}/></div></div><div className="transport-right"><span className="now-playing-dot"/><span>{activeSegment ? `正在预览 · 乐句 ${String(project.segments.indexOf(activeSegment) + 1).padStart(2, '0')}` : project.source.audio ? '音频已就绪' : '等待导入音频'}</span><button className="icon-button tiny"><Settings2 size={16}/></button></div><div className="transport-progress" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); seek((e.clientX - rect.left) / rect.width * duration) }}><div className="transport-progress-fill" style={{ width: `${duration ? time / duration * 100 : 0}%` }}/>{(project.flags || []).map(flag => <button key={flag.id} className="flag-tick" style={{ left: `${duration ? flag.time / duration * 100 : 0}%` }} title={`打点 ${formatTime(flag.time)}`} onClick={e => { e.stopPropagation(); seek(flag.time) }} />)}<div className="transport-progress-knob" style={{ left: `${duration ? time / duration * 100 : 0}%` }}/></div></div>
        <TimelinePanel audioUrl={project.source.audioUrl} audioName={project.source.audio} duration={duration || project.audioDuration || 0} segments={project.segments} selected={selected} time={time} onSelect={setSelected} onSeek={seek} onDuplicate={duplicateBelow}/>
      </main>
      <aside className="right-panel"><div className="right-panel-title"><div><span className="eyebrow">检查器</span><h2>标注属性</h2></div><button className="icon-button"><MoreHorizontal size={17}/></button></div>{selected && project.segments.some(s => s.id === selected) ? (() => { const seg = project.segments.find(s => s.id === selected)!; return <><div className="inspector-card"><div className="inspector-segment-title"><div className="segment-color-dot"/><div><strong>乐句 {String(project.segments.indexOf(seg) + 1).padStart(2, '0')}</strong><span>页面 {project.pages.findIndex(p => p.id === seg.pageId) + 1} · 左至右</span></div><button className="icon-button tiny" onClick={() => deleteSegment(seg.id)}><X size={15}/></button></div><label className="field-label">开始时间</label><div className="time-input"><Clock3 size={14}/><input value={formatTime(seg.startTime)} onChange={e => { const v = e.target.value.split(':').reduce((a, b) => a * 60 + Number(b), 0); if (Number.isFinite(v)) updateSegment(seg.id, { startTime: v }) }}/><button onClick={() => updateSegment(seg.id, { startTime: time })}>设为当前</button></div><label className="field-label">结束时间</label><div className="time-input"><Clock3 size={14}/><input value={formatTime(seg.endTime)} onChange={e => { const v = e.target.value.split(':').reduce((a, b) => a * 60 + Number(b), 0); if (Number.isFinite(v)) updateSegment(seg.id, { endTime: v }) }}/><button onClick={() => updateSegment(seg.id, { endTime: time })}>设为当前</button></div><div className="field-divider"/><div className="highlight-setting"><div><strong>高亮样式</strong><span>橘红色文字 · 无底色</span></div><div className="yellow-swatch"/></div><div className="inspector-actions"><button className="button button-secondary full" onClick={duplicateBelow}><Scissors size={14}/>复制到下一行</button><button className="button button-danger-quiet" onClick={() => deleteSegment(seg.id)}>删除标注</button></div></div></> })() : <div className="inspector-empty"><div className="inspector-empty-icon"><WandSparkles size={19}/></div><strong>选择一条标注</strong><p>选中乐谱上的标注区域，<br/>即可调整时间与位置。</p><div className="inspector-hint"><Sparkles size={14}/><span>拖动标注框可移动位置，拖动边框控制点可调整大小</span></div></div>}
      </aside>
    </div>
    {resetOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setResetOpen(false) }}><div className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><div className="reset-dialog-icon"><RotateCcw size={20}/></div><h2 id="reset-title">重新标注这首歌？</h2><p id="reset-description">将清空 {project.segments.length} 条乐句标注和 {(project.flags || []).length} 个打点。乐谱与音频会保留。</p><div className="reset-dialog-actions"><button className="button button-secondary" autoFocus onClick={() => setResetOpen(false)}>取消</button><button className="button reset-confirm-button" onClick={resetAnnotations}>清空标注</button></div><small>清空后可立即按 Ctrl+Z 恢复。</small></div></div>}
    {autoCandidates && <AutoAlignDialog candidates={autoCandidates} existingCount={project.segments.length} playing={playing} onClose={() => setAutoCandidates(null)} onListen={at => { seek(at); const audio = audioRef.current; if (audio) { void audio.play(); setPlaying(true) } }} onPause={() => { audioRef.current?.pause(); setPlaying(false) }} onApply={applyAutoCandidates}/>}
    {boxCandidates && <AutoBoxDialog pages={project.pages} candidates={boxCandidates} existingCount={project.segments.length} onClose={() => setBoxCandidates(null)} onApply={applyAutoBoxes}/>}
    <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={e => { void onPdf(e.target.files?.[0]); e.currentTarget.value = '' }}/><input ref={audioInput} type="file" accept="audio/mpeg,audio/mp3,.mp3,audio/*" hidden onChange={e => { void onAudio(e.target.files?.[0]); e.currentTarget.value = '' }}/><audio ref={audioRef} onLoadedMetadata={e => { const next = e.currentTarget.duration; setDuration(next); setProject(p => ({ ...p, audioDuration: next })) }} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}/>{message && <div className="toast"><Check size={15}/>{message}</div>}
    {exportOpen && <ExportDialog settings={exportSettings} previewUrl={previewUrl} previewTime={previewTime} duration={duration || project.audioDuration || 0} validation={validation} job={exportJob} busy={exportBusy} onSettings={settings => setExportSettings(settings)} onPreviewTime={setPreviewTime} onExport={() => { void startVideoExport() }} onClose={() => setExportOpen(false)}/>}
  </div>
}

export default App
