"""Compile the two supplied books into reviewed, data-only solo programs.
Pattern extraction handles regular paragraphs; explicit overrides below encode special rules.
The build fails on a paragraph without an executable exit, or any missing target.
"""
import json,re,zipfile,hashlib
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[2]
LABELS={'心理学':'psychology','体质':'con','敏捷':'dex','力量':'str','意志':'pow','智力':'int','侦查':'spotHidden','聆听':'listen','博物学':'naturalWorld','机械维修':'mechanicalRepair','神秘学':'occult','理智':'sanity','幸运':'luck','急救':'firstAid','闪避':'dodge','恐吓':'intimidate','说服':'persuade','潜行':'stealth','导航':'navigate','格斗（斗殴）':'fightingBrawl'}
EN={'Disguise':'disguise','Persuade':'persuade','Archaeology':'archaeology','Fast Talk':'fastTalk','Spot Hidden':'spotHidden','Natural World':'naturalWorld','Charm':'charm','Climb':'climb','CON':'con','STR':'str','DEX':'dex','APP':'app','POW':'pow','INT':'int','Luck':'luck','Sanity':'sanity','Dodge':'dodge','Psychology':'psychology','Credit Rating':'creditRating','Stealth':'stealth','Listen':'listen','Library Use':'libraryUse','Track':'track','First Aid':'firstAid','Locksmith':'locksmith','Intimidate':'intimidate','Ride':'ride','Fighting (Brawl)':'fightingBrawl','Fighting(Brawl)':'fightingBrawl','Science (Botany)':'scienceBotany','Drive Auto':'driveAuto'}
def flag(k,v=True):
 if v and k.startswith('skillMark.'):return {'op':'register','kind':'skill','key':k[len('skillMark.'):]}
 if v and re.search(r'[\u3400-\u9fff]',k):return {'op':'register','kind':'state','key':k}
 return {'op':'flag','key':k,'value':v}
def add(k,v):return {'op':'add','field':k,'value':v}
def setv(k,v):return {'op':'set','field':k,'value':v}
def pred(k,v=True):return {'flag':k,'equals':v}
def cmp(k,op,v):return {'field':k,'op':op,'value':v}
def effects(*e,condition=None):return {'kind':'effects','effects':list(e),**({'condition':condition} if condition else {})}
def route(t,condition=None):return {'kind':'route','target':str(t),**({'condition':condition} if condition else {})}
def choices(*items):return {'kind':'choices','choices':list(items)}
def choice(label,t=None,condition=None,e=None,once=None,id=None):return {'id':id or 'to-'+str(t), 'label':label, **({'target':str(t)} if t is not None else {}),**({'condition':condition} if condition else {}),**({'effects':e} if e else {}),**({'once':once} if once else {})}
def check(skill,success=None,failure=None,**kwargs):
 cond=kwargs.pop('condition',None)
 return {'kind':'check',**({'condition':cond} if cond else {}),'check':{'skill':LABELS.get(skill,EN.get(skill,skill)),'label':skill,'difficulty':'regular',**({'success':str(success)} if success else {}),**({'failure':str(failure)} if failure else {}),**kwargs}}
def end(label):return {'kind':'end','label':label}
def normal_text(lines):return [l for l in lines if not re.search(r'\b(?:go|turn) to \d+|^(?:Make (?:a|an)|Look at your investigator sheet|Conduct close-quarters|When you have done|Now |Roll |On your investigator sheet)|^(?:如果(?:检定|孤注)|进行一次|记录(?:你|当前)|在记录表|受到 \d|失去 \d|恢复 \d|(?:要|\*要|或者，要).*(?:转到|回到|勾选)|(?:转到|回到)\s*\d|选择一项|根据你的选择|你可能会多次|——如果|（)',l,re.I)] or ['按当前规则操作继续。']
def load_static():
 path=ROOT/'scripts/静躁独行.txt';s=path.read_text();return path,{k:[l.strip() for l in v.strip().splitlines() if l.strip()] for k,v in re.findall(r"\$t1 == '(\d+)'\?\s*`([\s\S]*?)`",s) if int(k)<372}
def flags_in(l):
 found=[]
 for m in re.finditer(r'(?:记录表上的\s*|且\s+|或\s+)([^，。；：]+?)(?:\s*(?:已被|未被|被|有至少|或|且)|\s*$)',l):
  k=m[1].strip();
  if k and not k.startswith('如果'):found.append(k)
 # Most conditions list names before their single shared predicate.
 m=re.search(r'记录表上的\s*(.+?)(?:\s*(?:已被|被|未被|有至少))',l)
 if m:found=[x.strip() for x in re.split(r'\s+或\s+',m[1])]
 if '且' in l:
  m2=re.search(r'且\s*(\S+)\s*未被',l)
  if m2:return {'all':[pred(found[0]),pred(m2[1],False)]}
 c={'any':[pred(x) for x in found]} if len(found)>1 else pred(found[0], '未被' not in l) if found else None
 if '首次' in l and c:c={'all':[cmp('visits.current','eq',1),c]}
 return c

