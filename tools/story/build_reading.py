"""Build presentation-only bilingual text without changing published rule packages."""
import hashlib, json, re, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'scripts/CHA23145 - Alone Against the Flames.epub'
ns = {'h': 'http://www.w3.org/1999/xhtml'}
with zipfile.ZipFile(source) as book:
    document = ET.fromstring(book.read('OEBPS/Print_Alone_Against_the_Flames.xhtml'))
english = {}
current = None
for paragraph in document.findall('.//h:p', ns):
    text = ''.join(paragraph.itertext()).strip()
    if paragraph.get('class') == 'Head-1':
        current = text if text.isdigit() and 1 <= int(text) <= 270 else None
        if current: english.setdefault(current, [])
        continue
    if not current or not text: continue
    # Original EPUB uses this character style for rules and numbered routing.
    if any('CharOverride-11' in (e.get('class') or '').split() for e in paragraph.iter()): continue
    if re.search(r'\b(?:go|turn)\s+to\s+\d+|^The End\.?$', text, re.I): continue
    english[current].append(text)
assert set(english) == {str(i) for i in range(1, 271)}
cn = json.loads((ROOT / 'stories/alone-against-flames/1.1.0/story.json').read_text())
cn_by_id = {n['id']: n for n in cn['nodes']}
endings = {'185-end': 'Riding toward dawn', '223-end': 'Leaving Emberhead', '247-end': 'A narrow escape', 'fire-death': 'Consumed by fire'}
for version in ['1.0.0', '1.1.0']:
    folder = ROOT / 'stories/alone-against-flames' / version
    story = json.loads((folder / 'story.json').read_text())
    nodes = {}
    for node in story['nodes']:
        source_id = node.get('sourceId')
        if source_id not in english: source_id = '40'
        en = english[source_id]
        if node['id'] == 'fire-death': en = ['Flames consume you. You have failed to escape Emberhead. Your investigation ends in the fire.']
        if node['id'] == 'survived': en = ['You have survived the ordeal at Emberhead. The darkness behind you gives way to a new dawn.']
        title = 'Alone Against the Flames'
        if node['id'] in endings: title += ' · ' + endings[node['id']]
        chinese = cn_by_id.get(node['id'], cn_by_id[source_id])
        nodes[node['id']] = {'en': {'title': title, 'text': en}, 'zh-CN': {'title': chinese['title'], 'text': chinese['text']}}
    payload = {'storyId': story['id'], 'version': version, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'nodes': nodes}
    (folder / 'reading.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(version, len(nodes), 'bilingual scenes')
