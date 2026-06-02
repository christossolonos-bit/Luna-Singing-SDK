#!/usr/bin/env python3
"""Split a mixed song into vocals + instrumental using Demucs (local CPU)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: split_stems.py <input_audio> <work_dir>")

    input_path = Path(sys.argv[1]).resolve()
    work_dir = Path(sys.argv[2]).resolve()
    sep_root = work_dir / "separated"
    sep_root.mkdir(parents=True, exist_ok=True)

    if not input_path.is_file():
        raise SystemExit(f"Input not found: {input_path}")

    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        "htdemucs",
        "-d",
        "cpu",
        "-o",
        str(sep_root),
        str(input_path),
    ]

    subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

    out_base = sep_root / "htdemucs" / input_path.stem
    vocals = out_base / "vocals.wav"
    instrumental = out_base / "no_vocals.wav"

    if not vocals.is_file() or not instrumental.is_file():
        raise SystemExit(f"Demucs finished but outputs missing in {out_base}")

    manifest = {
        "vocals": str(vocals),
        "instrumental": str(instrumental),
    }
    (work_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


if __name__ == "__main__":
    main()
