# 谱间 · 歌谱同步工作台

在本机为 PDF 或图片歌谱中的歌词画框，与音频时间对齐，预览文字高亮，并导出带原音频的卡拉 OK 视频。界面为中文，当前只编辑一首歌，无需账号。

Windows 免安装版可从 [GitHub Releases](https://github.com/handeesome/score-karaoke-studio/releases) 下载：`offline.zip` 附带模型和 OCR，`standard.zip` 首次使用相关功能需另行准备模型和 OCR。解压整个 ZIP 后运行 `Pujian.exe`；目标电脑需要 WebView2 和 .NET Framework 4.8，详见下方桌面版说明。

## 功能

- 导入 PDF 或 JPG/JPEG、PNG、WebP 歌谱，以及 MP3、WAV、M4A 或 OGG 音频；多张歌谱图片可一次选择，按文件名中的数字顺序排列为多页。需要更换文件时，点击顶部的文件名重新选择。
- 在谱面上自由拖动画框，或用「自动框选」按歌词行和明显留白生成候选框。可竖切、移动、拉伸、复制、合并、调整顺序；同一个歌词框也可供后面重复演唱的乐句使用。
- 播放时点击「打点」或按 Enter 标记起唱、换句和收尾。时间轴显示本机分离的人声波形，支持滚轮缩放、拖动定位，以及拖动或拉伸乐句条微调时间。
- 人声分离期间显示当前阶段、真实分段进度、已用时间和完成片段数；准备模型时显示等待指示，完成一段音频后更新百分比。人声波形在完整结果生成后显示，已生成结果可复用。
- 「自动对齐」以现有歌词框（没有框时先自动框选）为单位，结合谱面文字、音频转写和人声波形低谷给出候选时间。处理时显示阶段和百分比；应用候选不会覆盖已有打点或移动手工框。
- 预览时滚动到当前乐句，并把框内的黑色谱面内容变成橘红色。左上角可切换「从左到右」和「整框」两种高亮方式；整框模式从乐句开始一直高亮到下一句开始，最后一句在结束时间停止。导出支持 16:9、9:16、4:5、1:1 及自定义画幅，生成 H.264/AAC MP4。
- 编辑状态保存在软件的本机数据目录，关闭后重新打开可继续；不提供多项目管理。歌谱和音频文件同样保存在本机。

## 在 Windows 上运行

1. 从 [GitHub Releases](https://github.com/handeesome/score-karaoke-studio/releases) 下载 Windows x64 ZIP，家里离线使用建议选择 `offline.zip`。
2. 右键下载的 ZIP →「属性」→ 勾选「解除锁定」（如果显示此选项），然后把整个 ZIP 解压到固定文件夹。
3. 双击 `Pujian.exe` 打开软件。关闭窗口会一起结束本机后台、模型与视频编码任务。
4. 需要桌面快捷方式时，为 `Pujian.exe` 创建快捷方式即可。更新时解压新版本，保留 `%LOCALAPPDATA%\Pujian` 数据目录。

成品无需安装 Python、Node.js。Windows 桌面窗口需要 WebView2 Runtime 与 .NET Framework 4.8，详见下面的构建说明。离线版附带模型和 OCR；普通版首次使用相关功能需要下载模型或另行准备 OCR。

## Windows 桌面版与 GitHub Releases

React 界面由 pywebview 装载在独立桌面窗口内。开发调试与成品使用同一套桌面入口。

### 从源码构建 Windows ZIP

在 Windows 10/11 x64 上准备 Python 3.11、Node.js（含 npm），然后在项目根目录执行：

```powershell
# 普通版：包含程序与 Python 依赖，不带模型和 OCR。
.\构建Windows软件.cmd

# 离线模型版：复用兼容的本地缓存，下载缺少的模型，附带本机 Tesseract。
.\构建Windows软件.cmd -IncludeModels -DownloadModels
```

首次构建需要联网安装依赖。脚本默认使用独立的 `.build-venv`，构建前端后用 PyInstaller 打包，并对生成的 EXE 做自检。输出在 `release/Pujian-v版本号-Windows-x64-standard.zip` 或 `-offline.zip`。打包可能需要几分钟及数 GB 可用空间；模型和 PyTorch 会使成品较大。

`-IncludeModels` 不加 `-DownloadModels` 时，只查找本地模型，缺少或不兼容就报错，不会偷偷下载。模型检查通过后才开始 EXE 构建。Whisper 必须是完整的 faster-whisper 格式；Demucs 必须包含 `htdemucs.yaml` 和其中列出的配套权重，其他型号的缓存不能替代。也可以明确指定来源：

```powershell
.\构建Windows软件.cmd -IncludeModels `
  -WhisperModelPath 'D:\Models\faster-whisper-base' `
  -DemucsModelPath 'D:\Models\demucs' `
  -TesseractPath 'C:\Program Files\Tesseract-OCR'
```

离线模型版要求本机已有 Tesseract 的 `tesseract.exe`、DLL 及 `chi_sim`、`eng` 语言包，它们会复制进发行包。已有完整构建环境时可以用 `-PythonPath '.\.venv\Scripts\python.exe'` 复用；`-SkipInstall` 仅适用于桌面依赖已安装的环境。

Windows 桌面窗口还需要 .NET Framework 4.8 与 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。目标电脑已有它们时，离线模型版可直接离线使用。若需要在没有 WebView2 的电脑上离线运行，从微软获取并解压 **Windows x64 Fixed Version Runtime**，构建时加 `-WebView2Path 'D:\WebView2固定版本目录'`，将运行时也放进 ZIP。不要把安装器路径作为此参数。

也可以单独准备可复用的模型目录：

```powershell
.\.build-venv\Scripts\python.exe scripts/prepare_models.py --download
```

### 发布与使用

1. 将源码、依赖清单、启动和构建脚本、说明提交到 GitHub；`dist/`、`build/`、`release/`、虚拟环境、模型和用户数据继续由 `.gitignore` 排除。
2. 同步更新 `package.json`、`package-lock.json` 与 `desktop/version.py` 中的版本号，构建并手动确认导入、播放、打点、关闭重开、视频导出。离线版还应在目标电脑断网检查。
3. 在 GitHub 创建对应版本的 Release，将 `release/` 中的 ZIP 作为附件上传。源码下载与 Windows 成品下载分别提供。脚本不会自动提交或发布。
4. 使用者解压整个 ZIP，双击 `Pujian.exe`。无需安装 Python、Node.js；不要只复制 EXE，也不要直接在 ZIP 内运行。

程序自检会检查网页和静态资源、本机服务、FFmpeg、Demucs 工作进程；离线版还会实际加载 Whisper、Demucs 并检查 OCR 语言包。自检不会下载缺少的离线模型。通过后才生成最终 ZIP；失败的构建目录保留日志，已有同版本 ZIP 不会被覆盖。

若下载解压后出现 `Failed to resolve Python.Runtime.Loader.Initialize`，Windows 可能仍在锁定 DLL 的互联网来源标记；点击“仍要运行”并不一定会解除 DLL 锁定。先在原始 ZIP 的“属性”中勾选“解除锁定”，再解压到新的文件夹；或从 Release 下载 [Repair-Startup.cmd](https://github.com/handeesome/score-karaoke-studio/releases/download/v0.1.0/Repair-Startup.cmd)，放到已解压的 `Pujian.exe` 同目录，双击解除该软件文件夹内文件的下载锁定后重试。构建脚本会将此修复入口放进后续 ZIP；成品自检也会实际初始化 Python.NET 连接组件。若仍失败，请提供数据目录中的 `desktop.log`。

桌面版数据保存在 `%LOCALAPPDATA%\Pujian`，包括当前编辑记录、歌谱/音频、模型缓存和导出视频；更换软件目录或更新版本不会清空这些文件。桌面版与浏览器版保存的编辑状态相互独立，旧项目不自动迁移。关闭桌面窗口会结束后台及它启动的模型/编码进程；同时只运行一个桌面实例。

软件优先使用 `models/whisper-base` 与 `models/demucs` 下的附带模型，也会检查已缓存的 Whisper base；不扫描整个硬盘。已有其他目录中的兼容模型时，可设置 `PUJIAN_WHISPER_MODEL`、`PUJIAN_DEMUCS_REPO` 环境变量。离线版缺失模型会明确报错，普通版缺失模型时首次使用会下载。

人声分离的每段进度及耗时写入 `%LOCALAPPDATA%\Pujian\vocals\音频缓存键\progress.jsonl`，错误输出保存在同目录的 `separation.log`。相邻片段有重叠，进度按模型实际完成的音频范围计算；加载模型、读取音频和保存结果分别显示阶段，百分比不会仅因等待时间变长而自动增加。

已有 v0.1.0 的用户先手动应用 v0.1.1 小更新包一次：关闭软件，把更新包内容解压到现有 `Pujian.exe` 同目录，覆盖同名文件后重开。它复用已有运行依赖和模型，新电脑需先下载完整版本。

从 v0.1.1 开始，桌面启动及每六小时会检查本仓库的 GitHub Releases，有新版时显示「更新」按钮，无新版或断网时隐藏。点击后显示下载进度，校验 GitHub 提供的 SHA256 和安装兼容性，退出后替换程序及界面，再自动打开。更新前保存当前标注，处理任务完成后才允许安装；失败时保留原程序或尝试恢复备份。模型、用户媒体及项目数据不进入更新包。更新检查独立于模型离线模式；日志位于 `%LOCALAPPDATA%\Pujian\desktop.log` 和 `update.log`。

开发者可用 `python scripts/build_patch.py --base-directory '原完整构建的Pujian目录' --output-directory 'D:\谱间发布'` 制作依赖版本未变化的累计更新包，然后上传至对应 `vX.Y.Z` Release，文件名需保持 `Pujian-vX.Y.Z-Windows-x64-update.zip`。检查器会遍历正式 Release，无需把小更新包设为 Latest。依赖或基础安装版本变化时需提供完整包，当前自动更新不替换 Python 运行库或模型。

发行包带有项目许可证和 `third-party-notices/` 中的依赖许可证清单；打包脚本只收集模型及工具，不会收集当前歌谱、音频或打点数据。GitHub Release 单个附件不能超过 2 GiB，脚本会检查最终 ZIP 大小。

## 基本操作

整框高亮支持直线分区：先切换顶部的「整框」，用「整页横线」确定各行的上下边界，再用「整页竖线」画左右边界，闭合区域自动按页、从上到下、从左到右编号。「框内竖切」只切所在闭合分区，不贯穿其他行。「调整分隔线」下可拖线、选区；选中线后可删除，选中空白分区可点「跳过此区」，再次点击已跳过的区域可恢复。分区和分隔线随项目保存，支持撤销/重做；调整完成后检查原有打点，再继续打点。整框模式隐藏画框、复制下一行和框选工具。已有旧画框标注的页面可继续打点或框内竖切，若要改用直线重做，请先点「重新分区」并确认清空，避免叠加重复分区。

1. 从顶部工具栏分别选择歌谱和音频。歌谱可选一个 PDF，或同时选中多张 JPG、PNG、WebP 图片；音频支持 MP3、WAV、M4A、OGG。视频导出直接复制原音轨，不重新编码、不降低码率，也不使用分离的人声替换原曲。MP4 无法封装的音频编码会明确报错，不会自动转为有损格式。
2. 用「添加标注」从框的一角拖到对角，自由确定宽和高；也可以先用「自动框选」生成候选，再逐个核对。单击谱面上的框即可选中，拖动框内移动，拖动边线或四角调整大小。
3. 如需把一框分成两句，使用「竖切成框」。切割位置只决定两个框的边界，不代表拍点；已有打点会尽量保留，请检查新句时间。可单击框角的序号或在右侧检查器中调整乐句顺序。
4. 播放音频，在第一句起唱时打点；之后每次换句再打一次，最后一句结束时打收尾点。已有句子的打点不会因为继续打点而自动清空。需要微调时，可拖动时间轴上的乐句条或其两端，也可在检查器中改时间。
5. 重复唱同一句时，选中谱面上已有的框，点击检查器中的「重复使用选中框」，再给新乐句打点。多选后可一次重复使用多个框。
6. 点击「导出视频」检查标注、预览画面并选择画幅。导出的文件保存在 `%LOCALAPPDATA%\Pujian\exports`，也可从界面下载。

在谱面空白处拖框或按住 Shift 点击可多选；选中的乐句可合并，也可用「复制到下一行」沿用原框相对于文字的上下留白。若下方没有识别到另一行文字，复制不会修改现有标注。「重新标注」会清空乐句和打点，但保留当前导入的文件。Ctrl+Z 可撤销，Ctrl+Shift+Z 或 Ctrl+Y 可重做；选中乐句时可按 Delete 或 Backspace 删除。

## 数据与限制

- 歌谱和音频不会上传到云端服务。普通版首次下载模型需要联网；离线版可直接使用附带模型。音频分析、OCR、预览和视频渲染在本机进行。
- 桌面窗口的 `localStorage` 保存在 `%LOCALAPPDATA%\Pujian\webview`；导入文件及渲染页面放在同一数据目录下的 `projects/`、`media/`，视频放在 `exports/`。这些数据以及模型缓存不纳入 Git；不要清理正在使用的数据目录。此前源码运行留下的 `backend/projects/`、`backend/media/`、`backend/exports/` 可作为旧数据备份保留。
- 歌谱最多 100 页；PDF 页面以 240 DPI 渲染，图片按原始像素尺寸导入并自动处理拍摄方向。自动框选和自动对齐是候选结果，扫描质量、重复歌词和伴奏都会影响准确度；导出前请核对时间与框的位置。
- 高亮作用于框内的黑色图像内容，若框中包含音符或其他黑色图形，它们也会变色。人声分离也可能留下少量伴奏或漏掉较弱的和声。

## 从源码运行桌面窗口（开发用）

在 Windows x64 的项目根目录执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r desktop/requirements.txt
npm ci
npm run build
npm test
.\.venv\Scripts\python.exe desktop/app.py
```

修改界面后重新执行 `npm run build` 并重开桌面窗口即可。源码运行同样使用 `%LOCALAPPDATA%\Pujian` 保存数据。自动框选、自动对齐需要本机 Tesseract 与中文/英文语言包；模型准备方法见上文。

## 开发检查

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm run build
```

## 许可证

本仓库代码采用 [MIT 许可证](LICENSE)。请只导入你有权使用的歌谱和音频；用户自行导入的文件不随仓库发布。
