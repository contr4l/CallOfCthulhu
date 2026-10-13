#!/usr/bin/env python3
"""Dark-specific source extraction; keeps the PDF as authority and never executes its contents."""
import argparse, hashlib, json, re
from pathlib import Path
from collections import defaultdict
from pypdf import PdfReader
import pdfplumber

ROOT=Path(__file__).resolve().parents[2]

def sha(b): return hashlib.sha256(b).hexdigest()
def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode()
    path.write_bytes(raw); return sha(raw)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('source',type=Path); ap.add_argument('--output',type=Path,default=ROOT/'scripts/暗黑独行.dag.json'); a=ap.parse_args()
    source=a.source; raw=source.read_bytes(); reader=PdfReader(source)
    if len(reader.pages)!=102: raise SystemExit('This adapter is scoped to the inspected 102-page Dark edition')
    pages=[]; headingloc={}; page_text={}; image_occ=[]; assets={}
    with pdfplumber.open(source) as pdf:
      for pn,(page,geo) in enumerate(zip(reader.pages,pdf.pages),1):
        text=page.extract_text() or ''; page_text[pn]=text
        row=defaultdict(list)
        for c in geo.chars:
          if 'Voltaire' in c['fontname'] and 23<=c['size']<=26 and c['text'].isdigit():
            col=0 if c['x0']<306 else 1; row[(round(c['top'],1),col)].append(c)
        heads=[]
        for (y,col),chars in row.items():
          value=''.join(c['text'] for c in sorted(chars,key=lambda x:x['x0']))
          if value.isdigit() and 1<=int(value)<=593:
            n=int(value); heads.append({'id':str(n),'column':col,'top':y})
            headingloc.setdefault(str(n),[]).append({'pdfPage':pn,'column':col,'top':y})
        pages.append({'pdfPage':pn,'printedPage':str(pn-1) if pn>=4 else None,'textLayerCharacters':len(geo.chars),'extractedCharacters':len(text),'imageCount':len(geo.images),'classification':'native-text' if len(geo.chars)>120 else ('mixed' if len(geo.chars) else 'scan'),'entryHeadings':sorted(heads,key=lambda h:(h['column'],h['top']))})
        for im in geo.images:
          image_occ.append({'pdfPage':pn,'bbox':[im['x0'],im['top'],im['x1'],im['bottom']],'resourceName':str(im.get('name',''))})
    found={n:locs for n,locs in headingloc.items()}
    missing=sorted(set(map(str,range(1,594)))-set(found)); duplicates={n:v for n,v in found.items() if len(v)!=1}
    if missing or duplicates: raise SystemExit(f'heading audit failed missing={missing[:10]} duplicates={list(duplicates)[:10]}')
    # Preserve the canonical extracted text page-by-page as provenance. Numbered fragments are a first-pass
    # source segmentation; visual layout review remains explicit in each fragment's source coordinates.
    # Offsets refer to the page's canonical pypdf text layer; page heading coordinates identify visual order.
    all_lines=[]
    for pn,t in page_text.items():
      off=0
      for line in t.splitlines(keepends=True):
        m=re.fullmatch(r'\s*(\d{1,3})\s*\n?',line)
        if m and str(int(m.group(1))) in found and found[str(int(m.group(1)))][0]['pdfPage']==pn:
          n=str(int(m.group(1)))
          # select the matching occurrence ordinal on that page in visual order
          locs=[x for x in found[n] if x['pdfPage']==pn]
          all_lines.append({'id':n,'pdfPage':pn,'offsetStart':off,'offsetEnd':off+len(line),'text':line,'location':locs[0]})
        off+=len(line)
    # A complete source record per original entry; preserve the original page text and visual heading location.
    # Text boundaries are based on canonical stream heading offsets, and are marked provisional for multi-column review.
    refs=[]
    for n in range(1,594):
      loc=found[str(n)][0]; pn=loc['pdfPage']; txt=page_text[pn]
      starts=[x for x in all_lines if x['pdfPage']==pn]
      own=next((x for x in starts if x['id']==str(n)),None)
      if own is None:
        # Keep location proof while declining to invent a text boundary where the text layer's line differs.
        body=''; spans=[]
      else:
        same=[x for x in starts if x['offsetStart']>own['offsetStart']]
        stop=min((x['offsetStart'] for x in same),default=len(txt))
        body=txt[own['offsetEnd']:stop]
        spans=[[pn,own['offsetStart'],stop]]
      paragraphs=[]
      if own: paragraphs.append({'id':f'{n}:p0','kind':'heading','text':own['text'],'sourceLocation':f"pdf:spans:{json.dumps([[pn,own['offsetStart'],own['offsetEnd']]],separators=(',',':'))}"})
      if body: paragraphs.append({'id':f'{n}:p1','kind':'body','text':body,'sourceLocation':f"pdf:spans:{json.dumps(spans,separators=(',',':'))}"})
      path=ROOT/'scripts/alone-against-dark/fragments'/f'{n:03}.json'; digest=write(path,{'id':str(n),'document':source.name,'paragraphs':paragraphs,'reviewStatus':'provisional-text-stream-order; visual-column reconstruction required'})
      refs.append({'id':str(n),'fragment':{'path':path.relative_to(ROOT/'scripts').as_posix(),'sha256':digest},'terminal':False})
    supplement={'format':'coc-story-supplements@1','documents':[{'document':source.name,'pages':pages,'entries':[{'kind':'canonical-text-layer','pdfPage':pn,'text':t} for pn,t in page_text.items()]+[{'kind':'image-occurrence','page':i} for i in image_occ]}], 'assets':list(assets.values()),'imageOccurrences':image_occ,'provenance':{'sourceSha256':sha(raw),'sourceSize':len(raw),'pageCount':102,'extractionEngine':'pypdf + pdfplumber','numberHeadingDetection':'pdfplumber character geometry, Voltaire font 23-26pt, x-divider 306pt','entryHeadingCount':593,'entryHeadingIdsComplete':True,'ocrRequiredPages':[p['pdfPage'] for p in pages if p['classification']=='scan' or p['textLayerCharacters']<100], 'ocrCompleted':False,'visualColumnReview':'pending','canonicalPageTextLayer':{str(pn):sha(t.encode()) for pn,t in page_text.items()}}}
    sp=ROOT/'scripts/alone-against-dark/fragments/supplements.json'; sd=write(sp,supplement)
    entry_by_id={x['id']:x for x in refs}; edges=[]; issues=[]
    for n in range(1,594):
      f=json.loads((ROOT/'scripts/alone-against-dark/fragments'/f'{n:03}.json').read_text())
      text=''.join(p['text'] for p in f['paragraphs'])
      for m in re.finditer(r'(?i)\bgo to\s+(?:entry\s+)?(\d{1,3})\b',text):
        dest=m.group(1)
        if dest in entry_by_id: edges.append({'source':str(n),'target':dest,'kind':'printed-reference','basis':'canonical text layer; requires conditional/negative-context review'})
        else: issues.append({'kind':'unresolved-printed-reference','source':str(n),'target':dest})
    graph={'format':'coc-story-graph@2','id':'alone-against-dark','title':'Alone Against the Dark','language':'en','entry':'13','runtimePlayable':False,'source':{'filename':source.name,'sha256':sha(raw),'size':len(raw)},'supplements':{'path':sp.relative_to(ROOT/'scripts').as_posix(),'sha256':sd},'nodes':refs,'edges':edges,'issues':issues+[{'kind':'provisional-source-segmentation','note':'Fragments are grouped by text-stream headings; multi-column visual reordering, paragraph boundaries, supplements and all printed references require review.'},{'kind':'runtime-rules-unreviewed'}]}
    write(a.output,graph)
    print(json.dumps({'pages':102,'entries':593,'edges':len(edges),'images':len(assets),'ocrRequired':[p['pdfPage'] for p in pages if p['classification']=='scan' or p['textLayerCharacters']<100],'sourceSha256':sha(raw),'graph':str(a.output)},ensure_ascii=False))
if __name__=='__main__': main()
