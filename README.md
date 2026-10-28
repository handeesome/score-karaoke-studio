# 谱间 · 歌谱同步工作台

在本机为 PDF 或图片歌谱中的歌词画框，与音频时间对齐，预览文字高亮，并导出带原音频的卡拉 OK 视频。界面为中文，当前只编辑一首歌，无需账号。

Windows 免安装版可从 [GitHub Releases](https://github.com/handeesome/score-karaoke-studio/releases) 下载：`offline.zip` 附带模型和 OCR，`standard.zip` 首次使用相关功能需另行准备模型和 OCR。解压整个 ZIP 后运行 `Pujian.exe`；目标电脑需要 WebView2 和 .NET Framework 4.8，详见下方桌面版说明。

## 功能

- 导入 PDF 或 JPG/JPEG、PNG、WebP 歌谱，以及 MP3、WAV、M4A 或 OGG 音频；多张歌谱图片可一次选择，按文件名中的数字顺序排列为多页。需要更换文件时，点击顶部的文件名重新选择。
- 在谱面上自由拖动画框，或用「自动框选」按歌词行和明显留白生成候选框。可竖切、移动、拉伸、复制、合并、调整顺序；同一个歌词框也可供后面重复演唱的乐句使用。
- 播放、打点、音频时长和播放速度集中在「时间轴」标题行；拖动时间轴上方的分隔条调整高度，重开后保留。歌名换行显示，乐谱获得更多空间。
- 播放时点击「打点」或按 Enter 标记起唱、换句和收尾。时间轴显示本机分离的人声波形，支持滚轮缩放、拖动定位，以及拖动或拉伸乐句条微调时间。
- 人声分离期间显示当前阶段、真实分段进度、已用时间和完成片段数；准备模型时显示等待指示，完成一段音频后更新百分比。人声波形在完整结果生成后显示，已生成结果可复用。
- 鼠标放在歌谱上时，滚轮向上放大、向下缩小，尽量保持鼠标所指位置稳定；放在歌谱外的空白处仍可滚动页面。顶部缩放按钮和自动适配入口继续可用，放大后可用滚动条查看各处。
- 「自动对齐」以现有歌词框（没有框时先自动框选）为单位，结合谱面文字、音频转写和人声波形低谷给出候选时间。处理时显示阶段和百分比；应用候选不会覆盖已有打点或移动手工框。
- 预览时滚动到当前乐句，并把框内的黑色谱面内容变成橘红色。左上角可切换「从左到右」和「整框」两种高亮方式；整框模式从乐句开始一直高亮到下一句开始，最后一句在结束时间停止。导出支持 16:9、9:16、4:5、1:1 及自定义画幅，生成 H.264 MP4，直接保留原音轨。
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

已有 v0.1.0～v0.1.3 的用户若遇到启动未响应或更新按钮不出现，请手动应用 v0.1.4 或更高版本的累计更新包：关闭软件，把更新包内容解压到现有 `Pujian.exe` 同目录，覆盖同名文件后重开。v0.1.4 修复了真实桌面更新接口错误遍历原生窗口对象导致初始化卡住的问题。它复用已有运行依赖和模型，新电脑需先下载完整版本。

桌面启动及每六小时会检查本仓库的 GitHub Releases，有新版时在右上角撤销按钮左侧显示「更新」按钮，无新版或断网时隐藏。点击后显示下载进度，校验 GitHub 提供的 SHA256 和安装兼容性，退出后替换程序及界面，再自动打开。更新前保存当前标注，处理任务完成后才允许安装；失败时保留原程序或尝试恢复备份。模型、用户媒体及项目数据不进入更新包。更新检查独立于模型离线模式；日志位于 `%LOCALAPPDATA%\Pujian\desktop.log` 和 `update.log`。启动日志记录版本与缓存目录；人声缓存命中或缺失也会写入日志。已有完整波形或人声音轨会复用，不会因升级自动清空。

开发者可用 `python scripts/build_patch.py --base-directory '原完整构建的Pujian目录' --output-directory 'D:\谱间发布'` 制作依赖版本未变化的累计更新包，然后上传至对应 `vX.Y.Z` Release，文件名需保持 `Pujian-vX.Y.Z-Windows-x64-update.zip`。检查器会遍历正式 Release，无需把小更新包设为 Latest。依赖或基础安装版本变化时需提供完整包，当前自动更新不替换 Python 运行库或模型。

发行包带有项目许可证和 `third-party-notices/` 中的依赖许可证清单；打包脚本只收集模型及工具，不会收集当前歌谱、音频或打点数据。GitHub Release 单个附件不能超过 2 GiB，脚本会检查最终 ZIP 大小。

## 基本操作

整框高亮支持直线分区：先切换顶部的「整框」，用「整页横线」确定各行的上下边界，再用「整页竖线」画左右边界，闭合区域自动按页、从上到下、从左到右编号。「框内竖切」只切所在闭合分区，不贯穿其他行。「调整分隔线」下可拖线、选区；选中线后可删除，选中空白分区可点「跳过此区」，再次点击已跳过的区域可恢复。分区和分隔线随项目保存，支持撤销/重做；调整完成后检查原有打点，再继续打点。整框模式隐藏画框、复制下一行和框选工具。已有旧画框标注的页面可继续打点或框内竖切，若要改用直线重做，请先点「重新分区」并确认清空，避免叠加重复分区。

1. 从顶部工具栏分别选择歌谱和音频。歌谱可选一个 PDF，或同时选中多张 JPG、PNG、WebP 图片；音频支持 MP3、WAV、M4A、OGG。视频导出直接复制原音轨，不重新编码、不降低码率，也不使用分离的人声替换原曲。MP4 无法封装的音频编码会明确报错，不会自动转为有损格式。
2. 用「添加标注」从框的一角拖到对角，自由确定宽和高；也可以在「更多工具」中用「自动框选」生成候选，再逐个核对。未选中的框显示手形光标，第一次点击只选中；选中后再拖动框内移动，拖动边线或四角调整大小。整框模式下歌词框始终显示手形，不移动框的位置。
3. 如需把一框分成两句，使用「竖切成框」。切割位置只决定两个框的边界，不代表拍点；已有打点会尽量保留，请检查新句时间。可单击框角的序号或在右侧检查器中调整乐句顺序。
4. 播放音频，在第一句起唱时打点；之后每次换句再打一次，最后一句结束时打收尾点。「打点」按钮显示下一次记录哪句开始或最后一句结束。过早、重复或已完成时的点击只在按钮下方提示，不弹窗、不暂停、不跳转音频。需要微调时，拖动时间轴上的乐句条或其两端；乐句设置显示只读时间，并提供「定位到这里」「设为当前」按钮，不需要输入时间数字。
5. 重复唱同一句时，选中谱面上已有的框，点击检查器中的「重复使用选中框」，再给新乐句打点。多选后可一次重复使用多个框。
6. 点击「导出视频」检查标注、预览画面并选择画幅。导出的文件保存在 `%LOCALAPPDATA%\Pujian\exports`，也可从界面下载。

在谱面空白处拖框或按住 Shift 点击可多选；选中的乐句可合并，也可用「复制到下一行」沿用原框相对于文字的上下留白。若下方没有识别到另一行文字，复制不会修改现有标注。「重新标注」会清空乐句和打点，但保留当前导入的文件。Ctrl+Z 可撤销，Ctrl+Shift+Z 或 Ctrl+Y 可重做；选中乐句时可按 Delete 或 Backspace 删除。

合并默认与下一句合并，仅最后一句默认与上一句合并，也可在乐句设置中选择相邻句。合并歌谱乐句时保留原有时间段，按新乐句顺序重新对应。例如合并第 6、7 句后，合并句使用原第 6 段时间，原第 8 句使用原第 7 段，后面依次接上；多出的末尾时间以「空位」保留并保存。整框模式删除内部的分隔线来合并分区时也使用此规则。新增歌词框后，可选中它并放入未分配时间段。

整框模式的已安排乐句首尾相连，拖动共享边界时左右时长一起变化；从左到右模式可独立移动、拉伸时间条，允许留空或重叠。选中时间条后可点击时间轴上方的移除按钮，也可按 Delete、Backspace 或右键操作：从左到右模式只移除这一句时间，保留歌谱框、编号和其他句子的时间；整框模式会先确认，再移除从这一句开始的所有后续时间，保留歌谱框供重新打点。删除歌谱上的标注仍通过乐句设置「更多乐句操作」中的「删除歌谱上的框」或「跳过此区」操作。

界面默认使用大字和深色文字，主要按钮至少 48 像素高。顶部「大字」「更大」可切换显示大小；「乐句设置」可随时收起，把更多空间留给歌谱。这两项偏好会记住，下次打开沿用。常用操作直接显示，识别、复制、重新分区等放在「更多工具」中；撤销和重做始终显示文字按钮。鼠标放在歌谱上滚轮缩放，放在时间轴上滚轮放大时间段，便于拖动短乐句的边界。

## 数据与限制

- 歌谱和音频不会上传到云端服务。普通版首次下载模型需要联网；离线版可直接使用附带模型。音频分析、OCR、预览和视频渲染在本机进行。
- 桌面窗口的 `localStorage` 保存在 `%LOCALAPPDATA%\Pujian\webview`；导入文件及渲染页面放在同一数据目录下的 `projects/`、`media/`，视频放在 `exports/`。这些数据以及模型缓存不纳入 Git；不要清理正在使用的数据目录。此前源码运行留下的 `backend/projects/`、`backend/media/`、`backend/exports/` 可作为旧数据备份保留。
- 歌谱最多 100 页；PDF 页面以 240 DPI 渲染，图片按原始像素尺寸导入并自动处理拍摄方向。自动框选和自动对齐是候选结果，扫描质量、重复歌词和伴奏都会影响准确度；导出前请核对时间与框的位置。
- 高亮作用于框内的黑色图像内容，若框中包含音符或其他黑色图形，它们也会变色。人声分离也可能留下少量伴奏或漏掉较弱的和声。

## N5095 等低功耗电脑的快速人声波形

v0.1.8 自动更新包将 Spleeter 两轨 ONNX 模型内置在程序中，0.1.5 / 0.1.6 可直接点击更新。首次分析会校验并把模型释放到 `%LOCALAPPDATA%/Pujian/models/embedded-spleeter-2stems-v1`，无需额外联网下载，不覆盖原 Demucs 模型。默认两个 CPU 计算线程，按约 10 秒音频逐段报告真实进度。该模式用于辅助打点的人声波形；分离质量可能弱于原 Demucs，视频导出仍直接保留原音轨。已有完成的音轨、波形缓存继续复用。没有内置或附带快速模型的旧安装保持使用 Demucs。

此前准备的 v0.1.7 `N5095-fast-manual.zip` 是独立模型的手动覆盖包；v0.1.8 的 `Windows-x64-update.zip` 使用原更新格式，只替换程序、界面和更新脚本。旧更新器的文件白名单保持不变。新版本兼容旧更新脚本的隐藏启动参数，并会在显示前按任务栏之外的工作区调整窗口。

工作台默认缩小时间轴高度，播放栏下方的分隔条可上下拖动，也可聚焦后按方向键、Home、End 调整。时间轴高度会保存；窗口缩小时自动限高，为乐谱留出空间。时间轴歌名可换行显示，常驻操作提示已移除。

开发者可执行 `.\.venv\Scripts\python.exe scripts/prepare_fast_vocals.py --download` 准备模型。下载后校验固定 SHA256，模型来源和许可证保存在模型目录。源码运行时会查找 `reference/models/spleeter-2stems`；成品优先查找 EXE 同级的 `models/spleeter-2stems`。完整离线构建可向 `scripts/build_windows.py` 传入 `--include-models --fast-vocals reference/models/spleeter-2stems`。用于诊断时，可通过 `PUJIAN_VOCAL_THREADS` 覆盖线程数；常规使用无需设置。

当前速度对比只在 Ryzen 7 3700U 上测得，不代表 N5095 的具体耗时。分析结果不用于替换导出音轨；人声与伴奏相似或歌声较弱时仍需人工核对打点。

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

界面反馈按优先级处理：前置条件不满足时，点击操作会打开包含解决按钮的大字弹窗；会清除数据的操作先说明范围并确认。实时打点反馈在时间轴内短暂显示，避免打断录点。导出中的阻止项提供直接修改入口，重叠和空档等建议项明确允许继续生成。读取、保存失败显示可重试的提示；完成、删除等普通反馈使用通知，删除和清空后可直接点击“撤销上一步”。

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm run build
```

Windows 上可进一步运行真实 WebView2 交互检查（使用隔离测试项目，不读取用户数据）：

```powershell
.\.venv\Scripts\python.exe tests/feedback_ui.py
```

## 许可证

本仓库代码采用 [MIT 许可证](LICENSE)。请只导入你有权使用的歌谱和音频；用户自行导入的文件不随仓库发布。
