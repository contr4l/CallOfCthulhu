"""Offline, reviewed Tide rules. Source/translation files are never rewritten.
Printed entry 119 really says 18 (PDF p39); retain it and record the ambiguity.
"""
import argparse, copy, hashlib, json, re, subprocess, tempfile
from tide_translation import check as check_translation
from pathlib import Path
from compile_solo import effects, route, choices, choice, check, end, flag, add, setv, pred, cmp
from pack import pack_story, write, unpack
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'scripts/alone-against-tide'
LABELS = {'appraise':'估价','creditRating':'信用评级','archaeology':'考古学','anthropology':'人类学','locksmith':'锁匠','psychology':'心理学','listen':'聆听','spotHidden':'侦查','charm':'魅惑','fastTalk':'话术','persuade':'说服','stealth':'潜行','intimidate':'恐吓','dodge':'闪避','fightingBrawl':'格斗（斗殴）','firearmsHandgun':'射击（手枪）','sanity':'理智','luck':'幸运','str':'力量','dex':'敏捷','con':'体质','pow':'意志','int':'智力','jump':'跳跃','climb':'攀爬','navigate':'导航','swim':'游泳','survival':'生存'}
ITEMS = {'clay':'黏土圆筒','altar':'宝石祭坛','crown':'金冠','journal':'日记','robe':'仪式长袍','idol':'海绿色石像','gun':'左轮手枪','gold':'金粉'}
def take(key): return [{'op':'register','kind':'state','key':'tide-'+key,'label':'已获得'+ITEMS[key]},{'op':'item','key':'tide-'+key,'label':ITEMS[key]}]
def roll(skill,good=None,bad=None,**kw): return check(skill,good,bad,**kw) | {'check':check(skill,good,bad,**kw)['check'] | {'label':LABELS[skill]}}
def continued(t): return choices(choice('继续',t))
def build(version="1.0.1"):
 graph_path=ROOT/'scripts/潮汐独行.dag.json'
 graph=json.loads(graph_path.read_text())
 if hashlib.sha256((ROOT/'scripts'/graph['source']['filename']).read_bytes()).hexdigest()!=graph['source']['sha256']:raise ValueError('Original PDF changed')
 manifest=json.loads((SOURCE/'translations/zh-CN/manifest.json').read_text())
 if hashlib.sha256(graph_path.read_bytes()).hexdigest()!=manifest['sourceGraphSha256']:raise ValueError('Translation index belongs to a different source graph')
 for rows,base in [(graph['nodes'],ROOT/'scripts'),(manifest['nodes'],SOURCE/'translations/zh-CN')]:
  for row in rows:
   ref=row['fragment'];path=(base/ref['path']).resolve()
   if not path.is_relative_to(base.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=ref['sha256']:raise ValueError('Unsafe or changed input fragment')
 report=check_translation(graph_path,SOURCE/'translations/zh-CN')
 if report['errors']:raise ValueError(report['errors'])
 if version=='1.0.0':
  return unpack(ROOT/'stories/alone-against-tide/1.0.0/story.json'),json.loads((SOURCE/'review/runtime-1.0.0.json').read_text())
 raw={str(i):json.loads((SOURCE/f'fragments/{i:03}.json').read_text()) for i in range(1,244)}
 zh={str(i):json.loads((SOURCE/f'translations/zh-CN/{i:03}.json').read_text()) for i in range(1,244)}
 programs={}; owners={}; extra_text={}; audit=[]
 def aux(n,suffix,steps):
  key=f'{n}-{suffix}';programs[key]=steps;owners[key]=str(n);return key
 def menu(n,targets):
  # Use the corresponding translated source bullet as the action label.
  labels={}
  for p,q in zip(raw[str(n)]['paragraphs'],zh[str(n)]['paragraphs']):
   t=re.sub(r'\s+',' ',p['text']).strip()
   m=re.search(r'go to (\d+)',t,re.I)
   if m and not re.search(r'if you (?:succeed|fail)|roll:',t,re.I):
    label=re.split(r'(?:前往|转到|跳转到|去往|进入|参见|见|阅读|转至)\s*(?:第\s*)?\d+',q['text'])[0].strip('• ·，。；： \n')
    labels[m[1]]=label or '继续'
  return choices(*(choice(labels.get(str(t),'继续调查'),t) for t in targets))
 # Explicit printed exits, including prose (not only bullet) exits.
 singles={1:12,2:17,8:32,9:106,14:81,16:26,19:81,25:138,26:9,27:3,28:17,29:17,36:3,37:17,38:81,40:17,42:3,43:17,44:17,45:81,48:81,52:81,56:3,57:17,59:81,61:81,62:32,64:81,66:3,67:122,72:17,73:81,74:32,75:140,77:140,78:160,86:81,87:140,89:3,94:81,96:138,97:13,100:81,101:90,105:17,108:140,111:122,118:140,124:158,127:122,128:32,129:138,130:None,134:None,136:131,143:None,146:82,148:131,149:131,155:138,161:222,168:138,172:222,178:210,186:50,188:222,195:210,203:222,204:210,228:196,237:196,240:210}
 for n,t in singles.items():
  if t:programs[str(n)]=[continued(t)]
 for n,targets in {3:[15,26],4:[27,36,42,56],5:[55,122],10:[147,122,124],18:[27,36,42,66,89,56],21:[179,136,151],23:[27,36,42,66,56],33:[27,36,42,66,89,56],39:[7,68,125,111],41:[27,36,42,56],46:[90,122],49:[7,68,125,111],53:[7,141],54:[7,122,158],63:[27,36,42,66,89,56],71:[27,42,66,56],85:[7,68,125,111],90:[5,55,122],91:[7,141],93:[156,202],101:[90,122],104:[27,42,66,89,56],106:[11,32,153],109:[134,148,124],120:[179,151],130:[7,160,122,158],133:[210,181],134:[142,79],143:[151,136],147:[7,164],151:[156,202],153:[11,122],156:[210,181],164:[54,130],165:[156,202],171:[137,194,200],177:[223,166,200],202:[156,181],222:[151,135],223:[173,200,166]}.items():programs[str(n)]=[menu(n,targets)]
 # Pure endings; conditional THE END paragraphs handled below, not prematurely terminal.
 graph=json.loads((ROOT/'scripts/潮汐独行.dag.json').read_text())
 conditional={51,68,119,121,125,132,140,141,142,145,169}
 for node in graph['nodes']:
  if node['terminal'] and int(node['id']) not in conditional:programs[node['id']]=[end('结局 · 原书第 '+node['id']+' 节')]
 basic={11:('fastTalk',46,101),13:('stealth',165,144),22:('charm',43,57),34:('listen',2,44),50:('jump',167,232),55:('psychology',126,31),60:('spotHidden',28,40),79:('listen',114,131),88:('psychology',105,29),102:('anthropology',72,37),112:('fightingBrawl',143,152),114:('luck',165,149),115:('fightingBrawl',133,180),131:('dex',171,162),135:('dex',171,162),138:('str',115,69),139:('navigate',229,170),144:('dodge',157,25),157:('dodge',121,176),158:('navigate',119,51),159:('con',184,233),160:('stealth',165,144),163:('swim',185,209),166:('dex',186,208),167:('con',184,198),170:('con',163,193),174:('survival',189,201),175:('survival',206,224),183:('dex',50,197),185:('dodge',191,221),189:('con',184,198),194:('str',183,199),200:('luck',238,169),212:('dodge',159,182),214:('dex',237,117),216:('archaeology',116,242),224:('listen',190,212),229:('dodge',191,221),238:('persuade',216,241)}
 for n,(s,g,b) in basic.items():programs[str(n)]=[roll(s,g,b,**({'difficulty':'hard'} if n in [163,216] else {}))]
 def damage(n,s,g,b,d):
  cause={51:'坠崖身亡',68:'被装饰花瓶砸死',119:'被水下树枝缠住而溺亡',121:'被殴打致死',125:'枪伤身亡',132:'被殴打致死',140:'枪伤身亡',141:'枪伤身亡',142:'被男人殴打致死',145:'枪伤身亡',169:'被神秘生物扑倒杀死'}[n]
  death=aux(n,'death',[end(cause+' · 原书第 '+str(n)+' 节')])
  fail=aux(n,'wounded',[effects(add('hp',d)),route(death,cmp('hp','eq',0)),continued(b)])
  programs[str(n)]=[roll(s,g,fail)]
 for args in [(51,'climb',174,139,'-1D6'),(68,'dodge',91,53,'-1D4'),(119,'swim',175,18,-1),(121,'fightingBrawl',93,168,'-1D3'),(125,'dodge',145,96,'-1D10-2'),(132,'fightingBrawl',21,152,'-1D3'),(140,'dodge',132,96,'-1D10-2'),(141,'dodge',112,155,'-1D10-2'),(145,'firearmsHandgun',120,96,'-1D10-2'),(169,'dodge',228,214,-1)]:damage(*args)
 # Checks offered alongside real decisions, and alternative skills.
 def skill_choice(n,skills,g,b,**kw):
  programs[str(n)]=[choices(*(choice('使用'+LABELS[s],aux(n,s,[roll(s,g,b,**kw)]),id='use-'+s) for s in skills))]
 for n,g,b,d in [(6,100,14,'regular'),(24,38,73,'hard'),(30,52,48,'regular'),(58,64,94,'regular'),(92,86,154,'extreme'),(103,19,59,'hard')]:skill_choice(n,['appraise','creditRating'],g,b,difficulty=d)
 for n in [70]:skill_choice(n,['appraise','archaeology'],45,61)
 for n in [7,110]:programs[str(n)]=[choices(choice('检查卧室',123),choice('尝试打开柜子',aux(n,'lock',[roll('locksmith',108,75,push={'success':'108','failure':'87'})])))]
 for n in [31,126]:programs[str(n)]=[choices(choice('无视争执',47),choice('悄悄离开',aux(n,'stealth',[roll('stealth',98,20)])))]
 programs['35']=[continued(70)]
 programs['83']=[menu(83,[173,166,200])]
 programs['98']=[menu(98,[67,110])]
 programs['122']=[menu(122,[109,142])]
 programs['154']=[continued(81)]
 programs['187']=[roll('survival',206,224)]
 programs['201']=[roll('dodge',191,221)]
 programs['20']=[choices(choice('默不作声',65),choice('尝试逃跑',82))]
 programs['47']=[choices(choice('保持安静',65),choice('突袭警官',aux(47,'brawl',[roll('fightingBrawl',76,82,difficulty='hard')])))]
 programs['65']=[effects(*[e for k in ITEMS for e in [flag('tide-'+k,False),{'op':'item','key':'tide-'+k,'label':ITEMS[k],'remove':True}]]),choices(choice('等待',84),choice('尝试开锁',aux(65,'lock',[roll('locksmith',107,84)])),choice('说服看守',aux(65,'talk',[roll('fastTalk',127,84)])))]
 programs['107']=[roll('stealth',10,146)]
 for n in [76,99]:
  options=[]
  if n==76:options.append(choice('举枪恐吓警官',aux(n,'intimidate',[roll('intimidate',49,99,bonus=1)])))
  options += [choice('说服警官',aux(n,'persuade',[roll('persuade',85,39)]))]+[choice(label,t) for label,t in [('搜查房子',7),('绑住警官',68),*([('绑住阿米莉亚',125)] if n==99 else []),('离开',111)]]
  programs[str(n)]=([effects(*take('gun'))] if n==76 else [])+[choices(*options)]
 programs['123']=[choices(choice('尝试打开保险箱',aux(123,'lock',[roll('locksmith',77,118)])),choice('离开房间',140))]
 # 142: choice of gun only when armed; same printed damage on either failed attack.
 damage(142,'fightingBrawl',97,129,'-1D3');fail=programs['142'][0]['check']['failure']
 programs['142']=[choices(choice('近身袭击',aux(142,'brawl',[roll('fightingBrawl',97,fail,bonus=1)])),choice('举枪射击',aux(142,'gun',[roll('firearmsHandgun',78,fail,bonus=1)]),pred('tide-gun')))]
 programs['138'].insert(0,effects(flag('tide-gun',False),{'op':'item','key':'tide-gun','label':ITEMS['gun'],'remove':True}))
 # Auctions: at most three distinct interactions; each bid opportunity occurs once.
 interactions=[34,88,102,60,22]
 for n in [15,17]:
  programs[str(n)]=[route(35,cmp('counter.auctionTalks','gte',3)),choices(*[choice(label,t,e=[add('counter.auctionTalks',1)],once='auction-talk-'+str(t)) for label,t in zip(['倾听人群','观察男士','查看祭坛','环视房间','搭话'],interactions)],*([choice('继续参加拍卖',35)] if n==17 else []),choice('离开拍卖会',26))]
 programs['81']=[choices(*[choice('竞拍'+ITEMS[k],t,once='auction-bid-'+k) for k,t in [('clay',24),('altar',103),('crown',58),('journal',6),('robe',30),('idol',92)]],choice('离开拍卖会',16))]
 for n,key,cost in [(38,'clay',5),(19,'altar',5),(64,'crown',2),(100,'journal',2),(52,'robe',2),(86,'idol',10)]:programs[str(n)].insert(0,effects(add('skill.creditRating',-cost),*take(key)))
 programs['32']=[choices(*[choice('查看'+ITEMS[k],t,pred('tide-'+k)) for k,t in [('journal',74),('clay',62),('altar',128),('idol',8)]],choice('去警察局',11),choice('前往渡口',153))]
 programs['13'].insert(0,effects({'op':'register','kind':'state','key':'tide-meeting','label':'班尤午夜之约'}))
 for n in [108,178,188]:programs[str(n)].insert(0,effects({'op':'register','kind':'state','key':'tide-chant','label':'已学会祭坛咒语'}))
 for n in [77,203]:programs[str(n)].insert(0,effects(*take('gold')))
 # Basement inventory is awarded after examining each relic, not on entering the basement.
 programs['210']=[choices(*[choice('查看'+ITEMS[k],t,once='basement-'+k) for k,t in [('journal',240),('clay',218),('altar',230),('idol',195)]],choice('查看楼上卧室',202),choice('离开房子',181))]
 for n,k in [(240,'journal'),(195,'idol')]:programs[str(n)].insert(0,effects(*take(k)))
 programs['218']=[effects(*take('clay')),roll('archaeology',204,210)]
 programs['230']=[effects(*take('altar')),roll('archaeology',178,210)]
 programs['204'].insert(0,effects(add('skill.cthulhuMythos',2)))
 programs['179']=[choices(choice('检查卧室',207),choice('尝试打开柜子',aux(179,'lock',[roll('locksmith',188,161)])))]
 programs['207']=[choices(choice('尝试打开保险箱',aux(207,'lock',[roll('locksmith',203,172)])),choice('离开房间',222))]
 programs['181']=[choices(choice('去高地',211),choice('逃入树林',194),choice('赴班尤之约',215,pred('tide-meeting')))]
 for n in [196,211]:programs[str(n)]=[choices(choice('尝试祭坛仪式',235,pred('tide-chant')),choice('放弃仪式',150))]
 programs['215']=[choices(choice('继续',227,pred('tide-idol')),choice('继续',236,pred('tide-idol',False)))]
 programs['235']=[choices(choice('继续',205,pred('tide-idol')),choice('继续',220,pred('tide-idol',False)))]
 programs['205']=[roll('pow',219,234)]
 programs['219']=[choices(choice('继续',239,pred('tide-gold')),choice('继续',234,pred('tide-gold',False)))]
 for n,g,b,unarmed in [(173,217,192,225),(191,213,226,231)]:programs[str(n)]=[roll('firearmsHandgun',g,b,condition=pred('tide-gun')),continued(unarmed)]
 for n in [120,133,143]:programs[str(n)].insert(0,roll('sanity',successEffects=[add('sanity',-1)],failureEffects=[add('sanity','-1D3')]))
 programs['143'].insert(0,effects(*take('gun')))
 # Creature terror: indefinite insanity counts as temporary. Single loss >=5 uses standard INT recognition.
 normal=aux(162,'decision',[choices(choice('举枪射击',aux(162,'armed',[route('162-gun-mad',pred('tide-insane')),roll('firearmsHandgun',177,95)]),pred('tide-gun')),choice('逃跑',aux(162,'flee',[route('162-flee-mad',pred('tide-insane')),roll('dex',83,113)])))])
 gun_branches=[aux(162,'gun-bonus',[roll('firearmsHandgun',177,95,bonus=1)]),aux(162,'gun-twice',[roll('firearmsHandgun',177,'162-gun-second')]),aux(162,'gun-penalty',[roll('firearmsHandgun',177,95,penalty=1)]),'243']
 aux(162,'gun-second',[roll('firearmsHandgun',177,95)])
 aux(162,'gun-mad',[{'kind':'random','sides':4,'targets':gun_branches}])
 fb=aux(162,'flee-bonus',[roll('dex',83,113,bonus=1)]);fp=aux(162,'flee-penalty',[roll('dex',83,113,penalty=1)])
 aux(162,'flee-mad',[{'kind':'random','sides':4,'targets':[fb,fb,fp,fp]}])
 programs['162']=[effects(setv('counter.sanityBefore',{'field':'sanity'})),roll('sanity',successEffects=[add('sanity',-1)],failureEffects=[add('sanity','-1D6')]),roll('int',successEffects=[{'op':'register','kind':'state','key':'tide-insane','label':'暂时性疯狂'}],condition={'all':[pred('tide-insane',False),cmp('sanity','lte',{'field':'counter.sanityBefore','offset':-5})]}),continued(normal)]
 for n,loss in [(184,'-1D8'),(190,'-1D8'),(206,'-1D8'),(220,'-1D6')]:programs[str(n)].insert(0,{'kind':'rollEffects','label':'结算逃生后的理智损失','effects':[add('sanity',loss)]})
 # Creation: original 8-characteristic array; 9 occupational values including Credit, 7 interests.
 woods={'any':[{'templateId':'tide-eleanor'},{'templateId':'tide-ellery'}]}
 programs['12']=[route('12-woods',woods),{'kind':'allocation','allocation':{'kind':'attributes','values':[40,50,50,50,60,60,70,80]}},continued(80)]
 aux(12,'woods',[continued(80)])
 programs['80']=[route('80-woods',woods),choices(*[choice(label,'80-'+str(t)) for label,t in [('古董商',104),('作家',18),('业余爱好者',71),('医生',33),('记者',63),('警探',4),('私家侦探',41),('教授',23)]])]
 # The PDF references external occupational lists. Existing Flames lists are reused for shared professions;
 # remaining profession selections use the standard Keeper occupations, documented in the review report.
 specs=[(104,'古董商',['appraise','artCraft','history','libraryUse','languageOther','spotHidden'],True,1),(18,'作家',['artCraft','history','libraryUse','languageOther','languageOwn','psychology'],False,1),(71,'业余爱好者',['artCraft','languageOther','ride'],True,3),(33,'医生',['firstAid','languageOther','medicine','psychology','scienceBiology','sciencePharmacy'],False,2),(63,'记者',['artCraft','history','libraryUse','languageOwn','psychology'],True,2),(4,'警探',['law','listen','psychology','spotHidden'],True,1),(41,'私家侦探',['artCraft','disguise','law','libraryUse','psychology','spotHidden'],True,1),(23,'教授',['libraryUse','languageOther','languageOwn','psychology'],False,4)]
 luck={'kind':'rollEffects','label':'掷 3D6 × 5 确定幸运','effects':[setv('counter.luckDice','3D6'),setv('luck',{'field':'counter.luckDice','factor':5})]}
 for t,label,req,social,extra in specs:
  groups={18:[['naturalWorld','occult']],71:[['firearmsHandgun','firearmsRifleShotgun']],4:[['artCraft','disguise'],['firearmsHandgun','firearmsRifleShotgun']]}.get(t,[])
  specialties={18:{'artCraft':{'label':'文学','fixed':'文学'}},33:{'languageOther':{'label':'拉丁语','fixed':'拉丁语'}},63:{'artCraft':{'label':'摄影','fixed':'摄影'}},41:{'artCraft':{'label':'摄影','fixed':'摄影'}},4:{'artCraft':{'label':'表演','fixed':'表演'}}}.get(t,{})
  if 'languageOther' in req and 'languageOther' not in specialties:specialties['languageOther']={'label':'外语专长'}
  if 'artCraft' in req and 'artCraft' not in specialties:specialties['artCraft']={'label':'艺术／手艺专长'}
  aux(80,str(t),[{'kind':'allocation','allocation':{'kind':'occupation','occupation':label,'groups':groups,'specializations':specialties,'includeCredit':True,'required':req,'optional':['charm','fastTalk','intimidate','persuade'] if social else [],'extra':extra,'values':[40,40,40,50,50,50,60,60,70]}},{'kind':'allocation','allocation':{'kind':'interests','count':7,'allowOccupation':False}},copy.deepcopy(luck),effects({'op':'sanityBaseline'},{'op':'register','kind':'state','key':'tide-created','label':'建卡完成'}),continued(t)])
 aux(80,'woods',[{'kind':'allocation','allocation':{'kind':'bonus','pool':70,'includeCredit':True}},copy.deepcopy(luck),effects({'op':'sanityBaseline'},{'op':'register','kind':'state','key':'tide-created','label':'建卡完成'}),continued(23)])
 programs['tide-retirement']=[end('永久性疯狂（规则退场）') | {'collect':False}];owners['tide-retirement']='162';extra_text['tide-retirement']={'en':['Your Sanity has reached zero. Your investigator retires from this adventure.'],'zh-CN':['你的理智已降至零。按照本冒险的规则，调查员永久退场。']}
 assert all(str(i) in programs for i in range(1,244)), [i for i in range(1,244) if str(i) not in programs]
 programs.pop('187')  # Printed 119->18 leaves 187 isolated. Its source and translation remain intact.
 # Mark each raw paragraph as narrative / paper rule / layout. Keep the original elsewhere, unmodified.
 texts={}
 for n in raw:
  en=[];cn=[]
  for p,q in zip(raw[n]['paragraphs'],zh[n]['paragraphs']):
   t=re.sub(r'\s+',' ',p['text']).strip();z=re.sub(r'\s+',' ',q['text']).strip()
   layout=p['kind']=='heading' or bool(re.fullmatch(r'[\d\s,()–-]+|[A-Z]{6,}',t)) or t in ['ALONE AGAINST THE TIDE','THE ADVENTURE']
   rule=(n=='81' and p['id']=='81:p2') or t.startswith(('•','If you are creating','If you are using the pre-generated','After examining each item','You should not select','1.','2.','3.','4.','1–2:','3–4:')) or bool(re.match(r'(?i)(?:Make (?:a|an) .*roll|Go to \d|If you .*roll)',t))
   # These paragraphs combine a narrative introduction and book instructions; retain the introduction.
   cut=re.search(r'(?i)(?:\bMake (?:a|an) .*?roll:|\bAfter examining each item|\bIf you are creating your own investigator|\bYou may now select another option|\bGo to \d+)',t)
   if cut and cut.start()>0 and not rule:
    # Mixed paragraphs are rare; the entire corresponding original stays in source fragments.
    zh_cut = {'12':'如果你要自己创建调查员','80':'如果你要自己创建调查员','17':'你现在可以','210':'每检查一件物品','32':'检查每件物品后','132':'进行一次斗殴检定','87':'前往','96':'前往'}.get(n)
    if not zh_cut or zh_cut not in z:raise ValueError(('mixed prose/rule needs review',n,p['id'],t))
    t=t[:cut.start()].strip();z=z.split(zh_cut)[0].strip()
   audit.append({'sourceId':n,'paragraphId':p['id'],'role':'layout' if layout else 'rule' if rule else 'narrative'})
   if not layout and not rule:
    en_parts = p['text'].split('\n\n') if t == re.sub(r'\s+',' ',p['text']).strip() else [t]
    cn_parts = q['text'].split('\n\n') if z == re.sub(r'\s+',' ',q['text']).strip() else [z]
    en.extend(re.sub(r'\s*THE END\.?','',re.sub(r'\s+',' ',part)).strip() for part in en_parts if part.strip())
    cn.extend(re.sub(r'\s*(?:THE END\.?|故事结束[。.]?)$','',re.sub(r'\s+',' ',part)).strip() for part in cn_parts if part.strip())
  texts[n]={'en':en or ['Continue with the current action.'],'zh-CN':cn or ['按当前行动继续。']}
 nodes=[]
 for n,steps in programs.items():
  owner=owners.get(n,n);body=extra_text.get(n,texts[owner]);title='潮汐独行 · '+owner
  nodes.append({'id':n,'sourceId':owner,'type':'program','title':title,'chapter':'原书条目 '+owner,'text':body['zh-CN'],'reading':{'zh-CN':{'title':title,'text':body['zh-CN']},'en':{'title':'Alone Against the Tide · '+owner,'text':body['en']}},'background':'/art/lighthouse.svg','program':steps})
 flames=json.loads((ROOT/'stories/alone-against-flames/1.0.0/story.json').read_text());base=copy.deepcopy(flames['presets'][0]['skills'])
 # Include all current standard skills, some of which never appeared in Flames.
 engine=(ROOT/'packages/engine/program.ts').read_text();block=engine.split('export const baseSkills: Record<string, number> = {')[1].split('};')[0]
 base.update({k:int(v) for k,v in re.findall(r'(\w+): (\d+)',block)})
 custom={'id':'guided','label':'剧情引导建卡','description':'原书八项属性、九项职业点值及七项兴趣技能；开始时不携带武器。','occupation':'尚未选择','attributes':{k:0 for k in ['str','con','siz','dex','app','pow','int','edu']},'skills':base,'hp':1,'sanity':0,'mp':0,'damageBonus':'0'}
 presets=[custom]
 for name,label in [('eleanor','埃莉诺·伍兹博士'),('ellery','埃勒里·伍兹博士')]:
  skills=base|{'anthropology':60,'archaeology':70,'creditRating':60,'dodge':50,'fightingBrawl':45,'firearmsHandgun':40,'languageOther':40,'languageOwn':80,'libraryUse':40,'locksmith':50,'navigate':30,'persuade':40,'psychology':50,'survival':50}
  presets.append({'id':'tide-'+name,'templateId':'tide-'+name,'label':label,'description':'40 岁的教授；原书角色卡，另有 70 点技能加值。阿拉伯语、生存（沙漠），幸运在建卡后掷骰。','occupation':'教授','attributes':{'str':50,'con':60,'siz':50,'dex':60,'app':40,'int':70,'pow':50,'edu':80},'skills':skills,'build':0,'movement':7,'profile':{'age':40,'pronouns':'她' if name=='eleanor' else '他','birthplace':'波士顿，马萨诸塞州','residence':'阿卡姆，马萨诸塞州'},'specializations':{'languageOther':'阿拉伯语','languageOwn':'英语','survival':'沙漠'},'hp':11,'sanity':50,'mp':10,'damageBonus':'0'})
 notes=['原件及全部原文、译文、附录、角色表和图片保留在 scripts/alone-against-tide；中文翻译来自 GPT-6 Luna，按原文段落逐项对应。','结局名为网页适配编号，不是官方结局名。辅助节点只用于执行同一原书条目的规则。','PDF 第39页（印刷38页）119节视觉核对确实印为18：游泳失败且生还返回18，保留该跳转；187节只有回溯提示119，没有有效正向入口。','自建角色职业技能表补充核对 Chaosium 官方规则网站 https://cthulhuwiki.chaosium.com/investigators/step-three-occupation-and-skills.html（2026-10-13）；原PDF80节仅引用外部规则书。兴趣技能数量按本书改为七项，非职业技能约束沿用其引用的官方建卡规则。','伍兹博士额外70点源于前言，80节说技能已分配不取消这项前言加值。生存专长为沙漠；此次冒险的生存检定按原书通用技能。','使用幸运为可选规则，提供足够幸运时的失败转成功，排除幸运、理智、大失败及孤注一掷；每次保存消耗和原始骰点。','162节单次理智损失至少5时进行标准智力识别；累计损失达初始理智五分之一按本书计暂时性疯狂，理智归零永久退场；不使用重伤。智力识别同时核对 Chaosium 官方快速入门规则 PDF 第28页。永久退场是通用健康规则，不额外占用原书50个结局收藏编号。']
 story={'id':'alone-against-tide','version':version,'rulesVersion':'coc7-solo@2','creationPolicy':'guided','healthPolicy':'tide','spendLuck':True,'title':'潮汐独行','subtitle':'Alone Against the Tide','description':'在湖畔小镇埃斯伯里调查一场神秘拍卖，独自面对潮水、迷雾与古老仪式。','duration':'2–5 小时','difficulty':'进阶','cover':'/art/lighthouse.svg','accent':'#478a91','tags':['单人','KP-less','CoC 7','中文 / English'],'entry':'1','presets':presets,'nodes':nodes,'source':{'file':'scripts/'+graph['source']['filename'],'sha256':graph['source']['sha256'],'notes':notes}}
 return story,{'format':'coc-tide-rule-review@1','sourceGraphSha256':hashlib.sha256((ROOT/'scripts/潮汐独行.dag.json').read_bytes()).hexdigest(),'paragraphs':audit,'notes':notes,'version':version}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',default='work/tide-preview/alone-against-tide/1.0.1');parser.add_argument('--version',default='1.0.1');args=parser.parse_args()
 story,audit=build(args.version);out=ROOT/args.output
 with tempfile.TemporaryDirectory(prefix='coc-tide-review-') as temporary:
  pack_story(story,Path(temporary)/story['id']/story['version'])
  subprocess.run(['npx','tsx',str(ROOT/'tools/story/validate.ts'),temporary],cwd=ROOT,check=True)
 print(pack_story(story,out));write(ROOT/'work/alone-against-tide/rule-review.json',audit)
 if out.resolve().is_relative_to((ROOT/'stories').resolve()):write(SOURCE/f'review/runtime-{story["version"]}.json',audit)
