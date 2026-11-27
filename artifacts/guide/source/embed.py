"""Inline the screenshots into guide.html as data URIs so the page is self-contained."""
import base64
import re
import sys
from pathlib import Path

src, img_dir, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
html = src.read_text(encoding="utf-8")


def inline(match: re.Match) -> str:
    data = (img_dir / match.group(1)).read_bytes()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


html, count = re.subn(r"\{\{([\w.-]+\.png)\}\}", inline, html)
out.write_text(html, encoding="utf-8")
print(f"embedded {count} images -> {out} ({out.stat().st_size // 1024} KB)")
