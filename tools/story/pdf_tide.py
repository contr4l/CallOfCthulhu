"""Tide-specific PDF text-layer adapter. Never executes document actions.
Reconstruction verifies the canonical text layer, not original PDF binary equality.
"""
import argparse, hashlib, json, re, unicodedata
from pathlib import Path
from collections import defaultdict, Counter
import pdfplumber
from pypdf import PdfReader


def sha(data): return hashlib.sha256(data).hexdigest()
def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()
    path.write_bytes(raw)
    return sha(raw)
def compact(text): return ''.join(c for c in unicodedata.normalize('NFKC',text) if c.isalnum())
def location(spans): return 'pdf:spans:'+json.dumps(spans,separators=(',',':'))

def extract(source,output):
    source,output=Path(source),Path(output); reader=PdfReader(source)
    if len(reader.pages)!=90 or 'Alone Against' not in (reader.pages[0].extract_text() or ''):
        raise ValueError('This adapter supports only the inspected 90-page Tide PDF edition')
    root=output.parent/'alone-against-tide'; nodes={}; supplement=[]; ledger=[]; assets={}; refs=[]; issues=[]
    cached=None
    if output.exists():
      old=json.loads(output.read_text())
      if old['source']['sha256']==sha(source.read_bytes()):
        old_supp=json.loads((output.parent/old['supplements']['path']).read_text())
        cached=old_supp if 'assets' in old_supp else next(e['metadata'] for d in old_supp['documents'] for e in d['entries'] if e['kind']=='pdf-provenance')
        assets={a['sha256']:a for a in cached['assets']};refs=cached['imageOccurrences']
    current=None; paragraph=None
    def finish():
        nonlocal paragraph
        if paragraph:
            rows=nodes[current]['paragraphs']
            rows.append({'id':f'{current}:p{len(rows)}','kind':'body','text':paragraph['text'],'sourceLocation':location(paragraph['spans'])})
        paragraph=None
    with pdfplumber.open(source) as layout:
      for pi,(page,geo) in enumerate(zip(reader.pages,layout.pages),1):
        text=page.extract_text() or ''
        ledger.append({'pdfPage':pi,'printedPage':str(pi-1) if 3<=pi<=89 else None,'textSha256':sha(text.encode()),'characters':len(text),'width':geo.width,'height':geo.height,'imageCount':len(geo.images),'imageBounds':[{'name':im['name'],'bbox':[im['x0'],im['top'],im['x1'],im['bottom']]} for im in geo.images],'textLayerCharacters':len(geo.chars)})
        if '\ufffd' in text: issues.append({'kind':'unmapped-text-layer-glyph','pdfPage':pi,'count':text.count('\ufffd'),'resolution':'retain raw glyph; translate prose with annotated review'})
        divider=330 if pi==9 else 306
        heads=defaultdict(str)
        for c in geo.chars:
          if 8<pi<79 and 'Voltaire' in c['fontname'] and abs(c['size']-25)<.01 and c['text'].isdigit(): heads[(round(c['top'],1),0 if c['x0']<divider else 1)]+=c['text']
        ledger[-1]['entryHeadings']=[{'id':value,'column':col,'top':y} for (y,col),value in sorted(heads.items(),key=lambda pair:(pair[0][1],pair[0][0]))]
        head_ids=list(heads.values())
        if any(not 1<=int(n)<=243 for n in head_ids):raise ValueError('unexpected entry heading')
        lines=[];cursor=0
        for line in text.splitlines(keepends=True):lines.append((cursor,cursor+len(line),line));cursor+=len(line)
        markers={}
        for n in head_ids:
          matches=[start for start,end,line in lines if line.strip()==n]
          if not matches:raise ValueError(f'heading {n} missing from text layer page {pi}')
          markers[matches[-1]]=n
        # Natural paragraph starts are indented in the book. Match raw text lines
        # against positioned glyph rows independently of the stream reading order.
        visual=defaultdict(list)
        for c in geo.chars:
          if c['upright'] and 7<=c['size']<=10 and ('Caslon' in c['fontname'] or 'Calibri' in c['fontname']):
            visual[(round(geo.height-c['matrix'][5],1),0 if c['x0']<divider else 1)].append(c)
        margin={col:Counter(round(min(c['x0'] for c in cs)) for (y,k),cs in visual.items() if k==col).most_common(1)[0][0] if any(k==col for y,k in visual) else 0 for col in (0,1)}
        indent={};positions=defaultdict(list)
        for (y,col),cs in visual.items():
          cs.sort(key=lambda c:c['x0']);key=compact(''.join(c['text'] for c in cs));indent[key]=min(c['x0'] for c in cs)>margin[col]+5;positions[key].append((col,y))
        rotated=compact(''.join(c['text'] for c in geo.chars if not c['upright']))
        ordered=[]
        for start,end,line in lines:
          stripped=line.strip();key=compact(line);span=[pi,start,end]
          if start in markers:
            n=markers[start];(y,col)=next(k for k,value in heads.items() if value==n)
            ordered.append((col,y,start,end,line));continue
          decorative=(not 9<=pi<=78 or not stripped or stripped in ['ALONE AGAINST THE TIDE','ALONE AGAINST','THE TIDE','B','O','K','R','U','G','START','ST ART'] or (rotated and key==rotated) or (stripped==str(pi-1) and key not in positions) or (re.fullmatch(r'[A-Z0-9]+',stripped) and key not in positions))
          if decorative:
            supplement.append({'kind':'p','section':'page-wrapper-or-supplement','text':line,'sourceLocation':location([span])});continue
          candidates=positions.get(key,[])
          if not candidates:
            # Non-body labels in artwork stay with supplements; unresolved body
            # lines must stop extraction instead of guessing their destination.
            if not 9<=pi<=78:
              supplement.append({'kind':'p','section':'page-wrapper-or-supplement','text':line,'sourceLocation':location([span])});continue
            raise ValueError(f'Unmapped body line page {pi}, offset {start}: {line!r}')
          col,y=sorted(candidates)[0];candidates.remove((col,y))
          ordered.append((col,y,start,end,line))
        if [r[2] for r in ordered] != [r[2] for r in sorted(ordered)]:
          issues.append({'kind':'text-stream-differs-from-column-reading-order','pdfPage':pi,'resolution':'body ordered by left/right column and vertical glyph position'})
        for col,y,start,end,line in sorted(ordered):
          span=[pi,start,end];stripped=line.strip()
          if start in markers:
            finish();current=markers[start]
            if current in nodes:raise ValueError('duplicate heading '+current)
            nodes[current]={'id':current,'document':source.name,'paragraphs':[{'id':current+':p0','kind':'heading','text':line,'sourceLocation':location([span])}]}
          elif current is None:
            supplement.append({'kind':'p','section':'start-instructions','text':line,'sourceLocation':location([span])})
          else:
            trace=bool(re.fullmatch(r'\([^\n]+\)',stripped))
            special=stripped.startswith('•') or trace or bool(re.match(r'^\d+(?:[.–:]|–\d+:)\s',stripped))
            in_rule=paragraph and (paragraph['text'].lstrip().startswith('•') or re.match(r'^\d+(?:[.–:]|–)',paragraph['text'].lstrip()))
            if special or (indent.get(compact(line),False) and paragraph and not in_rule):finish()
            if paragraph is None:paragraph={'text':'','spans':[]}
            paragraph['text']+=line;paragraph['spans'].append(span)
            if trace:finish()
        # Preserve decoded image bytes once, and retain each page occurrence.
        for im in ([] if cached else page.images):
          raw=im.data;digest=sha(raw);suffix=Path(im.name).suffix.lower() or '.bin'
          path=root/'assets'/f'{digest}{suffix}'
          if digest not in assets:
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            assets[digest]={'path':path.relative_to(output.parent).as_posix(),'sha256':digest,'size':len(raw),'name':im.name}
          refs.append({'pdfPage':pi,'imageName':im.name,'assetSha256':digest})
      finish()
    if list(nodes)!=[str(i) for i in range(1,244)]:raise ValueError('Visual column order does not produce sequential headings 1–243')
    if set(nodes)!={str(i) for i in range(1,244)}:raise ValueError('Missing or unexpected entry numbers')
    graphnodes=[];edges=[]
    for n in sorted(nodes,key=int):
      fragment=nodes[n];path=root/'fragments'/f'{int(n):03d}.json';digest=dump(path,fragment)
      terminal=any('THE END' in p['text'] for p in fragment['paragraphs'])
      graphnodes.append({'id':n,'fragment':{'path':path.relative_to(output.parent).as_posix(),'sha256':digest},'terminal':terminal})
      for par in fragment['paragraphs']:
        for match in re.finditer(r'\b(?:go|turn|return|proceed)\s+(?:back\s+)?to\s+(?:number\s+|entry\s+)?(\d+)\b',par['text'],re.I):
          target=match[1]
          if target not in nodes:issues.append({'kind':'dangling-printed-reference','paragraphId':par['id'],'target':target});continue
          edges.append({'id':f'e{len(edges)}','source':n,'target':target,'paragraphId':par['id'],'evidence':'printed-prose-number','textOffset':match.start()})
        if re.search(r'\b(return|go back)\b',par['text'],re.I) and not re.search(r'\bto\s+\d+',par['text']):issues.append({'kind':'dynamic-return-or-prose-review','paragraphId':par['id']})
    supplements={'documents':[{'document':source.name,'entries':supplement}],'pdfPages':ledger,'assets':list(assets.values()),'imageOccurrences':refs,'extraction':{'engine':'pypdf text layer + pdfplumber heading/indent geometry','ocrRequiredPages':[p['pdfPage'] for p in ledger if p['textLayerCharacters']<100 and p['imageCount'] and p['pdfPage'] not in [1,2,90]],'binaryOriginalRetained':True}}
    metadata={k:v for k,v in supplements.items() if k!='documents'}
    if cached:
      for key in ['ocrPages','visualReview']:
        if key in cached:metadata[key]=cached[key]
    metadata['extraction']['ocrCompleted']=bool(metadata.get('ocrPages'))
    metadata['extraction']['notes']=['Reconstruction proves complete canonical PDF text-layer coverage; original binary PDF and decoded image assets remain authoritative.','OCR character statistics require visual review and are not runtime presets.']
    supplements={'documents':[{'document':source.name,'entries':supplement+[{'kind':'pdf-provenance','section':'source-integrity','sourceLocation':'pdf:document','metadata':metadata}]}]}
    sp=root/'fragments/supplements.json';digest=dump(sp,supplements)
    graph={'format':'coc-story-graph@2','id':'alone-against-tide','title':'Alone Against the Tide','language':'en','entry':'1','runtimePlayable':False,'source':{'filename':source.name,'sha256':sha(source.read_bytes()),'size':source.stat().st_size},'supplements':{'path':sp.relative_to(output.parent).as_posix(),'sha256':digest},'nodes':graphnodes,'edges':edges,'issues':issues}
    graph['issues'].append({'kind':'unreviewed-runtime-rules','note':'Printed edges and end markers require separate review of conditions, combat, creation and persistence.'})
    for node in graphnodes:
      if node['terminal'] and any(e['source']==node['id'] for e in edges):graph['issues'].append({'kind':'conditional-end-marker','nodeId':node['id']})
    for n,item in nodes.items():
      for par in item['paragraphs']:
        if re.fullmatch(r'[A-Z]{6,}',par['text'].strip()):graph['issues'].append({'kind':'decorative-or-unmapped-glyph-sequence','paragraphId':par['id'],'note':'Preserved in raw source; not treated as an executable rule.'})
    dump(output,graph);return verify(source,output)

