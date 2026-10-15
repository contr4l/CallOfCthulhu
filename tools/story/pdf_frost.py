"""Frost-only PDF source adapter. It uses positioned glyphs because pypdf omits visible left-column text on some pages."""
import argparse, hashlib, json, re
from collections import defaultdict
from pathlib import Path
import pdfplumber
from pypdf import PdfReader

def sha(b): return hashlib.sha256(b).hexdigest()
def dump(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);b=(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode();p.write_bytes(b);return sha(b)
def visual_rows(page):
    buckets=defaultdict(list)
    for c in page.chars:
        col=(0 if c['x0']<315 else 1) if c.get('upright',True) else 2
        buckets[(round(c['top']/2),col)].append(c)
    rows=[]
    for (yk,col),cs in sorted(buckets.items(),key=lambda x:(x[0][1],x[0][0])):
        cs.sort(key=lambda c:c['x0']); out=''; prev=None
        for c in cs:
            if prev is not None and c['x0']-prev['x1']>max(1.1,c['size']*.16): out+=' '
            out+=c['text'];prev=c
        rows.append({'text':out,'column':col,'top':min(c['top'] for c in cs),'bottom':max(c['bottom'] for c in cs),'x0':min(c['x0'] for c in cs),'x1':max(c['x1'] for c in cs),'fontSize':max(c['size'] for c in cs),'span':[page.page_number,round(min(c['x0'] for c in cs),2),round(min(c['top'] for c in cs),2),round(max(c['x1'] for c in cs),2),round(max(c['bottom'] for c in cs),2)]})
    for i,row in enumerate(rows): row['lineId']=i; row['span']=[page.page_number,i,row['span'][1],row['span'][2],row['span'][3],row['span'][4]]
    return rows

def extract(source,graph_path):
    source=Path(source); graph_path=Path(graph_path); root=graph_path.parent/'alone-against-frost'; reader=PdfReader(source)
    if len(reader.pages)!=122: raise ValueError('Expected the inspected 122-page source PDF')
    nodes={}; supplements=[]; ledger=[]; assets={}; occurrences=[]; current=None; paragraph=None
    def finish():
        nonlocal paragraph
        if paragraph:
            rows=nodes[current]['paragraphs']; rows.append({'id':f'{current}:p{len(rows)}','kind':'body','text':paragraph['text'],'sourceLocation':'pdf:visual:'+json.dumps([[v[0],v[1]] for v in paragraph['spans']],separators=(',',':'))})
        paragraph=None
    def supp(text,span,section):
        supplements.append({'kind':'p','section':section,'text':text,'sourceLocation':'pdf:visual:'+json.dumps([[span[0],span[1]]],separators=(',',':'))})
    with pdfplumber.open(source) as doc:
      for pi,(page,geo) in enumerate(zip(reader.pages,doc.pages),1):
        rows=visual_rows(geo); page_text=page.extract_text() or ''
        heads=[r for r in rows if 10<=pi<=108 and r['column'] in (0,1) and 22<=r['fontSize']<=27 and re.fullmatch(r'\s*\d{1,3}\s*',r['text']) and 1<=int(r['text'])<=654]
        # Read columns in visible order. Both headings and body are ordered left-to-right, top-to-bottom.
        head_ids=[str(int(r['text'])) for r in heads]
        if len(head_ids)!=len(set(head_ids)): raise ValueError(f'duplicate visual heading on PDF page {pi}: {head_ids}')
        ledger.append({'pdfPage':pi,'printedPage':str(pi-1) if 3<=pi<=121 else None,'pypdfTextChars':len(page_text),'visualTextChars':sum(len(r['text']) for r in rows),'canonicalLines':[{'text':r['text'],'column':r['column'],'bbox':r['span'][2:6],'fontSize':r['fontSize']} for r in rows],'canonicalTextSha256':sha(('\n'.join(r['text'] for r in rows)).encode()),'imageCount':len(geo.images),'imageBounds':[{'name':im['name'],'bbox':[im['x0'],im['top'],im['x1'],im['bottom']]} for im in geo.images],'entryHeadings':[{'id':n,'column':r['column'],'top':r['top']} for n,r in zip(head_ids,heads)],'layout':'visual-glyph-lines' if 10<=pi<=108 else 'supplement'})
        head_lookup={id(r):str(int(r['text'])) for r in heads}
        from collections import Counter
        margins={col:Counter(round(r['x0']) for r in rows if r['column']==col and 7<=r['fontSize']<=11 and 95<=r['top']<=735).most_common(1)[0][0] for col in (0,1) if any(r['column']==col and 7<=r['fontSize']<=11 and 95<=r['top']<=735 for r in rows)}
        if not 10<=pi<=108:
            for r in rows: supp(r['text'],r['span'],'front-or-back-matter')
        else:
            for r in rows:
                t=r['text']; stripped=t.strip();span=r['span']
                if id(r) in head_lookup:
                    finish();current=head_lookup[id(r)]
                    if current in nodes: raise ValueError(f'duplicate entry {current}')
                    nodes[current]={'id':current,'document':source.name,'paragraphs':[{'id':current+':p0','kind':'heading','text':stripped,'sourceLocation':'pdf:visual:'+json.dumps([[span[0],span[1]]],separators=(',',':'))}]}
                    continue
                # Page numbers are page-furniture only when the visible glyph string agrees with
                # the printed-page ledger and the centered bottom geometry. Numeric story content
                # elsewhere (including tables and narrow columns) remains in its source entry.
                printed_page=str(pi-1) if 3<=pi<=121 else None
                if (printed_page is not None and r['top']>=725 and r['fontSize']>=12
                    and 285<=r['x0']<=325 and stripped==printed_page):
                    supp(stripped,span,'page-furniture');continue
                # Running header/footer, watermark and outside-column labels are supplements, never discarded.
                if r['column']==2 or r['top']<65 or r['top']>744 or not stripped or (r['x0']<56):
                    supp(t,span,'page-wrapper-or-artwork-label');continue
                # A paragraph starts after vertical whitespace or an indented first line.
                if current is None:
                    supp(t,span,'page-wrapper');continue
                trace=bool(re.fullmatch(r'\([^()]+\)',stripped))
                if trace: finish()
                if paragraph is not None:
                    prior=paragraph['last']; gap=r['top']-prior['bottom']
                    indented=r['column'] in margins and r['x0']>margins[r['column']]+4
                    if (r['column']!=prior['column'] and indented) or (r['column']==prior['column'] and (gap>5 or (indented and gap>1))): finish()
                if paragraph is None: paragraph={'text':'','spans':[],'last':r,'kind':'trace' if trace else 'body'}
                if paragraph['text']: paragraph['text']+='\n'
                paragraph['text']+=t;paragraph['spans'].append(span);paragraph['last']=r
                if trace: finish()
        finish()
        for im in page.images:
            raw=im.data;digest=sha(raw);ext=Path(im.name).suffix.lower() or '.bin';dest=root/'assets'/f'{digest}{ext}'
            if digest not in assets:
                dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw);assets[digest]={'path':dest.relative_to(graph_path.parent).as_posix(),'sha256':digest,'size':len(raw),'name':im.name}
            occurrences.append({'pdfPage':pi,'name':im.name,'assetSha256':digest})
    if list(nodes)!=[str(i) for i in range(1,655)]: raise ValueError(f'visual column order did not yield 1–654; found {len(nodes)} entries; first mismatch at {next((i for i,n in enumerate(nodes,1) if n!=str(i)),None)}')
    graph_nodes=[];edges=[]
    for n,fragment in nodes.items():
        fp=root/'fragments'/f'{int(n):03}.json';digest=dump(fp,fragment);terminal=any('THE END' in p['text'] for p in fragment['paragraphs'])
        graph_nodes.append({'id':n,'fragment':{'path':fp.relative_to(graph_path.parent).as_posix(),'sha256':digest},'terminal':terminal})
        for p in fragment['paragraphs']:
            for m in re.finditer(r'\b(?:go|turn|return|proceed)\s+(?:back\s+)?to\s+(?:number\s+|entry\s+)?(\d+)\b',p['text'],re.I):
                edges.append({'id':f'e{len(edges)}','source':n,'target':m[1],'paragraphId':p['id'],'evidence':'printed-prose-number','textOffset':m.start()})
    metadata={'pdfPages':ledger,'assets':list(assets.values()),'imageOccurrences':occurrences,'extraction':{'engine':'pdfplumber positioned glyphs, 2-column geometry; visible section headings ordered left then right','textLayerNote':'pypdf extract_text omits visible text in the left column on PDF page 13; this adapter reads positioned glyphs directly.','ocrRequiredPages':[p['pdfPage'] for p in ledger if p['visualTextChars']<100 and p['imageCount'] and p['pdfPage'] not in [1,2,122]],'ocrCompleted':False,'binaryOriginalRetained':True,'canonicalText':'Each PDF page stores visual-order glyph lines in pdfPages[].canonicalLines; canonicalTextSha256 is SHA-256 of those lines joined by LF.'}}
    supplements.append({'kind':'pdf-provenance','section':'source-integrity','sourceLocation':'pdf:document','metadata':metadata})
    sp={'documents':[{'document':source.name,'entries':supplements}]}
    spath=root/'fragments/supplements.json';sd=dump(spath,sp)
    graph={'format':'coc-story-graph@2','id':'alone-against-frost','title':'冰霜独行','language':'en','entry':'1','runtimePlayable':False,'source':{'filename':source.name,'sha256':sha(source.read_bytes()),'size':source.stat().st_size},'supplements':{'path':spath.relative_to(graph_path.parent).as_posix(),'sha256':sd},'nodes':graph_nodes,'edges':edges,'issues':[{'kind':'unreviewed-runtime-rules','note':'Source graph only; condition branches, companion state, luck spending, combat and insanity need reviewed programs.'}]}
    dump(graph_path,graph)
    return {'entries':len(graph_nodes),'edges':len(edges),'pdfPages':len(reader.pages),'assets':len(assets),'ocrRequiredPages':metadata['extraction']['ocrRequiredPages'],'sourceSha256':graph['source']['sha256']}