def static_effects(l):
 out=[]
 for m in re.finditer(r'(?:在记录表上)?勾选\s+([^，。；]+)',l):out.append(flag(m[1].strip()))
 for m in re.finditer(r'(失去|损失|受到|恢复)\s*(\d+(?:D\d+)?)\s*点?(理智|伤害|生命|幸运)',l):
  n=m[2];out.append(add({'理智':'sanity','伤害':'hp','生命':'hp','幸运':'luck'}[m[3]],('-' if m[1]!='恢复' else '')+n if 'D' in n else int(n)*(1 if m[1]=='恢复' else -1)))
 if re.search(r'恢复\s*\d+\s*点生命和',l):
  m=re.search(r'和\s*(\d+(?:D\d+)?)\s*点幸运',l)
  if m:out.append(add('luck',m[1] if 'D' in m[1] else int(m[1])))
 return out

def parse_static(k,lines):
 prog=[];cs=[];i=0;once=any('尚未选择' in l for l in lines)
 while i<len(lines):
  l=lines[i];i+=1
  if re.search('进行一次.*检定',l):
   label=next((x for x in LABELS if x in l),None)
   if not label:raise ValueError((k,'unknown check',l))
   prefix=l.split('进行一次')[0];pre=static_effects(prefix)
   if pre:prog.append(effects(*pre))
   cfg=check(label);c=cfg['check'];c['difficulty']='hard' if '困难' in l else 'regular'
   if '惩罚骰' in l and '记录表' not in l:c['penalty']=1
   if '奖励骰' in l and '记录表' not in l:c['bonus']=1
   if '双手染红' in l:c['modifiers']=[{'condition':pred('双手染红'),'penalty':1}]
   if '舒适派' in l:c['modifiers']=[{'condition':pred('舒适派'),'bonus':1}]
   if '着凉' in l:c['modifiers']=[{'condition':pred('着凉'),'penalty':1},{'condition':pred('实用派'),'bonus':1}]
   if re.search('如果(?:你|检定)失败',l):c['failureEffects']=static_effects(l)
   if '如果检定成功' in l:c['successEffects']=static_effects(l)
   # Subsequent outcome sentences belong to this check, including pushed outcomes.
   while i<len(lines) and re.match(r'如果(?:检定|孤注)|受到 ',lines[i]):
    q=lines[i];i+=1
    if '希望孤注' in q:continue
    branch='success' if '成功' in q else 'failure'
    t=re.search(r'(?:转到|回到)\s*(\d+)',q)
    if '孤注' in q:
     c.setdefault('push',{})[branch]=t[1]
    elif t:c[branch]=t[1]
    es=static_effects(q)
    if es:c.setdefault(branch+'Effects',[]).extend(es)
   # A check offered as an action must not run before the player chooses it.
   if l.startswith('要'):
    virtual=k+'-check-'+str(len(cs));AUX[virtual]=[cfg]
    cs.append(choice(l.split('，')[0],virtual,id='check-'+str(len(cs))))
   else:prog.append(cfg)
   continue
  if l.startswith(('如果记录','或者，如果记录','如果你是首次')):
   t=re.search(r'转到\s*(\d+)',l);cond=flags_in(l)
   if t and cond:
    if '可以' in l:cs.append(choice(l.split('，')[1],t[1],cond,id='optional-'+t[1]))
    else:prog.append(route(t[1],cond))
   continue
  es=static_effects(l)
  if es and not l.startswith(('要','或者，要')) and (not l.startswith('如果') or '生命值有损失' in l):prog.append(effects(*es));continue
  t=re.search(r'(?:转到|回到)\s*(\d+)',l)
  if t and not l.startswith('如果'):
   label=re.split(r'(?:转到|回到)',l)[0].strip('，。 *') or '继续'
   cs.append(choice(label,t[1],once=(k+'-'+t[1]) if once else None,id='to-'+t[1]))
 if cs:prog.append(choices(*cs))
 elif any('结局' in l or '完成了整个故事' in l for l in lines):prog.append(end('结局 · '+k))
 return prog