def verify(source,graph_path):
    source,graph_path=Path(source),Path(graph_path);graph=json.loads(graph_path.read_text());reader=PdfReader(source)
    if sha(source.read_bytes())!=graph['source']['sha256']:raise ValueError('Original PDF changed')
    texts=[p.extract_text() or '' for p in reader.pages]
    pieces=defaultdict(list)
    for ref in [n['fragment'] for n in graph['nodes']]+[graph['supplements']]:
      path=(graph_path.parent/ref['path']).resolve()
      if not path.is_relative_to(graph_path.parent.resolve()):raise ValueError('Unsafe path')
      raw=path.read_bytes()
      if sha(raw)!=ref['sha256']:raise ValueError('Fragment changed')
      item=json.loads(raw);rows=item.get('paragraphs') or [e for d in item['documents'] for e in d['entries']]
      for row in rows:
        if not row['sourceLocation'].startswith('pdf:spans:'):continue
        spans=json.loads(row['sourceLocation'].removeprefix('pdf:spans:'));recovered=[]
        for page,start,end in spans:
          text=texts[page-1];recovered.append(text[start:end]);pieces[page].append((start,end,text[start:end]))
        if ''.join(recovered)!=row['text']:raise ValueError('Paragraph provenance mismatch')
    for page in range(1,len(reader.pages)+1):
      text=texts[page-1];cursor=0;restored=[]
      for start,end,value in sorted(pieces[page]):
        if start!=cursor:raise ValueError(f'Gap or overlap page {page}, {cursor}/{start}')
        restored.append(value);cursor=end
      if ''.join(restored)!=text:raise ValueError('Text layer reconstruction failed')
    sp=json.loads((graph_path.parent/graph['supplements']['path']).read_text())
    metadata=next(e['metadata'] for d in sp['documents'] for e in d['entries'] if e['kind']=='pdf-provenance')
    for ref in metadata['assets']:
      p=(graph_path.parent/ref['path']).resolve()
      if not p.is_relative_to(graph_path.parent.resolve()) or sha(p.read_bytes())!=ref['sha256']:raise ValueError('Image asset changed')
    for ref in metadata.get('ocrPages',[])+([metadata['visualReview']] if metadata.get('visualReview') else []):
      p=(graph_path.parent/ref['path']).resolve()
      if not p.is_relative_to(graph_path.parent.resolve()) or sha(p.read_bytes())!=ref['sha256']:raise ValueError('OCR asset changed')
      if json.loads(p.read_text())['sourcePdfSha256']!=graph['source']['sha256']:raise ValueError('OCR belongs to a different PDF')
    return {'entries':len(graph['nodes']),'edges':len(graph['edges']),'endings':sum(n['terminal'] for n in graph['nodes']),'pdfPages':len(reader.pages),'textLayerReconstructed':True,'assets':len(metadata['assets']),'ocrRequiredPages':metadata['extraction']['ocrRequiredPages']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['extract','verify']);parser.add_argument('source');parser.add_argument('graph');args=parser.parse_args()
    print(json.dumps((extract if args.command=='extract' else verify)(args.source,args.graph),ensure_ascii=False))
