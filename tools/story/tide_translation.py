"""Validate and freeze per-entry Tide translations without publishing runtime rules."""
import argparse, collections, hashlib, json, re, shutil
from pathlib import Path

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def numbers(text):return collections.Counter(re.findall(r'\d+(?:\.\d+)?',text))
def check(graph_path,stage):
    graph_path,stage=Path(graph_path),Path(stage);graph=json.loads(graph_path.read_text());errors=[];notes=[];count=0
    for node in graph['nodes']:
      source=graph_path.parent/node['fragment']['path'];target=stage/f"{int(node['id']):03d}.json"
      if not target.exists():errors.append({'id':node['id'],'error':'missing translation'});continue
      raw=json.loads(source.read_text());translated=json.loads(target.read_text())
      if translated.get('id')!=node['id'] or translated.get('language')!='zh-CN' or translated.get('translator')!='GPT-6 Luna':errors.append({'id':node['id'],'error':'identity mismatch'})
      if translated.get('sourceFragmentSha256')!=digest(source):errors.append({'id':node['id'],'error':'source hash mismatch'})
      ids=[p['id'] for p in raw['paragraphs']];tids=[p['id'] for p in translated.get('paragraphs',[])]
      if ids!=tids:errors.append({'id':node['id'],'error':'paragraph coverage/order mismatch'});continue
      for a,b in zip(raw['paragraphs'],translated['paragraphs']):
        if not b['text'].strip():errors.append({'paragraphId':a['id'],'error':'empty translation'})
        missing=numbers(a['text'])-numbers(b['text'])
        if missing:errors.append({'paragraphId':a['id'],'error':'numeric content missing','values':dict(missing)})
        source_dice=collections.Counter(re.findall(r'\b\d*D\d+\b',a['text'],re.I));target_dice=collections.Counter(re.findall(r'\d*[dD]\d+',b['text']))
        source_dice=collections.Counter({k.upper():v for k,v in source_dice.items()});target_dice=collections.Counter({k.upper():v for k,v in target_dice.items()})
        if source_dice-target_dice:errors.append({'paragraphId':a['id'],'error':'dice expression missing','values':dict(source_dice-target_dice)})
        if '\n' in b['text'] and '\n\n' not in b['text']:notes.append({'paragraphId':a['id'],'kind':'list-linebreak-preserved'})
        count+=1
      notes.extend({'id':node['id'],'kind':'translator-review-note','note':note} for note in translated.get('notes',[]))
    extras=sorted(p.name for p in stage.glob('[0-9]*.json') if str(int(p.stem)) not in {n['id'] for n in graph['nodes']})
    if extras:errors.append({'error':'unexpected numbered files','files':extras})
    return {'entries':len(graph['nodes']),'translatedParagraphs':count,'errors':errors,'reviewNotes':notes,'sourceGraphSha256':digest(graph_path),'sourcePdfSha256':graph['source']['sha256']}

def freeze(graph_path,stage,output):
    graph_path,stage,output=Path(graph_path),Path(stage),Path(output)
    report=check(graph_path,stage)
    if report['errors']:raise ValueError(json.dumps(report['errors'],ensure_ascii=False))
    output.mkdir(parents=True,exist_ok=True);refs=[]
    for p in sorted(stage.glob('[0-9]*.json')):
      dest=output/p.name;shutil.copyfile(p,dest);refs.append({'id':str(int(p.stem)),'fragment':{'path':p.name,'sha256':digest(dest)}})
    manifest={'format':'coc-story-translation@1','id':'alone-against-tide','language':'zh-CN','version':'0.1.0','status':'model-translated-review-required','runtimePlayable':False,'translator':'GPT-6 Luna','sourcePdfSha256':report['sourcePdfSha256'],'sourceGraphFilename':Path(graph_path).name,'sourceGraphSha256':report['sourceGraphSha256'],'nodes':refs,'reviewNotes':report['reviewNotes']}
    supplement_input=stage.parent/'supplement-input.json'
    wrapper_input=stage.parent/'wrapper-input.json'
    supplement_stage=stage.parent/'zh-CN-supplements'
    if supplement_input.exists() and wrapper_input.exists():
      wrapper=json.loads(wrapper_input.read_text())
      items=json.loads(supplement_input.read_text())['items']+wrapper['items']
      manifest['supplements']=[]
      for item in items:
        if not re.fullmatch(r'(?:page|ocr|wrapper)-[0-9]{3}',item['id']):raise ValueError('Unsafe supplement ID')
        path=supplement_stage/(item['id']+'.json');value=json.loads(path.read_text())
        if value['id']!=item['id'] or value['language']!='zh-CN' or value['translator']!='GPT-6 Luna':raise ValueError('Supplement identity mismatch')
        if value['sourceTextSha256']!=hashlib.sha256(item['text'].encode()).hexdigest():raise ValueError('Supplement source text changed')
        target=output/'supplements'/path.name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
        locations=item.get('sourceLocations',[f"ocr:pdf-page:{item['pdfPage']}"] if item['id'].startswith('ocr-') else [])
        manifest['supplements'].append({'id':item['id'],'fragment':{'path':target.relative_to(output).as_posix(),'sha256':digest(target)},'sourceLocations':locations})
        manifest['reviewNotes'].extend({'id':item['id'],'note':note} for note in value['notes'])
      manifest['supplementOccurrences']=wrapper['occurrences'];manifest['neutralLayout']=wrapper['neutralLayout']
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('command',choices=['check','freeze']);p.add_argument('graph');p.add_argument('stage');p.add_argument('--output');a=p.parse_args()
    result=check(a.graph,a.stage) if a.command=='check' else freeze(a.graph,a.stage,a.output)
    print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(result['errors']))
