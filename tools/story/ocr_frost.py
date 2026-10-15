"""OCR-only supplement for Frost pages with image-only or sparse text regions."""
import argparse, hashlib, json, subprocess, tempfile
from pathlib import Path
from pypdf import PdfReader

def sha(b): return hashlib.sha256(b).hexdigest()
def main(pdf,graph_path):
    pdf=Path(pdf);graph_path=Path(graph_path);graph=json.loads(graph_path.read_text());sp_path=graph_path.parent/graph['supplements']['path'];sp=json.loads(sp_path.read_text()); provenance=next(e['metadata'] for d in sp['documents'] for e in d['entries'] if e.get('kind')=='pdf-provenance')
    ledger=provenance['pdfPages'];pages=[p['pdfPage'] for p in ledger if p['visualTextChars']<100 and p['imageCount'] and p['pdfPage'] not in [1,2,122]]
    out=graph_path.parent/'alone-against-frost/ocr';out.mkdir(parents=True,exist_ok=True);results=[]
    with tempfile.TemporaryDirectory(prefix='frost-ocr-') as td:
      for pn in pages:
        prefix=Path(td)/f'page-{pn:03d}'
        subprocess.run(['pdftoppm','-f',str(pn),'-l',str(pn),'-r','250','-singlefile','-png',str(pdf),str(prefix)],check=True,stdout=subprocess.DEVNULL)
        image=Path(str(prefix)+'.png');saved_image=out/f'page-{pn:03}.png';saved_image.write_bytes(image.read_bytes());tsv=subprocess.run(['tesseract',str(image),'stdout','-l','eng','--psm','6','tsv'],check=True,capture_output=True,text=True).stdout
        rows=[];texts=[]
        for line in tsv.splitlines()[1:]:
          cols=line.split('\t')
          if len(cols)<12: continue
          try: conf=float(cols[10])
          except ValueError: continue
          word=cols[11].strip()
          if not word: continue
          rows.append({'left':int(cols[6]),'top':int(cols[7]),'width':int(cols[8]),'height':int(cols[9]),'confidence':conf,'text':word});texts.append(word)
        data={'pdfPage':pn,'sourcePdfSha256':graph['source']['sha256'],'renderDpi':250,'engine':subprocess.run(['tesseract','--version'],capture_output=True,text=True,check=True).stdout.splitlines()[0],'language':'eng','pageSegmentationMode':6,'ocrText':' '.join(texts),'words':rows,'renderPath':saved_image.relative_to(graph_path.parent).as_posix(),'renderSha256':sha(saved_image.read_bytes())}
        raw=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode();path=out/f'page-{pn:03}.json';path.write_bytes(raw)
        results.append({'pdfPage':pn,'path':path.relative_to(graph_path.parent).as_posix(),'sha256':sha(raw),'words':len(rows),'renderPath':data['renderPath'],'renderSha256':data['renderSha256']})
    provenance['ocrPages']=results;provenance['extraction']['ocrCompleted']=all(r['words']>0 for r in results);provenance['extraction']['ocrMethod']='Poppler render 250 DPI + Tesseract eng --psm 6; word bounding boxes and confidence retained; original PDF remains authoritative.'
    raw=(json.dumps(sp,ensure_ascii=False,indent=2)+'\n').encode();sp_path.write_bytes(raw);graph['supplements']['sha256']=sha(raw);graph_path.write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n')
    return {'pages':len(results),'words':sum(r['words'] for r in results),'results':results}
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('pdf');ap.add_argument('graph');a=ap.parse_args();print(json.dumps(main(a.pdf,a.graph),ensure_ascii=False))