AUX={}
def static_module():
 path,raw=load_static();AUX.clear();programs={k:parse_static(k,v) for k,v in raw.items()}
 # Shared-choice/conditional-effect paragraphs do not use the ordinary numbered syntax.
 for k in ['91','92']:programs[k]=[choices(choice('穿 T 恤和牛仔裤',93,e=[flag('实用派')],id='practical'),choice('穿运动裤和毛衣',93,e=[flag('舒适派')],id='comfortable'))]
 programs['0']=[choices(choice('作为亚历克斯开始',1,pred('亚历克斯'),id='alex'),choice('作为查理开始',2,pred('查理'),id='charlie'))]
 programs['9'].insert(0,route(363,{'all':[pred('时间之铁'),pred('临阵磨刀',False)]}))
 programs['117']=[choices(choice('恐吓陌生人','117-intimidate'),choice('说服陌生人','117-persuade'),choice('关门',128))]
 AUX['117-intimidate']=[check('恐吓',119,130)];AUX['117-persuade']=[check('说服',125,136)]
 programs['69']=[choices(choice('带走匕首并辨认','69-occult',e=[flag('削铁如泥')]),choice('放下匕首，返回',66))];AUX['69-occult']=[check('神秘学',361,362)]
 # Revisited tapes are consumed as exploration options, preserving the flags as records.
 programs['34'].insert(0,effects({'op':'sanityBaseline'}))
 programs['186']=[route(187,{'all':[pred('傍晚时的寂静'),cmp('used.tape-evening','eq',0)]}),route(196,{'all':[pred('小屋中的伴侣'),cmp('used.tape-couple','eq',0)]}),choices(choice('播放昨晚的磁带',208,once='186-208'),choice('离开电视',223))]
 programs['187'].insert(0,effects(setv('counter.tapeEvening',1)));programs['196'].insert(0,effects(setv('counter.tapeCouple',1)))
 # The implicit forced tape routes count as selecting that tape (not every scene revisit).
 for k in ['187','196']:programs[k].insert(0,effects(flag('tape-'+k)))
 programs['186'][0]['condition']={'all':[pred('傍晚时的寂静'),pred('tape-187',False)]};programs['186'][1]['condition']={'all':[pred('小屋中的伴侣'),pred('tape-196',False)]}
 programs['238'].insert(0,effects(setv('counter.nextBonus',1)))
 programs['325']=[check('体质','$return',324)]
 programs['328']=[choices(choice('继续原来的调查','$return'))]
 programs['329']=[check('智力','329-die','$return')];AUX['329-die']=[{'kind':'random','sides':4,'targets':['330','331','332','333'],'unvisited':True,'exhausted':'334'}]
 for k,skills in {'330':['fightingBrawl'],'331':['spotHidden'],'332':['persuade','intimidate'],'333':['listen']}.items():programs[k]=[effects(*[add('counter.penalty.'+s,1) for s in skills]),choices(choice('继续原来的调查','$return'))]
 programs.update({k:v for k,v in AUX.items() if k not in ['117-check-0','117-check-1','69-check-0']})
 for k,v in programs.items():
  if k not in raw:raw[k]=raw.get(k.split('-')[0],['进行检定。'])
  if not v or v[-1]['kind'] not in ['choices','route','end','check','random']:raise ValueError((k,'unfinished',v))
 # Helper checks must have a destination, never fall through silently.
 for k,v in programs.items():
  for s in v:
   if s['kind']=='check' and s is v[-1] and not all(x in s['check'] for x in ['success','failure']):raise ValueError((k,'missing check exit',s))
 presets=[]
 for name in ['alex','charlie']:
  t=json.loads((ROOT/f'chars/alone-against-static/{name}.json').read_text());presets.append({k:t[k] for k in ['id','label','description','occupation','skills','hp','sanity','attributes','mp','damageBonus']}|{'templateId':t['id']})
 return make_story('alone-against-static','静躁独行',path,raw,programs,presets,'fixed','static',['186 的强制磁带入口按尚未选择过解释：每盘磁带入口只强制进入一次，保留原记录标记。','325 重伤阈值按中文原文过半生命值；理智规则采用单次损失至少 5、同日累计五分之一，34 的新一天重设累计基准。'])
