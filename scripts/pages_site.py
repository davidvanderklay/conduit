"""Combine built docs and the signed Flatpak branch into one Pages artifact."""

import argparse
import shutil
from pathlib import Path


FLATPAK_FILES = (
    "repo/config",
    "repo/summary",
    "repo/summary.sig",
    "conduit.flatpakrepo",
    "conduit-flatpak-signing-key.asc",
    "conduit-flatpak-signing-key.txt",
)


def assemble_site(docs: Path, flatpak: Path, output: Path) -> None:
    """Keep Flatpak paths intact and add docs only after validating both inputs."""
    for base, files in (
        (docs, ("index.html", "search/search_index.json")),
        (flatpak, FLATPAK_FILES),
    ):
        for relative in files:
            path = base / relative
            if not path.is_file() or path.stat().st_size == 0:
                raise ValueError(f"Missing or empty publishing input: {path}")
        if any(path.is_symlink() for path in base.rglob("*")):
            raise ValueError(f"Pages input contains a symlink: {base}")
    if (flatpak / "docs").exists():
        raise ValueError("Flatpak branch already contains the reserved docs path")

    shutil.copytree(flatpak, output, ignore=shutil.ignore_patterns(".git"))
    shutil.copytree(docs, output / "docs")
    (output / ".nojekyll").touch()
    if not (output / "index.html").exists():
        (output / "index.html").write_text(
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Conduit documentation</title>'
            '<meta http-equiv="refresh" content="0;url=docs/">'
            '<body style="background:#000;color:#fff">'
            '<a style="color:#fff" href="docs/">Conduit documentation</a></body></html>\n',
            encoding="utf-8",
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("docs", type=Path)
    parser.add_argument("flatpak", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assemble_site(args.docs, args.flatpak, args.output)
