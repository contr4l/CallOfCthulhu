"""Validate source-bound Frost paragraph translations without compiling runtime rules."""
import argparse, hashlib, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
GRAPH=ROOT/'scripts/冰霜独行.dag.json'
TRANSLATIONS=ROOT/'scripts/alone-against-frost/translations/zh-CN'
def sha(data): return hashlib.sha256(data).hexdigest()
def read(p): return json.loads(Path(p).read_text())
def check():
 g=read(GRAPH); m=read(TRANSLATIONS/'manifest.json'); errors=[]; translated=0; source_body=0; words=0
 if m.get('format')!='coc-story-translation@1' or m.get('id')!=g.get('id'): errors.append('translation manifest identity/format mismatch')
 if m.get('sourcePdfSha256')!=g['source']['sha256']: errors.append('source PDF hash mismatch')
 if m.get('sourceGraphFilename')!=GRAPH.name or m.get('sourceGraphSha256')!=sha(GRAPH.read_bytes()): errors.append('source graph hash mismatch')
 by_id={str(n['id']):n for n in g['nodes']}; manifest_ids=set()
 for row in m.get('nodes',[]):
  i=str(row.get('id')); manifest_ids.add(i); node=by_id.get(i)
  if node is None: errors.append(f'unknown source node {i}'); continue
  ref=row.get('fragment',{}); path=(TRANSLATIONS/ref.get('path','')).resolve()
  if not path.is_relative_to(TRANSLATIONS.resolve()): errors.append(f'unsafe translation path: {i}'); continue
  if not path.is_file() or sha(path.read_bytes())!=ref.get('sha256'): errors.append(f'translation file SHA mismatch: {i}'); continue
  t=read(path); source_path=(ROOT/'scripts'/node['fragment']['path']).resolve()
  if not source_path.is_relative_to((ROOT/'scripts').resolve()): errors.append(f'unsafe source path: {i}'); continue
  s=read(source_path)
  if t.get('id')!=i or t.get('language')!='zh-CN' or t.get('sourceFragmentSha256')!=sha(source_path.read_bytes()): errors.append(f'translation source binding mismatch: {i}')
  source_rows=s.get('paragraphs',[]); target_rows=t.get('paragraphs',[])
  if [x.get('id') for x in source_rows] != [x.get('id') for x in target_rows]: errors.append(f'paragraph coverage mismatch: {i}')
  if any(not isinstance(x.get('text'),str) or not x['text'].strip() for x in target_rows): errors.append(f'empty translated paragraph: {i}')
  translated+=len(target_rows)
 for n in g['nodes']:
  if str(n['id']) in manifest_ids:
   s=read(ROOT/'scripts'/n['fragment']['path'])
   for p in s.get('paragraphs',[]):
    if p.get('kind')=='body': source_body+=1; words+=len(re.findall(r"\b[\w’'-]+\b",p.get('text','')))
 if translated!=m.get('coverage',{}).get('translationParagraphs'): errors.append('manifest paragraph count mismatch')
 for ref in m.get('supplements',[]):
  p=(TRANSLATIONS/ref.get('path','')).resolve()
  if not p.is_relative_to(TRANSLATIONS.resolve()): errors.append(f"unsafe supplement translation path: {ref.get('path')}"); continue
  if not p.is_file() or sha(p.read_bytes())!=ref.get('sha256'): errors.append(f"supplement translation SHA mismatch: {ref.get('path')}"); continue
  t=read(p)
  if t.get('format')!='coc-story-supplement-translation@1' or t.get('id')!=g.get('id') or t.get('language')!='zh-CN': errors.append('supplement translation identity/format mismatch')
  if t.get('sourcePdfSha256')!=g['source']['sha256'] or t.get('sourceGraphSha256')!=sha(GRAPH.read_bytes()): errors.append('supplement translation source binding mismatch')
  provenance=read(ROOT/'scripts'/g['supplements']['path'])
  metadata=next((x.get('metadata') for x in provenance['documents'][0]['entries'] if x.get('kind')=='pdf-provenance'),None)
  if metadata is None: errors.append('source PDF page ledger missing for supplement translations')
  else:
   for row in t.get('paragraphs',[]):
    try:
     refs=json.loads(row['sourceLocation'][len('pdf:visual:'):])
     actual='\n'.join(metadata['pdfPages'][page]['canonicalLines'][line]['text'] for page,line in refs)
     if actual!=row.get('sourceText'): errors.append(f"supplement source text mismatch: {row.get('id')}")
     if row.get('sourcePageCanonicalTextSha256')!=metadata['pdfPages'][refs[0][0]]['canonicalTextSha256']: errors.append(f"supplement page SHA mismatch: {row.get('id')}")
    except (KeyError,IndexError,TypeError,ValueError): errors.append(f"invalid supplement source location: {row.get('id')}")
   for card in t.get('characterSheets',[]):
    source=card.get('source',{})
    for path_key,sha_key in [('ocrJsonPath','ocrJsonSha256'),('renderPath','renderSha256')]:
     q=(ROOT/'scripts'/source.get(path_key,'')).resolve()
     if not q.is_relative_to((ROOT/'scripts').resolve()) or not q.is_file() or sha(q.read_bytes())!=source.get(sha_key): errors.append(f"character sheet source asset mismatch: {card.get('id')} {path_key}")
  if not t.get('characterSheets'): errors.append('translated playable character sheets are missing')
  if t.get('runtimePlayable') is not False: errors.append('supplement translation must not claim runtime readiness')
 missing=sorted(set(by_id)-manifest_ids,key=int)
 return {'errors':errors,'translatedNodes':len(manifest_ids),'totalNodes':len(by_id),'translatedParagraphs':translated,'translatedSourceBodyParagraphs':source_body,'translatedSourceEnglishWords':words,'missingNodeCount':len(missing),'missingNodeRanges':compress(missing),'runtimePlayable':False}
def compress(ids):
 if not ids:return []
 nums=list(map(int,ids)); groups=[];start=prev=nums[0]
 for n in nums[1:]:
  if n==prev+1:prev=n
  else:groups.append([start,prev]);start=prev=n
 groups.append([start,prev]);return [str(a) if a==b else f'{a}-{b}' for a,b in groups]
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('command',choices=['check']);p.parse_args();print(json.dumps(check(),ensure_ascii=False))
