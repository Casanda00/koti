"""Rebuilds index.html from src/koti.template.html, embedding apps-script.gs.
Run after editing either file:  python3 build.py"""
from pathlib import Path
root = Path(__file__).parent
template = (root / "src" / "koti.template.html").read_text(encoding="utf-8")
script = (root / "apps-script.gs").read_text(encoding="utf-8")
assert "</script" not in script
(root / "index.html").write_text(template.replace("/*__APPS_SCRIPT__*/", script), encoding="utf-8")
print("index.html rebuilt")
