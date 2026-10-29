import { useEffect, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import ActionDialog, { type ActionNotice } from './ActionDialog'

type UpdateState = { status: string; version?: string; progress?: number; error?: string }
type UpdateApi = { check_update: () => Promise<UpdateState>; update_status: () => Promise<UpdateState>; install_update: () => Promise<UpdateState>; choose_export_directory?: () => Promise<string | null>; open_export?: (path: string, folder: boolean) => Promise<boolean> }
declare global { interface Window { pywebview?: { api: UpdateApi } } }

export default function DesktopUpdate({ busy = false, save }: { busy?: boolean; save: () => void }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  useEffect(() => {
    let closed = false
    const check = () => { void window.pywebview?.api?.check_update?.().catch(() => undefined) }
    const poll = async () => {
      try { const next = await window.pywebview?.api?.update_status?.(); if (next && !closed) setState(next) } catch { /* Desktop may be shutting down. */ }
    }
    window.addEventListener('pywebviewready', check)
    check()
    const timer = window.setInterval(() => { void poll() }, 1000)
    const checks = window.setInterval(check, 6 * 60 * 60 * 1000)
    return () => { closed = true; window.removeEventListener('pywebviewready', check); window.clearInterval(timer); window.clearInterval(checks) }
  }, [])
  if (!['available', 'downloading', 'installing', 'error'].includes(state.status)) return null
  const working = ['downloading', 'installing'].includes(state.status)
  const install = async () => {
    if (busy) { setNotice({ title: '等当前任务完成后，再更新软件', description: '软件正在导入文件、识别歌词或生成视频。完成后，再点击更新即可。', tone: 'info', closeLabel: '返回等待任务完成' }); return }
    try { save(); const next = await window.pywebview?.api?.install_update?.(); if (next) setState(next) }
    catch { setState(previous => ({ ...previous, status: 'error', error: '无法启动更新，请重试。' })) }
  }
  const requestInstall = () => {
    if (busy) { void install(); return }
    setNotice(state.status === 'error' ? {
      title: '软件更新没有完成', description: '请确认电脑可以连接 GitHub，再重试更新。当前项目可以继续使用。', tone: 'error', details: state.error,
      primary: { label: '重试更新', onClick: () => { void install() } },
    } : { title: `更新到 v${state.version}？`, description: '开始前会保存当前标注。更新完成后软件会自动重新打开，模型和标注会保留。', closeLabel: '稍后更新', primary: { label: '保存并开始更新', onClick: () => { void install() } } })
  }
  return <div className="desktop-update">
    <button className={`button button-secondary compact ${state.status === 'error' ? 'update-issue' : ''}`} disabled={working} onClick={requestInstall}
      title={busy ? '请等待当前处理完成后再更新' : `更新到 v${state.version}，完成后自动重新打开软件`}>
      {working ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}
      {state.status === 'downloading' ? `下载更新 ${state.progress || 0}%` : state.status === 'installing' ? '正在重启' : state.status === 'error' ? '更新失败 · 查看并重试' : `更新 v${state.version}`}
    </button>
    {notice && <ActionDialog notice={notice} onClose={() => setNotice(null)}/>}
    {working && <div className="modal-backdrop"><div className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <LoaderCircle className="spin" size={24}/><h2 id="update-title">{state.status === 'installing' ? '正在安装更新' : `正在下载更新 ${state.progress || 0}%`}</h2>
      <p>完成后会自动重新打开软件。模型和当前标注会保留。</p>
    </div></div>}
  </div>
}
