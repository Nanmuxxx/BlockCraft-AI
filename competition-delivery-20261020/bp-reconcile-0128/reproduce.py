"""Offline minimal PPTX text update; requires the unmodified Windows source and changes.json."""
from pathlib import Path
import json, zipfile
from lxml import etree as E

root = Path(__file__).resolve().parent
changes = json.loads((root / 'changes.json').read_text())
source = root / 'original-windows/BlockCraftAI_BP_Final_Redesign.pptx'
target = root / 'candidate/BlockCraftAI_BP_Reconciled_Candidate.pptx'
target.parent.mkdir(exist_ok=True)
count = 0
with zipfile.ZipFile(source) as z, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as w:
    for name in z.namelist():
        data = z.read(name)
        if name.startswith('ppt/slides/slide') and name.endswith('.xml'):
            page = int(name.split('slide')[-1].split('.')[0])
            tree = E.fromstring(data)
            for t in tree.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}t'):
                for change in changes:
                    if change['page'] == page and change['old'] == t.text:
                        t.text = change['new']
                        count += 1
                        break
            data = E.tostring(tree, xml_declaration=True, encoding='UTF-8', standalone=True)
        w.writestr(name, data)
assert count == len(changes), (count, len(changes))
print(target)
