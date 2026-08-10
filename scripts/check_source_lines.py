from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    ROOT / "backend" / "app",
    ROOT / "backend" / "tests",
    ROOT / "backend" / "alembic",
    ROOT / "frontend" / "src",
    ROOT / "voice-media" / "src",
)
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".css"}
IGNORED_PARTS = {"node_modules", ".next", "__pycache__", "dist", "build"}
MAX_LINES = 600


def source_files():
    for source_root in SOURCE_ROOTS:
        for path in source_root.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in IGNORED_PARTS for part in path.parts):
                continue
            yield path


def main() -> int:
    violations: list[tuple[int, Path]] = []
    for path in source_files():
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        if line_count > MAX_LINES:
            violations.append((line_count, path.relative_to(ROOT)))
    if not violations:
        print(f"source line limit ok: every owned file is <= {MAX_LINES} lines")
        return 0
    print(f"source line limit failed: {len(violations)} file(s) exceed {MAX_LINES} lines")
    for line_count, path in sorted(violations, reverse=True):
        print(f"  {line_count:5d}  {path}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
