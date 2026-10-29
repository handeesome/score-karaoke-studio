import { Check, FileAudio2, FileImage, FolderOpen, LoaderCircle, Music2 } from 'lucide-react'

interface HomeImportViewProps {
  scoreName: string | null
  audioName: string | null
  scoreImporting: boolean
  audioImporting: boolean
  onChooseScore: () => void
  onChooseAudio: () => void
}

export default function HomeImportView({ scoreName, audioName, scoreImporting, audioImporting, onChooseScore, onChooseAudio }: HomeImportViewProps) {
  const completed = Number(Boolean(scoreName)) + Number(Boolean(audioName))

  return <div className="home-shell">
    <header className="home-header"><div className="home-brand"><span className="home-brand-mark"><Music2 size={20} strokeWidth={2.4}/></span><span>谱间</span></div><span className="home-header-caption">歌谱同步工作台</span></header>
    <main className="home-main">
      <div className="home-intro"><span className="home-eyebrow">开始使用</span><h1>添加歌谱和音频</h1><p>选择一份歌谱开始新项目，也可以把文件拖进窗口。</p></div>
      <div className="home-choices">
        <button type="button" className={`home-choice home-score ${scoreName ? 'is-ready' : ''}`} disabled={scoreImporting} onClick={onChooseScore} aria-label={scoreName ? `选择歌谱开始新项目，当前为 ${scoreName}` : '添加歌谱'}>
          <span className="home-choice-top"><span className="home-choice-number">01 / 歌谱</span><span className="home-choice-status" aria-live="polite">{scoreImporting ? <><LoaderCircle className="spin" size={15}/>正在导入</> : scoreName ? <><Check size={15}/>已添加</> : '待添加'}</span></span>
          <span className="home-choice-icon"><FileImage size={29} strokeWidth={1.8}/></span>
          <span className="home-choice-title">{scoreName ? '歌谱已添加' : '添加歌谱'}</span>
          <span className="home-choice-description">PDF 或 JPG、PNG、WebP 图片</span>
          <span className="home-choice-bottom"><span className="home-choice-file" title={scoreName || undefined}>{scoreName || '选择一个歌谱文件'}</span><span className="home-choice-action">{scoreName ? '新项目' : '浏览'}<FolderOpen size={17}/></span></span>
        </button>
        <button type="button" className={`home-choice home-audio ${audioName ? 'is-ready' : ''}`} disabled={audioImporting} onClick={onChooseAudio} aria-label={audioName ? `重新选择音频，当前为 ${audioName}` : '添加音频'}>
          <span className="home-choice-top"><span className="home-choice-number">02 / 音频</span><span className="home-choice-status" aria-live="polite">{audioImporting ? <><LoaderCircle className="spin" size={15}/>正在导入</> : audioName ? <><Check size={15}/>已添加</> : '待添加'}</span></span>
          <span className="home-choice-icon"><FileAudio2 size={29} strokeWidth={1.8}/></span>
          <span className="home-choice-title">{audioName ? '音频已添加' : '添加音频'}</span>
          <span className="home-choice-description">MP3、WAV、M4A 或 OGG</span>
          <span className="home-choice-bottom"><span className="home-choice-file" title={audioName || undefined}>{audioName || '选择音频文件'}</span><span className="home-choice-action">{audioName ? '更换' : '浏览'}<FolderOpen size={17}/></span></span>
        </button>
      </div>
      <p className="home-progress" aria-live="polite"><span>{completed} / 2 已添加</span><span className="home-progress-divider"/>两项都添加后自动进入工作台</p>
    </main>
  </div>
}
