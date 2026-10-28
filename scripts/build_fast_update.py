"""Build a CPU-fast overlay, optionally embedding assets for old automatic updaters."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from desktop.version import VERSION
from backend.fast_vocals import validate_models


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-directory', type=Path, required=True)
    parser.add_argument('--analysis-cache', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output-directory', type=Path, default=ROOT / 'release')
    parser.add_argument('--automatic', action='store_true', help='Embed model assets in the EXE; keep the old update ZIP file allowlist')
    args = parser.parse_args()
    base, cache, models = args.base_directory.resolve(), args.analysis_cache.resolve(), args.models.resolve()
    validate_models(models)
    if not (base / '_internal/onnxruntime/capi/onnxruntime_pybind11_state.pyd').is_file():
        raise RuntimeError('原安装不含 ONNX Runtime，需重新构建完整发行包。')
    output = args.output_directory.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (f'Pujian-v{VERSION}-Windows-x64-update.zip' if args.automatic else f'Pujian-v{VERSION}-N5095-fast-manual.zip')
    if archive.exists():
        raise RuntimeError(f'不会覆盖已有更新包：{archive}')
    stage = Path(tempfile.mkdtemp(prefix='fast-update-', dir=ROOT / 'build'))
    asset_module = stage / '_fast_model_assets.py'
    if args.automatic:
        with asset_module.open('w', encoding='utf-8') as target:
            target.write('# Immutable, SHA256-verified Spleeter assets embedded by the release builder.\nPAYLOADS = {\n')
            for file in sorted(models.iterdir()):
                if file.is_file() and file.name in ('vocals.fp16.onnx', 'accompaniment.fp16.onnx', 'manifest.json', 'Spleeter-LICENSE.txt', 'sherpa-onnx-LICENSE.txt'):
                    target.write(repr(file.name) + ': ' + repr(zlib.compress(file.read_bytes(), 6)) + ',\n')
            target.write('}\n')
    spec = stage / 'Pujian-fast.spec'
    source = f'''import ast
from pathlib import Path
from PyInstaller.building.build_main import Analysis
from PyInstaller.archive.readers import CArchiveReader
from PyInstaller.config import CONF
root = Path({str(ROOT)!r})
cached = dict(zip([item[0] for item in Analysis._GUTS], ast.literal_eval(Path({str(cache)!r}).read_text(encoding='utf-8'))))
reader = CArchiveReader({str(base / 'Pujian.exe')!r})
old = reader.open_embedded_archive(next(n for n in reader.toc if n.endswith('.pyz')))
assert 'onnxruntime' in old.toc and 'av' in old.toc
pure = [entry for entry in cached['pure'] if entry[0] != 'backend.fast_vocals']
pure.append(('backend.fast_vocals', str(root / 'backend/fast_vocals.py'), 'PYMODULE'))
asset_module = Path({str(asset_module)!r})
if asset_module.is_file():
    pure.append(('backend._fast_model_assets', str(asset_module), 'PYMODULE'))
code = {{}}
for name, path, kind in pure:
    if (name in ('backend', 'desktop') or name.startswith(('backend.', 'desktop.'))) and path and Path(path).is_file():
        code[name] = compile(Path(path).read_bytes(), path, 'exec')
    elif name in old.toc:
        value = old.extract(name)
        if value is not None:
            code[name] = value
CONF['code_cache'][id(pure)] = code
pyz = PYZ(pure)
exe = EXE(pyz, cached['scripts'], [], exclude_binaries=True, name='Pujian', console=False)
'''
    spec.write_text(source, encoding='utf-8')
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--workpath', str(stage / 'work'),
                    '--distpath', str(stage / 'output'), str(spec)], cwd=ROOT, check=True)
    overlay = stage / 'overlay'
    (overlay / '_internal').mkdir(parents=True)
    shutil.copy2(stage / 'work/Pujian-fast/Pujian.exe', overlay / 'Pujian.exe')
    shutil.copytree(ROOT / 'dist', overlay / '_internal/dist')
    shutil.copy2(ROOT / 'desktop/update-install.ps1', overlay / '_internal/update-install.ps1')
    if not args.automatic:
        shutil.copytree(models, overlay / 'models/spleeter-2stems')
    note = '''谱间 vVERSION · N5095 快速人声版（手动更新包）
适用于已能运行的 v0.1.5 / v0.1.6 Windows x64 版本；本包不是完整安装包。

安装：
1. 等待当前处理完成，关闭谱间。
2. 将本 ZIP 中的全部文件解压到原 Pujian.exe 所在文件夹，选择覆盖同名文件。
   解压后应看到原 Pujian.exe 同级的 models/spleeter-2stems 文件夹。
3. 双击原文件夹中的 Pujian.exe。不要直接在 ZIP 内运行，不要只复制 EXE。

新音频优先使用附带的 Spleeter 两轨 ONNX 模型，CPU 默认 2 个计算线程，离线运行。
它用于生成打点参考的人声波形，分离质量可能弱于原 Demucs；视频继续保留原音频。
已有完整人声音轨和波形缓存会复用，歌谱、打点、模型和原音频不会被清空。
如果只复制 EXE，找不到快速模型时仍会走原来的较慢 Demucs 路径。
同时修复更新后窗口隐藏，以及窗口启动时没有避开任务栏的问题。

测试边界：已在 Ryzen 7 3700U 实测同一首 3 分 02 秒歌曲；N5095 上耗时需实际验证。
日志位于 %LOCALAPPDATA%/Pujian/desktop.log，人声任务的 progress.json 中记录 model 和 threads。
这是本地手动更新包，尚未发布到 GitHub 自动更新。
'''.replace('vVERSION', 'v' + VERSION)
    (overlay / '更新说明.txt').write_text(note, encoding='utf-8-sig')
    if args.automatic:
        info = json.loads((base / 'build-info.json').read_text(encoding='utf-8'))
        (overlay / 'update-info.json').write_text(json.dumps({'format': 1, 'version': VERSION, 'baseVersion': info['version']}), encoding='utf-8')
        (overlay / '更新说明.txt').write_text(f'''谱间 v{VERSION} · 低功耗电脑优化与工作区调整
可从 v0.1.5 / v0.1.6 在软件内直接更新。
快速人声模型随程序内置，首次分析时自动校验并保存到本机模型缓存，离线可用。
原有模型、歌谱、音频、打点和已完成的人声缓存保留。视频仍使用原音轨。
默认缩小时间轴，可拖动时间轴上方的分隔条调整高度，大小随偏好保存。
播放、打点、音频时长和播放速度合并到时间轴标题行。
歌名换行完整显示；移除常驻操作提示，乐谱获得更多空间。
修复旧更新器隐藏启动窗口的问题，窗口会避开 Windows 任务栏。
''', encoding='utf-8-sig')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for file in sorted(overlay.rglob('*')):
            if file.is_file():
                package.write(file, file.relative_to(overlay).as_posix())
    report = {'version': VERSION, 'archive': str(archive), 'stage': str(stage), 'overlay': str(overlay),
              'base': str(base), 'manual': not args.automatic}
    (output / 'fast-update-build.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