def verify(source,graph_path):
    source=Path(source);graph_path=Path(graph_path);g=json.loads(graph_path.read_text())
    if sha(source.read_bytes())!=g['source']['sha256']: raise ValueError('original PDF SHA-256 mismatch')
    sp=json.loads((graph_path.parent/g['supplements']['path']).read_text());metadata=next(e['metadata'] for d in sp['documents'] for e in d['entries'] if e.get('kind')=='pdf-provenance');pages=metadata['pdfPages']
    if len(PdfReader(source).pages)!=len(pages): raise ValueError('page ledger mismatch')
    with pdfplumber.open(source) as pdf:
        if len(pdf.pages)!=len(pages): raise ValueError('pdfplumber page count mismatch')
        for pi,(layout_page,record) in enumerate(zip(pdf.pages,pages),1):
            rebuilt=visual_rows(layout_page); texts=[r['text'] for r in rebuilt]; saved=[r['text'] for r in record['canonicalLines']]
            if texts!=saved or sha(('\n'.join(texts)).encode())!=record['canonicalTextSha256']: raise ValueError(f'canonical glyph reconstruction mismatch page {pi}')
    uses=defaultdict(list)
    refs=[(n['fragment'],n['id']) for n in g['nodes']]+[(g['supplements'],None)]
    for ref,node_id in refs:
        p=(graph_path.parent/ref['path']).resolve()
        if not p.is_relative_to(graph_path.parent.resolve()) or sha(p.read_bytes())!=ref['sha256']: raise ValueError('unsafe or modified source fragment')
        obj=json.loads(p.read_text()); rows=obj.get('paragraphs',[]) if node_id else [e for d in obj['documents'] for e in d['entries']]
        for row in rows:
            loc=row.get('sourceLocation','')
            if not loc.startswith('pdf:visual:'): continue
            coords=json.loads(loc.removeprefix('pdf:visual:')); line_text=[]
            for pg,li in coords:
                canonical=pages[pg-1]['canonicalLines'][li]['text'];uses[(pg,li)].append({'id':row.get('id','supplement'),'nodeId':node_id,'section':row.get('section')});line_text.append(canonical)
            if row['text']!='\n'.join(line_text): raise ValueError('visual canonical source mismatch: '+row['id'])
    footer_candidates=[]
    for pi,page in enumerate(pages,1):
        if sha(('\n'.join(x['text'] for x in page['canonicalLines'])).encode())!=page['canonicalTextSha256']: raise ValueError(f'canonical text hash mismatch page {pi}')
        missing=[i for i in range(len(page['canonicalLines'])) if (pi,i) not in uses]
        duplicate=[i for i in range(len(page['canonicalLines'])) if len(uses[(pi,i)])!=1]
        if missing or duplicate: raise ValueError(f'canonical glyph-line coverage failed page {pi}: missing={missing[:5]} duplicate={duplicate[:5]}')
        printed=page.get('printedPage')
        for li,line in enumerate(page['canonicalLines']):
            x0,y0,x1,y1=line['bbox']; candidate=(printed is not None and y0>=725 and line['fontSize']>=12 and 285<=x0<=325 and line['text'].strip()==str(printed))
            if candidate:
                ref=uses[(pi,li)][0]
                if ref['nodeId'] is not None or ref.get('section')!='page-furniture': raise ValueError(f'printed page number not classified as page-furniture: PDF p.{pi}')
                footer_candidates.append(pi)
    audit=metadata.get('pageFooterAudit',{})
    if audit.get('matchedCount')!=len(footer_candidates) or audit.get('pdfPages')!=footer_candidates: raise ValueError('page footer audit does not match canonical geometry')
    for asset in metadata['assets']:
        p=(graph_path.parent/asset['path']).resolve()
        if not p.is_relative_to(graph_path.parent.resolve()) or sha(p.read_bytes())!=asset['sha256']: raise ValueError('image asset integrity mismatch')
    for ocr in metadata.get('ocrPages',[]):
        p=(graph_path.parent/ocr['path']).resolve()
        if not p.is_relative_to(graph_path.parent.resolve()) or sha(p.read_bytes())!=ocr['sha256']: raise ValueError('OCR asset integrity mismatch')
        if json.loads(p.read_text()).get('sourcePdfSha256')!=g['source']['sha256']: raise ValueError('OCR belongs to a different source PDF')
    return {'entries':len(g['nodes']),'sourceSha256Verified':True,'pdfPages':len(pages),'canonicalLineCoverage':'complete','assets':len(metadata['assets']),'ocrPages':len(metadata.get('ocrPages',[])),'pageFooters':len(footer_candidates)}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['extract','verify']);ap.add_argument('source');ap.add_argument('graph');a=ap.parse_args()
    print(json.dumps((extract if a.command=='extract' else verify)(a.source,a.graph),ensure_ascii=False))
