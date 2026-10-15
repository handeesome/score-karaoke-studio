"""Build a small desktop update using an existing, compatible full-build directory."""
import argparse
import ast
import importlib.metadata
import json
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def create_archive(stage, archive, version, base_version):
    readme = '''谱间小更新包
适用于已有 v0.1.0 的 Windows x64 软件。
1. 关闭谱间软件。
2. 将本 ZIP 的全部内容解压到现有 Pujian.exe 所在文件夹，选择覆盖同名文件。
3. 重新打开 Pujian.exe。在整框高亮模式下，可用整页横线、整页竖线与框内竖切分区。
视频导出直接保留原音轨，不重新编码或降低音频码率。
软件启动时会联网检查更新，有新版才显示更新按钮；点击后下载、校验并安装，完成后自动重新打开。
已有 v0.1.1 的用户可直接在软件内点击更新；v0.1.0 需手动覆盖一次。断网不影响使用。
模型与用户数据无需重新下载；这不是独立安装包，新电脑需先下载完整发行包。
'''
    partial = archive.with_suffix('.zip.partial')
    with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        output.write(stage / 'Pujian.exe', 'Pujian.exe')
        for file in (ROOT / 'dist').rglob('*'):
            if file.is_file():
                output.write(file, '_internal/dist/' + file.relative_to(ROOT / 'dist').as_posix())
        output.write(ROOT / 'desktop/修复启动.cmd', 'Repair-Startup.cmd')
        output.write(ROOT / 'desktop/update-install.ps1', '_internal/update-install.ps1')
        output.writestr('update-info.json', json.dumps({'format': 1, 'version': version, 'baseVersion': base_version}, indent=2))
        output.writestr('更新说明.txt', readme)
    partial.replace(archive)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-directory', type=Path, required=True,
                        help='原完整构建的 Pujian 文件夹，其上级目录需保留 Pujian.spec')
    parser.add_argument('--output-directory', type=Path, default=ROOT / 'release', help='ZIP 输出目录，可指定 D 盘')
    args = parser.parse_args()
    base = args.base_directory.resolve()
    info = json.loads((base / 'build-info.json').read_text(encoding='utf-8'))
    if not info['python'].startswith(f'{sys.version_info.major}.{sys.version_info.minor}.'):
        raise RuntimeError('更新包的 Python 版本必须与原发行包相同')
    packages = json.loads((base / 'third-party-notices/packages.json').read_text(encoding='utf-8'))
    for package in packages:
        if importlib.metadata.version(package['name']) != package['version']:
            raise RuntimeError(f"依赖版本变化，需构建完整 ZIP：{package['name']}")
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if runpy.run_path(str(ROOT / 'desktop/version.py'))['VERSION'] != version:
        raise RuntimeError('请同步更新 desktop/version.py 的版本号')
    stage = ROOT / 'build' / f'patch-{version}'
    stage.mkdir(parents=True, exist_ok=True)
    args.output_directory.mkdir(parents=True, exist_ok=True)
    archive = args.output_directory.resolve() / f'Pujian-v{version}-Windows-x64-update.zip'
    if archive.exists():
        raise RuntimeError(f'更新包已存在：{archive}')
    spec = (base.parent / 'Pujian.spec').read_text(encoding='utf-8')
    spec = spec.split('coll = COLLECT(')[0]
    spec = spec.replace("name='Pujian',", f"name={str(stage / 'Pujian.exe')!r},", 1)
    spec = spec.replace('hiddenimports=hiddenimports,', "hiddenimports=hiddenimports + ['backend.separation_worker', 'desktop.updater'],")
    # PyInstaller appends __main__ to this list while building; declare it up front
    # so its analysis cache remains reusable on a retry.
    def stable_excludes(match):
        excluded = ast.literal_eval(match.group(1))
        if '__main__' not in excluded:
            excluded.append('__main__')
        return f'excludes={excluded!r},'
    spec = re.sub(r'excludes=(\[[^\n]*\]),', stable_excludes, spec)
    # Refresh project bytecode separately from the unchanged dependency analysis cache.
    # This also makes an incremental retry pick up source edits deterministically.
    refresh = f'''from PyInstaller.config import CONF
from pathlib import Path
_cache = CONF['code_cache'].get(id(a.pure))
if _cache is not None:
    for _name, _source, _kind in a.pure:
        if _name.startswith(('backend.', 'desktop.')) and _source and Path(_source).is_file():
            _cache[_name] = compile(Path(_source).read_bytes(), _source, 'exec')
pyz = PYZ(a.pure, name={str(stage / 'project-final.pyz')!r})'''
    spec = spec.replace('pyz = PYZ(a.pure)', refresh)
    spec_path = stage / 'Pujian-update.spec'
    spec_path.write_text(spec, encoding='utf-8')
    # Only build the executable. The validated base already contains the unchanged DLLs and models.
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--workpath', str(stage / 'work'),
                    str(spec_path)], cwd=ROOT, check=True)
    # With exclude_binaries=True PyInstaller writes EXE under the work directory.
    shutil.copy2(stage / 'work' / 'Pujian-update' / 'Pujian.exe', stage / 'Pujian.exe')
    create_archive(stage, archive, version, info['version'])
    print(f'Update ZIP: {archive}', flush=True)


if __name__ == '__main__':
    main()
