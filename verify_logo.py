from pathlib import Path
from PIL import Image
import json

html_path = Path("popup.html")
html = html_path.read_text(encoding="utf-8")
html = html.replace(
'''      <div class="brand">
        <img class="brand-logo" src="icons/icon48.png" alt="" width="40" height="40">
        <div>
          <h1>DupaTab</h1>
          <p class="subtitle">Find duplicates. You decide what closes.</p>
        </div>
      </div>''',
'''      <div class="brand">
        <img class="brand-logo" src="icons/logo-popup.png" alt="" width="40" height="40">
        <div class="brand-copy">
          <h1><span class="brand-dupa">Dupa</span><span class="brand-tab">Tab</span></h1>
          <p class="subtitle">Find duplicates. You decide what closes.</p>
        </div>
      </div>''',
1)
html_path.write_text(html, encoding="utf-8")

css_path = Path("popup.css")
css = css_path.read_text(encoding="utf-8")
extra = '''
.brand-copy {
  min-width: 0;
}

.brand-dupa {
  color: #082b6f;
}

.brand-tab {
  color: #1677f2;
}
'''
if ".brand-dupa {" not in css:
    css += "\n" + extra
css_path.write_text(css, encoding="utf-8")

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
assert manifest["manifest_version"] == 3
for size in (16, 32, 48, 128):
    p = Path("icons") / f"icon{size}.png"
    with Image.open(p) as im:
        assert im.size == (size, size), (p, im.size)
with Image.open(Path("icons/logo-popup.png")) as im:
    assert im.size == (96, 96)

Path("apply_logo.py").unlink(missing_ok=True)
print("logo integration verified")