class Paragraphs(HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.current=None
 def handle_starttag(self,t,a):
  if t=='p':self.current=[dict(a).get('class',''),[]]
 def handle_data(self,d):
  if self.current:self.current[1].append(d)
 def handle_endtag(self,t):
  if t=='p' and self.current:self.rows.append((self.current[0],''.join(self.current[1]).strip()));self.current=None

def load_flames():
 path=ROOT/'scripts/CHA23145 - Alone Against the Flames.epub'
 with zipfile.ZipFile(path) as z:
  p=Paragraphs();p.feed(z.read('OEBPS/Print_Alone_Against_the_Flames.xhtml').decode())
 raw={};k=None
 for cls,t in p.rows:
  if cls=='Head-1' and t.isdigit():k=t;raw[k]=[]
  elif k and t:raw[k].append(t)
 # The back-cover/blank-sheet fragments follow the final ending, outside the story.
 raw['270']=raw['270'][:raw['270'].index('The End.')+1]
 return path,raw

def en_effects(l):
 out=[]
 for m in re.finditer(r'(?:Lose|Take|restore|Restore|heal|lost)\s+(\d+(?:D\d+)?)\s+(?:points? (?:of |back )?)?(Sanity|hit points?|damage)',l):
  num=m[1];sign=1 if m[0].startswith(('restore','Restore','heal')) else -1
  out.append(add('sanity' if m[2]=='Sanity' else 'hp',num if sign==1 and 'D' in num else '-'+num if 'D' in num else int(num)*sign))
 if re.search('check-mark|small box',l):
  names=[x for x in EN if x in l]
  if names:out.append(flag('skillMark.'+EN[max(names,key=len)]))
 return out

def parse_flames(k,lines):
 prog=[];cs=[];text='\n'.join(lines)
 # Standard checks have explicit success/failure exits. Special cases are overridden.
 for i,l in enumerate(lines):
  if re.search(r'(?:[Mm]ake|making|attempt).*roll',l):
   label=next((x for x in sorted(EN,key=len,reverse=True) if x in l),None)
   following=' '.join(lines[i:i+3]);ts=re.findall(r'(?:go|turn) to\s+(\d+)',following,re.I)
   if label and len(ts)>=2 and re.search(r'If you (?:succeed|pass)',following):
    cfg=check(label,ts[0],ts[1]);cfg['check']['difficulty']='extreme' if 'Extreme' in l else 'hard' if 'Hard' in l else 'regular';
    if 'bonus die' in l:cfg['check']['bonus']=1
    if 'double your skill' in l:cfg['check']['multiplier']=2
    if 'Fumble' in following and len(ts)>2:cfg['check'].update(fumble=ts[2],fumbleAt=96)
    return [cfg]
 for l in lines:
  es=en_effects(l)
  if es and not re.search(r'(?i)If you|roll|combat|hit.*does',l):prog.append(effects(*es))
  for m in re.finditer(r'(?:go|turn) to\s+(\d+)',l,re.I):
   start=l.rfind('.',0,m.start())+1;label=l[start:m.start()].strip(' .—–') or '继续'
   if len(label)>180:label='继续'
   cs.append(choice(label,m[1],id='to-'+m[1]))
 if cs:
  seen=set();cs=[c for c in cs if not (c['id'] in seen or seen.add(c['id']))];prog.append(choices(*cs))
 elif 'The End.' in text or 'Congratulations!' in text:prog.append(end('结局 · '+k))
 return prog

def flames_module():
 path,raw=load_flames();programs={k:parse_flames(k,v) for k,v in raw.items()};notes=[]
 programs['263']=[{'kind':'allocation','allocation':{'kind':'attributes','values':[40,50,50,50,60,60,70,80]}},choices(choice('继续',8))]
 programs['8']=[route(23,cmp('attribute.siz','eq',40)),choices(choice('继续',38))]
 programs['233']=[effects({'op':'derive'}),choices(choice('继续',134))]
 programs['134']=[{'kind':'rollEffects','label':'掷 3D6 × 5 确定幸运','effects':[setv('counter.luckDice','3D6'),setv('luck',{'field':'counter.luckDice','factor':5})]},check('DEX',261,59)]
 for k,required,opt,extra,occupation,credit in [
  ('102',['appraise','artCraft','history','libraryUse','languageOther','spotHidden'],True,1,'古董商',20),
  ('226',['firstAid','languageOther','medicine','psychology','scienceBiology','sciencePharmacy'],False,2,'医生',30),
  ('239',['artCraft','history','libraryUse','languageOwn','psychology'],True,2,'记者',20),
  ('249',['artCraft','disguise','law','libraryUse','psychology','spotHidden'],True,1,'私家侦探',20),
  ('265',['libraryUse','languageOther','languageOwn','psychology'],False,4,'教授',30)]:
  programs[k]=[{'kind':'allocation','allocation':{'kind':'occupation','occupation':occupation,'credit':credit,'required':required,'optional':['charm','fastTalk','intimidate','persuade'] if opt else [],'extra':extra,'values':[70,60,60,50,50,50,40,40]}},choices(choice('继续',128))]
 programs['128']=[{'kind':'allocation','allocation':{'kind':'interests'}},choices(choice('继续',144))]
 programs['144']=[choices(choice('凭汽车驾驶判断','144-drive'),choice('凭心理学判断','144-psychology'))];programs['144-drive']=[check('Drive Auto',174,194)];programs['144-psychology']=[check('Psychology',162,194,difficulty='hard')]
 programs['28']=[check('Natural World',35,41)];notes.append('EPUB 28 缺失检定名称，已按同版官方 PDF 补为 Natural World。')
 programs['29']=[choices(choice('放弃窥视',120),choice('继续沿墙移动','29-test'))];programs['29-test']=[route(42,cmp('attribute.dex','gte',{'field':'attribute.siz'})),check('Natural World',42,36)]
 notes.append('29 的空白检定已对照官方 PDF 第 8 页补为 Natural World；相等时按 DEX 不低于 SIZ 处理。262 的空白逃脱检定按结局 12 的 Dodge 提示补为 Dodge。')
 programs['26'].insert(0,effects(setv('counter.skillPenalty',1)))
 programs['59']=[effects(add('hp',-1)),choices(choice('继续',71))]
 programs['154'].insert(0,effects(add('hp',1)))
 programs['52']=[check('CON',failureEffects=[setv('counter.skillPenalty',1)]),choices(choice('继续',64))]
 for menu,limit,next_id,targets in [('6',4,3,[16,84,115,57,34,96]),('25',4,3,[16,84,115,57,34,96]),('120',3,98,[83,126,219,29,7]),('78',3,98,[83,126,219,29,7])]:
  group='morning' if menu in ['6','25'] else 'afternoon'
  cs=[choice(next((c['label'] for st in programs[menu] if st['kind']=='choices' for c in st['choices'] if c.get('target')==str(t)), '探索 '+str(t)),t,e=[add('counter.'+group,1)],once=group+'-'+str(t)) for t in targets]
  if menu in ['6','25']:cs.append(choice('结束上午探索',3))
  programs[menu]=[route(next_id,cmp('counter.'+group,'gte',limit)),choices(*cs)]
 programs['64']=[choices(choice('调查昨晚打斗的地方',70,pred('night-fight')),choice('继续探索村庄',78))]
 programs['166']=[choices(choice('调查昨晚检定发现的细节',178,{'any':[pred('skillMark.charm'),pred('skillMark.spotHidden'),pred('skillMark.track')]}),choice('去赶车',192))]
 programs['55']=[effects(add('hp','-2D6')),route(67,cmp('lastDamage','gte',{'field':'maxHp','factor':.5})),choices(choice('继续',73))]
 programs['67']=[route(92,cmp('hp','lte',0)),check('CON',82,92)]
 programs['73']=[route(92,cmp('hp','lte',0)),choices(choice('继续',82))]
 for k,target in [('65',None),('93',137),('109',137)]:
  programs[k]=[effects(add('hp','-1D6')),route('fire-death',cmp('hp','lte',0)),check('STR',93,77) if not target else choices(choice('继续',target))]
 programs['fire-death']=[end('烈火中的终结')]
 programs['94'].insert(0,effects(add('sanity',1),condition=cmp('sanity','lt',{'field':'attribute.pow'})))
 programs['97']=[effects(add('hp','-1D3')),check('First Aid',successEffects=[add('hp',1),flag('skillMark.firstAid')]),choices(choice('继续',79))]
 programs['110']=[check('Stealth',143,129,difficulty='extreme',fumble='149',fumbleAt=96)]
 programs['89']=[choices(choice('放弃搜索',120),choice('孤注一掷搜索','89-push'))];programs['89-push']=[check('Spot Hidden',95,101)]
 programs['133']=[check('Spot Hidden',147,140,modifiers=[{'condition':cmp('visits.62','gt',0),'bonus':1}])]
 programs['138']=[choices(choice('诉诸感情','138-charm'),choice('解释职业受影响','138-persuade'),choice('催促她答应','138-fastTalk'))]
 for k,skill in [('charm','Charm'),('persuade','Persuade'),('fastTalk','Fast Talk')]:programs['138-'+k]=[check(skill,145,151)]
 for k,t,loss in [('141',63,'-1D2'),('191',199,-1)]:programs[k]=[check('Sanity',failureEffects=[add('sanity',loss)]),choices(choice('继续',t))]
 programs['250']=[check('Sanity',failureEffects=[add('sanity','-1D2')]),*programs['250'][-1:]]
 programs['143'].insert(0,effects(add('skill.naturalWorld',2)))
 programs['165']=[check('Library Use',177,184,push={'success':'177','failure':'190'})]
 programs['208']=[check('Climb',228,228,fumble='222',fumbleAt=96)]
 programs['209']=[effects(add('sanity','-1D3')),route(220,cmp('sanity','lte',0)),choices(choice('命令星辰离去',255),choice('命令星辰释放你',243),choice('命令星辰焚烧村民',231))]
 programs['222']=[effects(add('hp',-1)),route(13,cmp('hp','lte',0)),choices(choice('继续攀爬',228))]
 programs['225']=[check('Locksmith',244,238,multiplier=2,successEffects=[flag('skillMark.locksmith')])]
 programs['237'].insert(0,effects(add('skill.cthulhuMythos',2)))
 # Skill marks and clues belong to the saved investigator, not to a browser checkbox.
 for k,mark in {'66':'archaeology','159':'book-derby','112':'staircase','259':'appointment','175':'chant-arbogast','197':'chant-call','202':'chant-command'}.items():programs[k].insert(0,effects(flag(mark if k!='66' else 'skillMark.'+mark)))
 programs['268']=[effects(flag('skillMark.fightingBrawl')),choices(choice('询问昏倒的工匠',20),choice('离开工坊',120))]
 notes.append('268 的 EPUB “1” 残缺选项按对应后续条目 20 补为询问工匠。')
 programs['87-test']=programs['87'];programs['87']=[choices(choice('寻找阿博加斯特的藏身处','87-test'),choice('使用秘密阶梯',187,pred('staircase'),id='staircase'))]
 for k,v in raw.items():
  text=' '.join(v)
  if k=='40':
   cs=programs[k][-1].get('choices',[]) if programs[k][-1]['kind']=='choices' else []
   cs=[c for c in cs if c.get('target')!='65']
   if k=='148':cs=[choice('不施法，继续',65)]
   else:cs.append(choice('不施法，继续',65))
   for token,offset in [('chant-arbogast',10),('chant-call',40),('chant-command',50)]:cs.append(choice('尝试已学会的仪式 · '+token,str(int(k)+offset),pred(token),id=token))
   programs[k]=[choices(*cs)]
  if 'previous appointment' in text and k!='259':programs[k][-1]['choices'].append(choice('赴阿博加斯特之约',str(int(k)+20),pred('appointment'),id='appointment'))
  if k in ['7','112']:
   programs[k][-1]['choices'].append(choice('走已发现的秘密阶梯',str(int(k)+100),pred('staircase'),id='staircase'))
 programs['150']=[check('DEX',172,87,opposed=38)]
 programs['155']=[check('DEX',161,167,opposed=58)]
 programs['136'].insert(0,effects(add('skill.naturalWorld',1)))
 programs['184'].insert(0,effects(flag('book-derby')))
 programs['145'].insert(0,effects(flag('ruth-help'),flag('skillMark.$last')))
 programs['167']=[effects(setv('counter.lastDamage',0)),effects(setv('counter.lastDamage',0)),check('claw',target=35,successEffects=[add('hp','-3D6')]),effects(flag('bear-major'),condition=cmp('lastDamage','gte',{'field':'maxHp','factor':.5})),effects(setv('counter.lastDamage',0)),check('claw',target=35,successEffects=[add('hp','-3D6')]),effects(flag('bear-major'),condition=cmp('lastDamage','gte',{'field':'maxHp','factor':.5})),route(179,pred('bear-major')),choices(choice('继续逃跑',186))]
 programs['266']=[check('Science (Botany)',success='76',difficulty='hard'),choices(choice('熄灭粉末后睡觉',58),choice('整夜保持清醒',52),choice('好奇地吸入烟雾',26))]
 # A shop visit allows at most two everyday items and never invents firearms.
 programs['16']=[choices(choice('购买猎刀',None,e=[{'op':'item','key':'knife','label':'猎刀'},add('counter.purchases',1)],once='shop-knife',condition=cmp('counter.purchases','lt',2)),choice('购买绳索',None,e=[{'op':'item','key':'rope','label':'绳索'},add('counter.purchases',1)],once='shop-rope',condition=cmp('counter.purchases','lt',2)),choice('购买火柴',None,e=[{'op':'item','key':'matches','label':'火柴'},add('counter.purchases',1)],once='shop-matches',condition=cmp('counter.purchases','lt',2)),choice('离开商店',25))]
 # Stay on a shopping instruction after buying, then explicitly leave.
 for c in programs['16'][0]['choices']:
  if 'target' not in c:c['target']='16';c['id']=c['once']
 programs['90']=[{'kind':'number','label':'投入魔法点（不足时以生命补足，最多 10，保留至少 1 HP）','field':'counter.spellPoints','min':0,'max':{'field':'spellCapacity'},'cost':'mp'},choices(choice('开始施法',198))]
 programs['198']=[check('spell',209,65,target={'field':'counter.spellPoints','factor':10},fumbleAt=96)]
 programs['158']=[check('Stealth',7,170,successEffects=[flag('skillMark.stealth')])]
 notes.append('施法特殊判定按正文阈值执行；来源缺字的补全依据与解释见上述条目，保留在版本元数据供审校。')
 programs['171']=[check('Sanity',successEffects=[add('sanity',-1)],failureEffects=[add('sanity','-1D4')]),effects(add('skill.cthulhuMythos',4)),end('德比诗集的余波')]
 # Optional post-adventure reading is still forward-only; no recovery or reroll of the adventure.
 for k in ['185','223','247']:
  programs[k]=[choices(choice('结束本次冒险','survived'),choice('一周后研读随身的德比诗集',171,pred('book-derby'),id='study-book'))]
 programs['survived']=[end('生还')]
 programs['173']=[{'kind':'combat','combat':{'name':'黑熊','hp':20,'dex':58,'fighting':35,'dodge':0,'damage':'2D6','armor':3,'rounds':3,'attacks':[[{'skill':35,'damage':'2D6'},{'skill':35,'damage':'2D6'}],[{'skill':35,'damage':'2D6'},{'skill':25,'damage':'1D8'}],[{'skill':35,'damage':'2D6'},{'skill':35,'damage':'2D6'}]],'winHp':0,'win':'201','lose':'193','majorWound':'193'}}]
 programs['235']=[{'kind':'combat','combat':{'name':'骑手','hp':9,'dex':32,'fighting':30,'dodge':15,'damage':'1D6','randomStance':True,'winHp':4,'win':'241','lose':'247'}}]
 programs['262']=[{'kind':'combat','combat':{'name':'工匠','hp':12,'dex':41,'fighting':35,'dodge':17,'damage':'1D3','damageBonus':'1D4','winHp':6,'win':'268','lose':'2','escape':{'after':3,'skill':'dodge','difficulty':'hard','target':'12'}}}]
 # Being knocked unconscious in these scenes is expressly survivable, unlike a generic HP=0 death.
 programs['201']=[effects(flag('skillMark.fightingBrawl')),check('First Aid',successEffects=[add('hp',1),flag('skillMark.firstAid')],condition=cmp('hp','lt',{'field':'maxHp'})),choices(choice('继续赶路',79))]
 for k in ['188','203','217']:programs[k].insert(0,effects(flag('night-fight')))
 # Missing EPUB skill tokens in remaining ordinary checks are explicitly restored.
 for k,skill,succ,fail in [('60','archaeology',66,72),('119','fastTalk',132,139)]:programs[k]=[check(skill,succ,fail,difficulty='extreme' if k=='119' else 'regular')]
 for k,v in programs.items():
  if k not in raw:raw[k]=raw.get(k.split('-')[0],['继续你的调查。'])
  if not v:raise ValueError((k,'no executable program',raw[k]))
 from_defaults=json.loads((ROOT/'chars/alone-against-static/alex.json').read_text())['skills']
 from_defaults.update({'accounting':5,'creditRating':0,'dodge':0,'driveAuto':20,'firstAid':30,'fightingBrawl':25,'languageOwn':0,'listen':20,'naturalWorld':10,'navigate':10,'persuade':10,'psychology':10,'spotHidden':25,'stealth':20,'intimidate':15,'scienceBotany':1,'sciencePharmacy':1,'scienceBiology':1})
 preset={'id':'guided','label':'剧情引导建卡','description':'按原书分配属性、职业技能与个人兴趣；无预设人物。','occupation':'尚未选择','skills':from_defaults,'hp':1,'sanity':0,'attributes':{k:0 for k in ['str','con','siz','dex','app','pow','int','edu']},'mp':0,'damageBonus':'0'}
 return localize_flames(make_story('alone-against-flames','Alone Against the Flames',path,raw,programs,[preset],'guided',None,notes))


class ChineseNarrative(HTMLParser):
 def __init__(self):super().__init__();self.lines=[];self.parts=[]
 def flush(self):
  text=''.join(self.parts).strip();self.parts=[]
  if text and not re.search(r'【剧终】|^(?:转到|请阅读|请参阅)',text):self.lines.append(text)
 def handle_starttag(self,tag,attrs):
  if tag in ['p','div','h2','br']:self.flush()
 def handle_endtag(self,tag):
  if tag in ['p','div','h2']:self.flush()
 def handle_data(self,text):self.parts.append(text)

def chinese_text(chapter):
 # Guide blocks are paper instructions; the reviewed engine already executes them.
 parts=re.split(r'(\[guide-start\]|\[guide-end\])',''.join(chapter['texts']));guide=False;html=[]
 for part in parts:
  if part=='[guide-start]':guide=True
  elif part=='[guide-end]':guide=False
  elif not guide:html.append(part)
 parser=ChineseNarrative();parser.feed(''.join(html));parser.flush()
 return parser.lines or ['本段规则由网页自动处理，请按下方提示继续。']

def localize_flames(story):
 root=ROOT/'scripts/alone-against-flames/zh-CN';chapters={str(k):json.loads((root/'chapters'/f'{k}.json').read_text()) for k in range(1,271)}
 mapping_text=(root/'chapter-map.js').read_text();mapping=json.loads(mapping_text[mapping_text.index('{'):mapping_text.rindex('}')+1])
 skill_text=(ROOT/'packages/contracts/character-labels.ts').read_text();labels=dict(re.findall(r'\b(\w+):\s*"([^"]+)"',skill_text));labels.update({'sanity':'理智','luck':'幸运','spell':'施法','claw':'爪击'})
 node_by_id={n['id']:n for n in story['nodes']}
 for node in story['nodes']:
  source=node['sourceId'];source=source if source in chapters else '40'
  node['title']='向火独行 · '+source;node['text']=chinese_text(chapters[source]);node['chapter']='原书条目 '+source
  for step in node['program']:
   if step['kind']=='check':step['check']['label']=labels.get(step['check']['skill'],step['check']['label'])
   if step['kind']=='choices':
    for c in step['choices']:
     if re.search('[A-Za-z]{3}',c['label']):
      translated=[opt['text'] for opt in chapters[source].get('options',[]) if str(mapping.get(source,{}).get(str(opt['key'])))==c.get('target')]
      if not translated:raise ValueError(('missing choice translation',node['id'],c))
      c['label']=translated[0]
     for token,label in [('chant-arbogast','吟诵阿博加斯特的仪式'),('chant-call','召唤天界之焰'),('chant-command','命令天界之焰')]:
      if c['id']==token:c['label']=label
  if node['id']=='fire-death':node['text']=['火焰吞没了你。你未能逃离烬头村，这次调查在烈火中终结。']
 # Distinct survival endings retain their own narrative and collection identities.
 story['nodes']=[n for n in story['nodes'] if n['id']!='survived']
 for key,label in [('185','骑向黎明'),('223','走出烬头村'),('247','劫后余生')]:
  for step in node_by_id[key]['program']:
   if step['kind']=='choices':
    for c in step['choices']:
     if c['target']=='survived':c['target']=key+'-end';c['label']='结束冒险，保存结局'
  end_node={**node_by_id[key],'id':key+'-end','title':'向火独行 · '+label,'program':[end(label)]}
  story['nodes'].append(end_node)
 for node in story['nodes']:
  for step in node['program']:
   if step['kind']=='allocation' and step['allocation']['kind']=='occupation':
    a=step['allocation'];a['specializations']={'artCraft':{'label':'艺术与手艺专长',**({'fixed':'摄影'} if node['sourceId'] in ['239','249'] else {})},'languageOther':{'label':'外语',**({'fixed':'拉丁语'} if node['sourceId']=='226' else {})}}
   if step['kind']=='end' and step['label'].startswith('结局 · '):step['label']={'77':'未能挣脱烈火','80':'召唤之祸','92':'坠入深渊','123':'重返火刑柱','193':'葬身荒野','196':'地底终结','220':'归于群星','231':'焚尽村庄','243':'星火吞噬','255':'驱散星火','270':'时间之外'}.get(node['sourceId'],'终章 · '+node['sourceId'])
  node['help']={
   '71':['请选择职业。姓名已在开局时确定，个人背景可在调查员档案中补充。'],
   '90':['每投入 1 点提高 10% 成功率；96–100 始终失败。魔法点不足时才扣除生命，并为你保留至少 1 点生命。'],
  }.get(node['id'],[])
 map_art={'key':'emberhead-map','src':'/media/alone-against-flames/emberhead-map.png','alt':'烬头村原书地图，标有灯塔、村公所、杂货店、东路和西路','caption':'原书地图。The Beacon：灯塔；Village Hall：村公所；General Store：杂货店；Ledbetter’s House：莱德贝特家；East Road / West Road：东路 / 西路。'}
 node_by_id['140']['illustration']=map_art
 node_by_id['140']['program'].insert(0,effects({'op':'item','key':'emberhead-map','label':'烬头村地图'}))
 story['title']='向火独行';story['version']='1.1.0';story['description']='中文单人冒险：在网页内建卡、探索、战斗与施法，自动记录经历与结局。';story['subtitle']='中文完整版 · 剧情引导建卡'
 story['source']['notes'].append('中文正文来自仓库 zh-CN 完整章节集；保留原书编号，去除纸面指导块，规则继续由已审校的英文指令编译执行。')
 story['source']['notes'].append('三个生还结局分别保存为185-end、223-end、247-end；地图从同一原始 EPUB 提取，未修改图片。')
 story['source']['notes'].append('中文章节校验和：'+hashlib.sha256(''.join((root/'chapters'/f'{k}.json').read_text() for k in range(1,271)).encode()).hexdigest())
 return story

def make_story(id,title,path,raw,programs,presets,creation,health,notes):
 nodes=[{'id':k,'sourceId':k.split('-')[0] if k.split('-')[0].isdigit() else 'adaptation','type':'program','title':title+' · '+k.split('-')[0],'chapter':'原书条目 '+k.split('-')[0],'text':normal_text(raw[k]),'background':'/art/lighthouse.svg','program':v} for k,v in programs.items()]
 return {'id':id,'version':'1.0.0','rulesVersion':'coc7-solo@2','creationPolicy':creation,**({'healthPolicy':health} if health else {}),'title':title,'subtitle':'原作单人冒险','description':'按原书段落推进；判定、记录表与局内状态由服务器保存。','duration':'2–5 小时','difficulty':'原作规则','cover':'/art/lighthouse.svg','accent':'#b46f48','tags':['单人','KP-less','CoC 7'],'entry':'0' if health else '1','presets':presets,'nodes':nodes,'source':{'file':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'notes':notes}}

def main():
 for fn in [static_module,flames_module]:
  story=fn();path=ROOT/'stories'/story['id']/story['version']
  if fn is static_module and (path/'story.json').exists():
   print(story['id'],'保留已有发布包；规则修订须另发版本');continue
  path.mkdir(parents=True,exist_ok=True);(path/'story.json').write_text(json.dumps(story,ensure_ascii=False,indent=2)+'\n');print(story['id'],len(story['nodes']))
if __name__=='__main__':main()
