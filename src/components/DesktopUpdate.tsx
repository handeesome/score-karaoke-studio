import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import ActionDialog, { type ActionNotice } from './ActionDialog'

type UpdateState = { status: string; version?: string; progress?: number; error?: string }
type UpdateApi = { check_update: (manual?: boolean) => Promise<UpdateState>; update_status: () => Promise<UpdateState>; install_update: () => Promise<UpdateState>; choose_export_directory?: () => Promise<string | null>; open_export?: (path: string, folder: boolean) => Promise<boolean> }
declare global { interface Window { pywebview?: { api: UpdateApi } } }

function UpdateProgressDialog({ state }: { state: UpdateState }) {
  const panel = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = panel.current!
    // The native modal top layer also makes the editor and its menus inert.
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={panel} className="modal-backdrop update-progress-backdrop" aria-modal="true" aria-labelledby="update-title" tabIndex={-1} onCancel={event => event.preventDefault()}>
    <div className="reset-dialog">
      <LoaderCircle className="spin" size={24}/><h2 id="update-title" aria-live="polite">{state.status === 'connecting' ? '正在检查更新连接' : state.status === 'installing' ? '正在安装更新' : `正在下载更新 ${state.progress || 0}%`}</h2>
      <p>{state.status === 'connecting' ? '正在连接更新服务器，连接成功后开始下载。' : '完成后会自动重新打开软件。模型和当前标注会保留。'}</p>
    </div>
  </dialog>
}

export default function DesktopUpdate({ busy = false, save }: { busy?: boolean; save: () => void }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const [desktop, setDesktop] = useState(Boolean(window.pywebview?.api))
  const manualCheck = useRef(false)
  useEffect(() => {
    let closed = false
    const check = () => {
      if (window.pywebview?.api) setDesktop(true)
      void window.pywebview?.api?.check_update?.().catch(() => undefined)
    }
    const poll = async () => {
      try { const next = await window.pywebview?.api?.update_status?.(); if (next && !closed) setState(next) } catch { /* Desktop may be shutting down. */ }
    }
    window.addEventListener('pywebviewready', check)
    check()
    const timer = window.setInterval(() => { void poll() }, 1000)
    const checks = window.setInterval(check, 6 * 60 * 60 * 1000)
    return () => { closed = true; window.removeEventListener('pywebviewready', check); window.clearInterval(timer); window.clearInterval(checks) }
  }, [])
  const working = ['connecting', 'downloading', 'installing'].includes(state.status)
  const checking = state.status === 'checking'
  const refresh = async () => {
    if (checking || working) return
    manualCheck.current = true
    setState(previous => ({ ...previous, status: 'checking' }))
    try {
      const next = await window.pywebview?.api?.check_update(true)
      if (next) setState(next)
    } catch { setState({ status: 'check-error', error: '无法检查更新，请重试。' }) }
  }
  const install = async () => {
    if (busy) { setNotice({ title: '等当前任务完成后，再更新软件', description: '软件正在导入文件、识别歌词或生成视频。完成后，再点击更新即可。', tone: 'info', closeLabel: '返回等待任务完成' }); return }
    try { save(); const next = await window.pywebview?.api?.install_update?.(); if (next) setState(next) }
    catch { setState(previous => ({ ...previous, status: 'error', error: '无法启动更新，请重试。' })) }
  }
  const requestInstall = () => {
    if (busy) { void install(); return }
    setNotice(state.status === 'error' ? {
      title: '软件更新没有完成', description: '检查网络或开启代理后，点击“重试更新”。软件会重新检查连接，无需关闭重开。', tone: 'error', details: state.error,
      primary: { label: '重试更新', onClick: () => { void install() } },
    } : { title: `更新到 v${state.version}？`, description: '开始前会保存当前标注。更新完成后软件会自动重新打开，模型和标注会保留。', closeLabel: '稍后更新', primary: { label: '保存并开始更新', onClick: () => { void install() } } })
  }
  useEffect(() => {
    if (!manualCheck.current || !['available', 'current', 'check-error'].includes(state.status)) return
    manualCheck.current = false
    if (state.status === 'available') requestInstall()
  }, [state.status, state.version])
  if (!desktop) return null
  return <div className="desktop-update">
    {['available', 'connecting', 'downloading', 'installing', 'error'].includes(state.status) &&
    <button className={`button button-secondary compact ${state.status === 'error' ? 'update-issue' : ''}`} disabled={working} onClick={requestInstall}
      title={busy ? '请等待当前处理完成后再更新' : `更新到 v${state.version}，完成后自动重新打开软件`}>
      {working ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}
      {state.status === 'connecting' ? '正在检查连接' : state.status === 'downloading' ? `下载更新 ${state.progress || 0}%` : state.status === 'installing' ? '正在重启' : state.status === 'error' ? '更新失败 · 查看并重试' : `更新 v${state.version}`}
    </button>}
    <button className="button button-secondary compact update-refresh" aria-live="polite" disabled={checking || working} onClick={() => void refresh()} title="立即重新检查更新，发现新版后可保存并开始更新">
      {checking ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}
      {checking ? '正在检查更新' : state.status === 'current' ? '已是最新 · 再次检查' : state.status === 'check-error' ? '检查失败 · 重试' : '检查更新'}
    </button>
    {state.status === 'check-error' && <span className="update-check-result" role="status">无法连接更新服务器。请检查网络或开启代理后重试。</span>}
    {notice && <ActionDialog notice={notice} onClose={() => setNotice(null)}/>}
    {working && <UpdateProgressDialog state={state}/>}
  </div>
}
