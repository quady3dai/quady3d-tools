"""Normalize metadata in our bounded Python source package without extracting it."""
import gzip
import io
from pathlib import Path
import sys
import tarfile

path = Path(sys.argv[1])
epoch = int(sys.argv[2])
if path.stat().st_size > 256 * 1024:
    raise ValueError("Unexpected source package size")
output = io.BytesIO()
with tarfile.open(path, "r:gz") as source:
    members = source.getmembers()
    if len(members) > 64 or sum(item.size for item in members) > 2 * 1024 * 1024:
        raise ValueError("Unexpected source package contents")
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=epoch) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as target:
            for item in sorted(members, key=lambda item: item.name):
                if not (item.isfile() or item.isdir()) or item.name.startswith("/") or ".." in Path(item.name).parts:
                    raise ValueError("Unexpected source package member")
                item.mtime = epoch
                item.uid = item.gid = 0
                item.uname = item.gname = ""
                item.pax_headers = {}
                item.mode = 0o755 if item.isdir() else 0o644
                target.addfile(item, source.extractfile(item) if item.isfile() else None)
path.write_bytes(output.getvalue())
