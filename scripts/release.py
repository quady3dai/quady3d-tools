"""Build the public client artifacts without publishing them.

Requires Node.js 22+, pnpm 10.16.1, uv and a Python environment containing
setuptools>=77 and wheel. Set QUADY3D_BUILD_PYTHON to select that environment.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.1.2"
EPOCH = 1793232000  # 2026-10-29 00:00:00 UTC
OUTPUT = ROOT / "dist" / VERSION
PYTHON = os.environ.get("QUADY3D_BUILD_PYTHON", sys.executable)
ENV = {**os.environ, "SOURCE_DATE_EPOCH": str(EPOCH)}


def run(args, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"Build failed: {args[0]}\n{result.stderr[-6000:]}\n{result.stdout[-3000:]}")
    return result.stdout


def sources():
    root_files = ["README.md", "CHANGELOG.md", "LICENSE", ".gitignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]
    result = [ROOT / name for name in root_files]
    for directory in ["packages/mcp", "packages/typescript", "packages/python", "skills/quady3d", "assets", "scripts"]:
        for item in sorted((ROOT / directory).rglob("*")):
            rel = item.relative_to(ROOT)
            if any(part in {"node_modules", "dist", "build", "__pycache__"} or part.endswith(".egg-info") for part in rel.parts):
                continue
            if item.is_file() and item.suffix in {".md", ".txt", ".json", ".js", ".mjs", ".ts", ".py", ".toml", ".yaml", ".png"}:
                result.append(item)
            elif item.is_file() and item.name in {"LICENSE", "py.typed"}:
                result.append(item)
    for path in result:
        if path.is_symlink() or path.stat().st_size > 128 * 1024:
            raise ValueError(f"Unexpected source file: {path.relative_to(ROOT)}")
    if len(result) > 96:
        raise ValueError("Unexpected source file count")
    return sorted(set(result))


def archive(path, files, prefix):
    stamp = datetime.fromtimestamp(EPOCH, timezone.utc).timetuple()[:6]
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED) as output:
        for file, name in files:
            info = zipfile.ZipInfo(f"{prefix}/{name}", stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, file.read_bytes())


if OUTPUT.exists():
    raise SystemExit("A frozen release already exists. Choose a new version; do not overwrite it.")
for package in ["mcp", "typescript"]:
    data = json.loads((ROOT / "packages" / package / "package.json").read_text())
    assert data["version"] == VERSION and data["private"] is False and data["license"] == "MIT"
    assert data["homepage"].startswith("https://quady3d.com/")
    assert data["repository"]["url"] == "https://github.com/quady3dai/quady3d-tools.git"
assert f'version = "{VERSION}"' in (ROOT / "packages/python/pyproject.toml").read_text()
assert f'"X-Quady3D-Client-Version": "{VERSION}"' in (ROOT / "packages/python/src/quady3d/client.py").read_text()
assert f'"X-Quady3D-Client-Version": "{VERSION}"' in (ROOT / "packages/typescript/src/index.js").read_text()
run(["pnpm", "--filter", "@quady3d/mcp", "typecheck"])
run(["pnpm", "--filter", "@quady3d/mcp", "build"])
run([PYTHON, "-c", "from importlib.metadata import version; assert int(version('setuptools').split('.')[0]) >= 77; version('wheel')"])
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="quady3d-release-", dir=OUTPUT.parent) as temporary:
    stage = Path(temporary)
    for package in ["mcp", "typescript"]:
        packed = json.loads(run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", str(stage)], ROOT / "packages" / package))[0]
        assert packed["version"] == VERSION
        with tarfile.open(stage / packed["filename"]) as tar:
            assert all(m.name.startswith("package/") and ".." not in Path(m.name).parts and (m.isfile() or m.isdir()) for m in tar.getmembers())
    run(["uv", "build", "--no-build-isolation", "--python", PYTHON, "--wheel", "--sdist", "--out-dir", str(stage), str(ROOT / "packages/python")])
    run([PYTHON, str(ROOT / "scripts/normalize-sdk-sdist.py"), str(stage / f"quady3d-{VERSION}.tar.gz"), str(EPOCH)])
    files = sources()
    archive(stage / f"quady3d-clients-{VERSION}.zip", [(p, p.relative_to(ROOT).as_posix()) for p in files], f"quady3d-clients-{VERSION}")
    skill = ROOT / "skills/quady3d"
    archive(stage / f"quady3d-skill-{VERSION}.zip", [(p, p.relative_to(skill).as_posix()) for p in files if p.is_relative_to(skill)], "quady3d")
    names = [f"quady3d-mcp-{VERSION}.tgz", f"quady3d-sdk-{VERSION}.tgz", f"quady3d-{VERSION}-py3-none-any.whl", f"quady3d-{VERSION}.tar.gz", f"quady3d-skill-{VERSION}.zip", f"quady3d-clients-{VERSION}.zip"]
    receipts = []
    for name in names:
        data = (stage / name).read_bytes()
        assert len(data) < 2 * 1024 * 1024
        receipts.append({"filename": name, "bytes": len(data), "sha256": sha256(data).hexdigest()})
    shutil.copyfile(ROOT / "LICENSE", stage / "LICENSE.txt")
    shutil.copyfile(ROOT / "CHANGELOG.md", stage / "CHANGELOG.md")
    (stage / "SHA256SUMS.txt").write_text("".join(f"{f['sha256']}  {f['filename']}\n" for f in receipts))
    (stage / "release.json").write_text(json.dumps({"version": VERSION, "publisher": "Quady3D AI", "license": "MIT", "homepage": "https://quady3d.com/developers", "source": "https://github.com/quady3dai/quady3d-tools", "files": receipts}, indent=2) + "\n")
    stage.rename(OUTPUT)
print(json.dumps({"directory": str(OUTPUT), "files": receipts}, indent=2))
