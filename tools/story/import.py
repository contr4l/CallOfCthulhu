"""Extract author-only draft paragraphs; no rule is inferred as authoritative."""
import argparse,json,re,zipfile
from pathlib import Path
from html.parser import HTMLParser
class TextExtractor(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]
    def handle_data(self,data): self.parts.append(data)
    def handle_starttag(self,tag,attrs):
        if tag in ('p','br','h1','h2','h3','div'): self.parts.append('\n')
def main():
    parser=argparse.ArgumentParser(description='将 EPUB / 编号 TXT 提取为作者草稿，需要人工校对后发布。')
    parser.add_argument('source',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    paragraphs=[]
    if args.source.suffix.lower()=='.txt':
        text=args.source.read_text(encoding='utf-8');start=text.find('本体部分:');text=text[start:] if start>=0 else text
        paragraphs=[{'sourceId':n,'text':s.strip(),'source':str(args.source),'candidateTargets':re.findall(r'转到\s*(\d+)',s),'reviewRequired':True} for n,s in re.findall(r"\$t1 == '(\d+)'\?\s*`([\s\S]*?)`,",text)]
    elif args.source.suffix.lower()=='.epub':
        with zipfile.ZipFile(args.source) as archive:
            for name in sorted(archive.namelist()):
                if not name.lower().endswith(('.xhtml','.html','.htm')): continue
                p=TextExtractor();p.feed(archive.read(name).decode('utf-8',errors='replace'))
                paragraphs.append({'sourceId':name,'text':''.join(p.parts).strip(),'source':str(args.source),'reviewRequired':True})
    else:parser.error('仅支持 EPUB 和编号 TXT')
    if not paragraphs:parser.error('未找到可提取段落')
    ids=[p['sourceId'] for p in paragraphs]
    if len(ids)!=len(set(ids)):parser.error('来源编号重复，请人工检查')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({'status':'draft','publishable':False,'ordering':'source-file-order-not-game-order','reviewRequired':['paragraph segmentation','checks and difficulty','conditional choices','effects and endings'],'paragraphs':paragraphs},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'已提取 {len(paragraphs)} 个来源片段至 {args.output}；这是作者草稿，不是可发布的游戏剧本。')
if __name__=='__main__':main()
