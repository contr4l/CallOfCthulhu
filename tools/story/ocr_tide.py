"""Offline OCR for image-only Tide supplements, retaining boxes and confidence."""
import csv, hashlib, io, json, subprocess
from pathlib import Path
import pdfplumber
from pdf_tide import dump


def run(source, output):
    source,output=Path(source),Path(output)
    output.mkdir(parents=True,exist_ok=True)
    records=[]
    with pdfplumber.open(source) as document:
      for page in [79,80,81,82,83,84,89]:
        image=Path('/tmp')/f'coc-tide-ocr-{page:03d}.png'
        document.pages[page-1].to_image(resolution=220).save(image)
        result=subprocess.run(['tesseract',str(image.resolve()),'stdout','-l','eng','--psm','3','tsv'],capture_output=True,text=True,encoding="utf-8",errors="replace",check=True)
        tokens=[]
        for row in csv.DictReader(io.StringIO(result.stdout),delimiter='\t'):
          if row.get('text','').strip():
            tokens.append({'text':row['text'],'confidence':float(row['conf']),'bbox':[int(row[k]) for k in ['left','top','width','height']],'line':[int(row[k]) for k in ['block_num','par_num','line_num']]})
        lines=[];previous=None
        for token in tokens:
          if token['line']!=previous:lines.append([]);previous=token['line']
          lines[-1].append(token['text'])
        value={'format':'coc-pdf-ocr@1','pdfPage':page,'printedPage':page-1,'engine':'tesseract','version':subprocess.run(['tesseract','--version'],capture_output=True,text=True,encoding="utf-8",errors="replace",check=True).stdout.splitlines()[0],'language':'eng','resolutionDpi':220,'segmentation':3,'sourcePdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'text':'\n'.join(' '.join(line) for line in lines),'tokens':tokens,'reviewRequired':True,'notes':['OCR is supplemental; original PDF and embedded image assets remain authoritative. Low-confidence fields are not imported as character statistics.']}
        path=output/f'{page:03d}.json';digest=dump(path,value)
        records.append({'pdfPage':page,'path':path.as_posix(),'sha256':digest,'words':len(tokens),'lowConfidenceWords':sum(t['confidence']<70 for t in tokens)})
        image.unlink()
        print(json.dumps(records[-1]),flush=True)
    dump(output/'manifest.json',{'format':'coc-pdf-ocr-index@1','pages':records})
    graph_path=output.parent.parent/'潮汐独行.dag.json'
    if graph_path.exists():
      graph=json.loads(graph_path.read_text())
      if graph['source']['sha256']!=hashlib.sha256(source.read_bytes()).hexdigest():raise ValueError('OCR and source graph refer to different PDFs')
      supplements_path=(graph_path.parent/graph['supplements']['path']).resolve()
      if not supplements_path.is_relative_to(graph_path.parent.resolve()):raise ValueError('Unsafe supplements path')
      supplements=json.loads(supplements_path.read_text())
      metadata=next(e['metadata'] for d in supplements['documents'] for e in d['entries'] if e['kind']=='pdf-provenance')
      metadata['ocrPages']=[{**record,'path':Path(record['path']).resolve().relative_to(graph_path.parent.resolve()).as_posix()} for record in records]
      metadata['extraction']['ocrCompleted']=True
      graph['supplements']['sha256']=dump(supplements_path,supplements)
      dump(graph_path,graph)

    return records

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args();run(a.source,a.output)
