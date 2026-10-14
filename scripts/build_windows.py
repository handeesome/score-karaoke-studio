"""Build, validate and ZIP a Windows desktop release; called by build-windows.ps1."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))


def run(args, **kwargs):
    print("Running: " + subprocess.list2cmdline([str(arg) for arg in args]), flush=True)
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True, **kwargs)


def copy_ocr(target: Path, supplied: Path | None):
    binary = shutil.which("tesseract")
    source = supplied or (Path(binary).parent if binary else Path(r"C:\Program Files\Tesseract-OCR"))
    for name in ("tesseract.exe", "tessdata/chi_sim.traineddata", "tessdata/eng.traineddata"):
        if not (source / name).is_file():
            raise RuntimeError(f"离线包缺少 OCR 文件 {source / name}；请安装 Tesseract 中文/英文包或指定 -TesseractPath。")
    target.mkdir(parents=True, exist_ok=True)
    for file in source.iterdir():
        if file.is_file() and (file.suffix.lower() in (".dll", ".txt") or file.name == "tesseract.exe"
                               or "license" in file.name.lower() or "copying" in file.name.lower()):
            shutil.copy2(file, target / file.name)
    shutil.copytree(source / "tessdata", target / "tessdata", dirs_exist_ok=True)


def copy_numpy_compat(bundle: Path):
    # Pretrained Demucs checkpoints pickle arrays as numpy.core.multiarray.
    # NumPy 2 moved the implementation to _core; preserve its legacy wrappers,
    # which PyInstaller's NumPy hook may omit as apparently unused modules.
    import numpy
    source = Path(numpy.__file__).parent / "core"
    target = bundle / "_internal" / "numpy" / "core"
    target.mkdir(parents=True, exist_ok=True)
    for file in source.glob("*.py"):
        shutil.copy2(file, target / file.name)


def notices(target):
    target.mkdir(parents=True, exist_ok=True)
    python_license = Path(sys.base_prefix) / "LICENSE"
    if python_license.is_file():
        shutil.copy2(python_license, target / "Python-LICENSE.txt")
    packages = []
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name", "unknown")
        packages.append({"name": name, "version": distribution.version,
                         "license": distribution.metadata.get("License-Expression") or distribution.metadata.get("License"),
                         "home": distribution.metadata.get("Home-page")})
        for file in distribution.files or []:
            if any(word in str(file).lower() for word in ("license", "copying", "notice")):
                source = Path(distribution.locate_file(file))
                if source.is_file() and source.suffix.lower() not in (".py", ".pyc", ".pyd"):
                    destination = target / name / Path(str(file)).name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
    (target / "packages.json").write_text(json.dumps(packages, ensure_ascii=False, indent=2), encoding="utf-8")


def test_environment(data):
    # A model override on the build computer must not hide a missing bundled file.
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith("PUJIAN_") and key != "HF_HUB_OFFLINE"}
    environment["PUJIAN_DATA_DIR"] = str(data)
    return environment


def create_archive(bundle: Path, archive: Path):
    if archive.exists():
        raise RuntimeError(f"发行包已存在：{archive}")
    partial = archive.with_suffix(".zip.partial")
    with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zipped:
        for file in sorted(bundle.rglob("*")):
            if file.is_file():
                zipped.write(file, Path("Pujian") / file.relative_to(bundle))
    if partial.stat().st_size >= 2 * 1024**3:
        raise RuntimeError(f"压缩包超过 GitHub 单附件 2 GiB 限制：{partial}。请将模型分开发布。")
    partial.replace(archive)


def build(args):
    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise RuntimeError("请在 Windows x64 上构建 Windows 发行包")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    edition = "offline" if args.include_models else "standard"
    # Use a fresh staging directory each time. Never delete a previous release or user data.
    output = ROOT / "release"
    output.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="windows-", dir=ROOT / "build"))
    archive = output / f"Pujian-v{version}-Windows-x64-{edition}.zip"
    if archive.exists():
        raise RuntimeError(f"发行包已存在：{archive}。请修改版本号或手动移走旧 ZIP 后重试。")
    if args.include_models:
        from prepare_models import prepare
        # Fail early if models/OCR are missing, before the expensive EXE build.
        prepare(stage / "models", args.whisper, args.demucs, args.download_models)
        copy_ocr(stage / "tesseract", args.tesseract)
    if args.webview2 and not (args.webview2 / "msedgewebview2.exe").is_file():
        raise RuntimeError("-WebView2Path 必须指向解压后的 Windows x64 Fixed Version Runtime 目录")
    pyinstaller = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--windowed",
                   "--name", "Pujian", "--paths", ROOT, "--distpath", stage,
                   "--workpath", stage / "work", "--specpath", stage,
                   "--add-data", f"{ROOT / 'dist'};dist",
                   "--hidden-import", "uvicorn.logging", "--hidden-import", "uvicorn.loops.auto",
                   "--hidden-import", "uvicorn.protocols.http.auto", "--hidden-import", "uvicorn.protocols.websockets.auto",
                   "--hidden-import", "uvicorn.lifespan.on", "--hidden-import", "demucs.separate",
                   "--hidden-import", "desktop.windows_job", "--hidden-import", "backend.main",
                   "--exclude-module", "IPython", "--exclude-module", "pytest", "--exclude-module", "matplotlib",
                   "--exclude-module", "PyQt5", "--exclude-module", "PyQt6", "--exclude-module", "PySide6"]
    for package in ("webview", "demucs", "faster_whisper", "ctranslate2", "imageio_ffmpeg", "julius", "lameenc"):
        pyinstaller += ["--collect-all", package]
    run([*pyinstaller, ROOT / "desktop" / "app.py"])
    bundle = stage / "Pujian"
    copy_numpy_compat(bundle)
    shutil.copy2(ROOT / "LICENSE", bundle / "LICENSE")
    shutil.copy2(ROOT / "desktop" / "使用说明.txt", bundle / "使用说明.txt")
    shutil.copy2(ROOT / "desktop" / "修复启动.cmd", bundle / "修复启动.cmd")
    notices(bundle / "third-party-notices")
    if args.include_models:
        (bundle / "tools").mkdir(exist_ok=True)
        (stage / "models").rename(bundle / "models")
        (stage / "tesseract").rename(bundle / "tools" / "tesseract")
        (bundle / "offline.json").write_text(json.dumps({"models": ["whisper-base", "htdemucs"]}), encoding="utf-8")
    if args.webview2:
        shutil.copytree(args.webview2, bundle / "tools" / "webview2")
    (bundle / "build-info.json").write_text(json.dumps({"version": version, "edition": edition,
        "python": sys.version, "architecture": platform.machine()}, ensure_ascii=False, indent=2), encoding="utf-8")
    # Run the generated EXE, not the source interpreter. Test files stay outside the release ZIP.
    test_data = stage / "smoke-data"
    try:
        run([bundle / "Pujian.exe", "--smoke-test"], env=test_environment(test_data), timeout=300)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"EXE 自检失败，请查看 {test_data / 'desktop.log'} 和 backend.log") from error
    report = json.loads((test_data / "smoke-test.json").read_text(encoding="utf-8"))
    if report.get("ok") is not True:
        raise RuntimeError(f"发行包检查失败，请查看 {test_data}")
    create_archive(bundle, archive)
    print(f"\nRelease ZIP: {archive}\nTested folder: {bundle}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-models", action="store_true")
    parser.add_argument("--download-models", action="store_true")
    parser.add_argument("--whisper", type=Path)
    parser.add_argument("--demucs", type=Path)
    parser.add_argument("--tesseract", type=Path)
    parser.add_argument("--webview2", type=Path)
    args = parser.parse_args()
    if args.download_models and not args.include_models:
        parser.error("--download-models 需要 --include-models")
    (ROOT / "build").mkdir(exist_ok=True)
    build(args)
