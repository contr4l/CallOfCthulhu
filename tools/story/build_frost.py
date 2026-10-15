"""Build a source-bound, incomplete Frost candidate without touching formal stories.

The numbered references are never used to invent choices. Only the explicit, reviewed
program map below is executable; the remaining entries stay readable and are reported
as uncompiled. Inputs are the immutable PDF-derived graph and paragraph-pinned zh-CN.
"""
import argparse, copy, hashlib, json, re, subprocess, tempfile
from pathlib import Path
from pack import pack_story

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'scripts/alone-against-frost'
GRAPH=ROOT/'scripts/冰霜独行.dag.json'
TRANSLATIONS=SOURCE/'translations/zh-CN'
REVIEW=SOURCE/'review/runtime-program-001-654.json'
SOURCE_LETHAL_INJURY_SECTIONS={'189','221','321','363','385','407','412','512','514','536'}
SOURCE_HP_ZERO_ADAPTATIONS={'355','391','616'}

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def field(name): return {'field':name}
def cmp(name,op,value): return {'field':name,'op':op,'value':value}
def flag(key,value=True): return {'op':'flag','key':key,'value':value}
def add(name,value): return {'op':'add','field':name,'value':value}
def setv(name,value): return {'op':'set','field':name,'value':value}
def effects(*items,condition=None): return {'kind':'effects','effects':list(items),**({'condition':condition} if condition else {})}
def route(target,condition=None): return {'kind':'route','target':str(target),**({'condition':condition} if condition else {})}
def choice(label,target=None,condition=None,effect=None,call=None,id=None):
    row={'id':id or 'to-'+str(target or call),'label':label}
    if target is not None: row['target']=str(target)
    if call is not None: row['call']=str(call)
    if condition: row['condition']=condition
    if effect: row['effects']=effect
    return row
def choices(*items): return {'kind':'choices','choices':list(items)}
def call(target,condition=None): return {'kind':'call','target':str(target),**({'condition':condition} if condition else {})}
def check(skill,label,success=None,failure=None,**kw):
    condition=kw.pop('condition',None)
    row={'skill':skill,'label':label}
    if success is not None: row['success']=str(success)
    if failure is not None: row['failure']=str(failure)
    row.update(kw)
    return {'kind':'check','check':row,**({'condition':condition} if condition else {})}
def random(sides,targets): return {'kind':'random','sides':sides,'targets':[str(x) for x in targets]}
def end(label): return {'kind':'end','label':label}
def drowning_ending(entry): return f'frost-{entry}-smoke-ending' if int(entry)==407 else f'frost-{entry}-drowning-ending'
def reviewed_programs():
    P={}; src={}; blocked={}
    def put(n,steps,*paragraphs): P[str(n)]=steps;src[str(n)]=[f'{n}:p{i}' for i in paragraphs]
    def healing_choices(n,next_target):
        helper=f'frost-{n}-healall'
        rows=[choice('为所有需要治疗的队员各恢复1点生命值',target=helper,id='heal-all')]
        if isinstance(next_target,str) and next_target.startswith('frost-'):
            rows.append(choice('不恢复，继续',target=next_target,id='continue'))
        else: rows.append(choice('不恢复，继续',target=next_target,id='continue'))
        src[helper]=[f'{n}:p'+('3' if n in (20,60,75) else '2')]
        P[helper]=[effects(add('hp',1),condition=cmp('hp','lt',field('maxHp')))]
        for mid in ['charlie','bernard','sylvia','norman']:
            P[helper].append(effects({'op':'party','member':mid,'action':'hp','value':1},condition={'all':[cmp(f'party.{mid}.present','eq',1),cmp(f'party.{mid}.hp','lt',field(f'party.{mid}.maxHp'))]}))
        P[helper].append(route(next_target))
        return rows
    def least_stealth_checks(success,failure):
        roster=[('$player','纳德尔曼'),('charlie','查理'),('bernard','伯纳德'),('sylvia','西尔维娅'),('norman','诺曼')]
        steps=[]
        for index,(member,label) in enumerate(roster):
            skill='skill.stealth' if member=='$player' else f'party.{member}.skill.stealth'
            conditions=[]
            if member!='$player': conditions.append(cmp(f'party.{member}.present','eq',1))
            for other_index,(other,_) in enumerate(roster):
                if other==member: continue
                other_skill='skill.stealth' if other=='$player' else f'party.{other}.skill.stealth'
                comparison=cmp(other_skill,'gt' if other_index<index else 'gte',field(skill))
                conditions.append(comparison if other=='$player' else {'any':[cmp(f'party.{other}.present','eq',0),comparison]})
            steps.append(check('stealth',f'{label}潜行（当前队伍最低潜行）',success,failure,condition={'all':conditions},**({'actor':member} if member!='$player' else {})))
        return steps
    # Each check, random result and genuine player decision is encoded from its own source paragraph.
    put(1,[check('luck','幸运',2,3)],9)
    put(2,[random(10,[4,5,4,5,4,5,4,5,4,5])],3)
    put(3,[check('pilotBoat','驾驶（船）',6,7)],2)
    put(4,[check('listen','聆听',9,8)],2)
    put(5,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),choices(choice('加快行程，深入北汉尼纳',10),choice('放慢脚步，沿途探索',11))],2)
    put(6,[route(2)],2)
    put(7,[check('luck','幸运',12,412)],2)
    put(8,[check('persuade','说服',14,15)],6)
    put(9,[choices(choice('向入侵者开枪',target='frost-9-firearm',id='shoot'),choice('不开枪',17,id='hold-fire'))],3)
    P['frost-9-firearm']=[check('firearmsRifleShotgun','枪械（步枪／霰弹枪）',6,17,difficulty='hard')];src['frost-9-firearm']=['9:p3']
    put(10,[choices(choice('划到岸边调查',18),choice('继续前进，直到扎营',20))],3)
    put(11,[choices(choice('停下探索峡谷',19),choice('继续前行',20))],2)
    put(12,[check('swim','游泳',13,'frost-12-fail',fumble='frost-12-death')],2)
    P['frost-12-fail']=[effects(add('hp','-1D6')),route(13)];src['frost-12-fail']=['12:p2']
    P['frost-12-death']=[route(drowning_ending(12))];src['frost-12-death']=['12:p2']
    party=['$player','charlie','bernard','sylvia','norman']
    def basefield(who,key): return f'counter.frostBaseline.{who.replace("$player","player")}.{key}'
    def total(items,key): return {'calc':'sum','values':[field(basefield(who,key)) for who in items]}
    def carried(who,key): return 'inventory.'+key+'.count' if who=='$player' else f'party.{who}.inventory.{key}.count'
    def carried_total(items,key): return {'calc':'sum','values':[field(carried(who,key)) for who in items]}
    put(13,[choices(choice('受伤时尝试急救',target='frost-13-first-aid',condition=cmp('hp','lt',field('maxHp')),id='first-aid'),choice('不做急救，继续',target='frost-13-hatchet-roll',id='skip-first-aid'))],3)
    P['frost-13-first-aid']=[check('firstAid','急救',success='frost-13-heal',failure='frost-13-hatchet-roll')];src['frost-13-first-aid']=['13:p3']
    P['frost-13-heal']=[effects(add('hp','1D3')),route('frost-13-hatchet-roll')];src['frost-13-heal']=['13:p3']
    P['frost-13-hatchet-roll']=[random(3,['frost-13-hatchet-1','frost-13-hatchet-2','frost-13-hatchet-3'])];src['frost-13-hatchet-roll']=['13:p3']
    for lost in (1,2,3):
        helper=f'frost-13-hatchet-{lost}'; remaining={'calc':'difference','values':[total(party,'hatchet'),lost]}
        P[helper]=[effects(setv('counter.frost13HatchetLost',lost)),route(f'frost-13-inconsistent-hatchets-{lost}',cmp('counter.frostStartTotal.hatchet','lt',lost)),{'kind':'distribute','label':'分配河水冲走短柄斧后的队伍余量','resource':'item','total':remaining,'recipients':party,'key':'hatchet','itemLabel':'短柄斧'},route('frost-13-rifle-roll')];src[helper]=['13:p3']
        correction=f'frost-13-inconsistent-hatchets-{lost}'
        P[correction]=[{'kind':'number','label':f'本次已掷出损失{lost}把短柄斧，登记起始总数至少需为{lost}；修正未注明数量的原始登记（不重掷本骰）','field':'counter.frostCorrectedStart.hatchet','min':lost,'max':30},{'kind':'distribute','label':'按修正后的短柄斧起始数量重新分配','resource':'item','total':field('counter.frostCorrectedStart.hatchet'),'recipients':party,'key':'hatchet','itemLabel':'短柄斧'},effects(setv('counter.frostStartTotal.hatchet',field('counter.frostCorrectedStart.hatchet')),*[setv(basefield(w,'hatchet'),field(carried(w,'hatchet'))) for w in party]),route(helper)];src[correction]=['13:p3']
    blocked.pop('13-hatchets',None)
    P['frost-13-rifle-roll']=[random(3,['frost-13-rifles-2','frost-13-rifles-3','frost-13-rifles-4'])];src['frost-13-rifle-roll']=['13:p3']
    for count in (2,3,4):
        helper=f'frost-13-rifles-{count}'
        correction=f'frost-13-inconsistent-rifles-{count}'
        P[helper]=[effects(setv('counter.frost13RiflesRemaining',count)),route(correction,cmp('counter.frostStartTotal.rifle','lt',count)),{'kind':'distribute','label':f'分配原文指定剩余的{count}支步枪','resource':'item','total':count,'recipients':party,'key':'rifle','itemLabel':'步枪'},check('luck','幸运',25,22)];src[helper]=['13:p3']
        P[correction]=[{'kind':'number','label':f'原文骰出剩余{count}支步枪，但未注明的起始总数不足；修正登记（不重掷本骰）','field':'counter.frostCorrectedStart.rifle','min':count,'max':30},{'kind':'distribute','label':'按修正后的步枪起始数量重新分配','resource':'item','total':field('counter.frostCorrectedStart.rifle'),'recipients':party,'key':'rifle','itemLabel':'步枪'},effects(setv('counter.frostStartTotal.rifle',field('counter.frostCorrectedStart.rifle')),*[setv(basefield(w,'rifle'),field(carried(w,'rifle'))) for w in party]),route(helper)];src[correction]=['13:p3']
    blocked.pop('13-rifles',None)
    put(14,[check('track','查理的追踪',23,24,target=field('party.charlie.skill.track'))],3)
    put(15,[check('psychology','心理学',27,29)],3)
    put(16,[choices(choice('与查理争辩',30),choice('同意查理，埋葬尸体并顺流返回',165))],6)
    put(17,[check('persuade','说服',35,26)],4)
    put(18,[choices(choice('听从查理的劝告',20),choice('进入山谷，掷1D10判定',target='frost-18-d10',id='enter'))],3)
    P['frost-18-d10']=[random(10,[36,499,36,499,36,499,36,499,36,499])];src['frost-18-d10']=['18:p3']
    put(19,[choices(choice('继续探索峡谷上游',64),choice('返回独木舟并继续上行',20))],3)
    put(20,[choices(*healing_choices(20,21))],3)
    put(21,[choices(choice('自己值第一班岗',40),choice('让伯纳德值第一班岗',46))],6)
    put(22,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),choices(choice('继续探险',31),choice('造木筏顺流返回',51))],4)
    put(23,[effects({'op':'party','member':'bernard','action':'status','value':'dead'}),choices(choice('坚持追查杀害伯纳德的凶手',137),choice('撤离山谷',32))],3,6)
    put(24,[choices(choice('认输离开山谷',32),choice('继续搜寻',52))],2)
    put(25,[choices(choice('恢复此前遗失的全部武器，然后继续',target='frost-25-weapons',id='restore-weapons'),choice('不恢复，返回',513,id='turn-back'))],2)
    restore=[]
    for who in party:
        for key,label in [('hatchet','短柄斧'),('knife','猎刀'),('rifle','步枪')]:
            restore.append({'op':'item-count','key':key,'label':label,'action':'set','member':who,'value':field(basefield(who,key))})
    P['frost-25-weapons']=[effects(*restore),route(2)];src['frost-25-weapons']=['25:p2']
    put(26,[check('psychology','心理学',410,409)],3)
    put(27,[check('psychoanalysis','精神分析',28,29)],2)
    put(28,[check('track','查理的追踪',23,24,target=field('party.charlie.skill.track'))],2)
    put(29,[choices(choice('接受失败，返回',32),choice('让查理留在营地，带其他人继续搜索',52))],3)
    put(30,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'},{'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'},{'op':'party','member':'charlie','action':'status','value':'missing'}),choices(choice('没有独木舟和向导，继续探索',604),choice('沿河岸回到西支流与文明世界',158))],2)
    put(31,[choices(*healing_choices(31,'frost-31-exit'))],2)
    P['frost-31-exit']=[choices(choice('探索洞穴深处',50),choice('寻找附近有趣之处',98),choice('收拾行装继续前进',434))];src['frost-31-exit']=['31:p2']
    put(32,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),check('pilotBoat','驾驶（船）',411,412)],2)
    put(33,[end('探险结束 · 原书第33节')],2)
    put(34,[check('psychoanalysis','精神分析',62,61)],6)
    put(35,[route(10)],3)
    put(36,[random(10,[37,497,37,497,37,497,37,497,37,497])],2)
    put(37,[choices(choice('沿血迹追踪',498),choice('返回',20))],3)
    put(38,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'}),route(63)],2)
    put(39,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),route(67)],3)
    put(40,[choices(choice('面对这场怪事并寻求报复',41),choice('惊惧逃离山谷',43))],6)
    put(41,[choices(choice('让查理离开，独自追踪寒冷杀手',69,effect=[{'op':'party','member':'charlie','action':'status','value':'missing'}]),choice('听从查理的劝告',42))],6)
    put(42,[effects({'op':'party','member':'bernard','action':'status','value':'dead'}),route(32)],3)
    put(43,[effects(setv('counter.frostBernardContestStrength',0)),
       check('dex','查理的敏捷',successEffects=[add('counter.frostBernardContestStrength',field('party.charlie.attribute.str'))],condition=cmp('party.charlie.present','eq',1),target=field('party.charlie.attribute.dex')),
       check('dex','西尔维娅的敏捷',successEffects=[add('counter.frostBernardContestStrength',field('party.sylvia.attribute.str'))],condition=cmp('party.sylvia.present','eq',1),target=field('party.sylvia.attribute.dex')),
       check('dex','纳德尔曼的敏捷',successEffects=[add('counter.frostBernardContestStrength',field('attribute.str'))],target=field('attribute.dex')),
       check('str','对抗伯纳德的93点疯狂力量',44,45,opposed=93,target=field('counter.frostBernardContestStrength'))],4)
    put(44,[route(32)],2)
    put(45,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'},{'op':'party','member':'charlie','action':'status','value':'dead'},{'op':'party','member':'bernard','action':'status','value':'dead'}),route('frost-45-rifle')],3)
    after45=[('rifle','步枪'),('knife','猎刀'),('hatchet','短柄斧')]
    active45=['$player','norman','sylvia']
    def roll_remaining(prefix,key,label,targets,zero_based=False,next_target='324'):
        P[prefix]=[random(3,[f'{prefix}-count-{i}' for i in range(3)])];src[prefix]=targets
        for die in range(1,4):
            count=die-1 if zero_based else die; helper=f'{prefix}-count-{die-1}'
            recipients=['$player','norman','sylvia']
            conflict=f'{prefix}-source-conflict-{count}'
            P[helper]=[effects(setv(f'counter.frostCurrentTotal.{key}',carried_total(recipients,key))),route(conflict,cmp(f'counter.frostCurrentTotal.{key}','lt',count)),{'kind':'distribute','label':f'分配原书剩余的{count}件{label}','resource':'item','total':count,'recipients':recipients,'key':key,'itemLabel':label},route(next_target)];src[helper]=targets
        for die in range(3):
            count=die if zero_based else die+1
            conflict=f'{prefix}-source-conflict-{count}'
            P[conflict]=[{'kind':'number','label':f'{label}当前可分配总数与已掷结果不相容；修正来源未注明的当前总数并保留已掷结果','field':f'counter.frostCorrection.{prefix.replace("frost-", "")}.{count}','min':count,'max':30},{'kind':'distribute','label':f'按修正后的当前数量分配{label}','resource':'item','total':field(f'counter.frostCorrection.{prefix.replace("frost-", "")}.{count}'),'recipients':recipients,'key':key,'itemLabel':label},route(f'{prefix}-count-{die}')];src[conflict]=targets
            blocked.pop(conflict,None)

    roll_remaining('frost-45-rifle','rifle','步枪',['45:p3'],next_target='frost-45-knife')
    roll_remaining('frost-45-knife','knife','猎刀',['45:p3'],next_target='frost-45-hatchet')
    roll_remaining('frost-45-hatchet','hatchet','短柄斧',['45:p3'],next_target=324)
    put(46,[choices(choice('追赶伯纳德',47),choice('先叫醒其他人',71))],5)
    put(47,[choices(choice('抬头看向呼喊处',72),choice('捂住耳朵闭眼等待，并进行意志检定',target='frost-47-pow',id='cover-ears'))],5)
    P['frost-47-pow']=[check('pow','意志',49,48)];src['frost-47-pow']=['47:p4']
    put(48,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),route(67)],2)
    put(49,[check('persuade','说服',73,74)],3)
    put(50,[effects({'op':'party','member':'bernard','action':'status','value':'dead'},{'op':'party','member':'charlie','action':'status','value':'missing'}),choices(choice('继续探险',75),choice('返回文明世界',324))],6)
    put(51,[route(165)],3)
    put(52,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'},{'op':'party','member':'charlie','action':'status','value':'missing'}),route(53)],3)
    put(53,[route(324)],2)
    put(54,[route(324)],2)
    put(55,[check('luck','幸运',413,132)],2)
    put(56,[choices(*healing_choices(56,'frost-56-listen'))],2)
    P['frost-56-listen']=[check('listen','聆听',84,85)];src['frost-56-listen']=['56:p2']
    put(57,[route(54)],2)
    put(58,[choices(choice('随机搜寻伯纳德',59),choice('继续探险',75),choice('返回文明世界',54))],2)
    put(59,least_stealth_checks(86,85),2);blocked.pop('59',None)
    put(60,[choices(*healing_choices(60,'frost-60-firearm'))],3)
    P['frost-60-firearm']=[check('firearmsRifleShotgun','枪械（步枪／霰弹枪）',88,94)];src['frost-60-firearm']=['60:p3']
    put(61,[effects({'op':'party','member':'charlie','action':'status','value':'missing'}),route(95)],4)
    put(62,[choices(choice('追查查理',107),choice('先叫醒学生',109))],7)
    put(63,[check('naturalWorld','自然界',112,213)],3)
    put(64,[check('listen','聆听',65,104)],2)
    put(65,[check('sanity','理智',114,70,failureEffects=[add('sanity','-1D6')])],2)
    put(66,[effects({'op':'party','member':'norman','action':'status','value':'missing'},{'op':'party','member':'sylvia','action':'status','value':'dead'}),route(116)],4)
    put(67,[choices(*[choice('让自己恢复1点生命值',target='frost-67-survival',effect=[add('hp',1)],condition=cmp('hp','lt',field('maxHp')),id='heal-self'),choice('不恢复，进行生存（林地）检定',target='frost-67-survival',id='continue')])],3)
    P['frost-67-survival']=[check('survivalWoodland','生存（林地）',513,'frost-67-fail')];src['frost-67-survival']=['67:p3']
    P['frost-67-fail']=[choices(choice('扎营思考',496),choice('深入森林',501),choice('沿着林缘前进',494),choice('探索岩石地带',427),choice('沿河前进，进行幸运检定',target='frost-67-luck',id='river'))];src['frost-67-fail']=['67:p3','67:p4']
    P['frost-67-luck']=[check('luck','幸运',126,119)];src['frost-67-luck']=['67:p4']
    put(68,[end('中毒身亡 · 原书第68节')],3)
    put(69,[choices(choice('爬上山丘查看另一侧',121),choice('失去勇气，沿原路撤退',122))],5)
    put(70,[effects(add('skill.cthulhuMythos',1)),route(143)],3)
    put(71,[effects({'op':'party','member':'bernard','action':'status','value':'missing'}),choices(choice('坚持追伯纳德',521),choice('听从查理的建议',32))],3)
    put(72,[check('sanity','理智',39,'frost-72-fail',successEffects=[add('sanity','-1D10')])],2)
    P['frost-72-fail']=[effects(add('sanity','-1D100')),route(264)];src['frost-72-fail']=['72:p2']
    put(73,[effects(add('skill.cthulhuMythos',2)),choices(choice('接受伯纳德已经失踪',32),choice('要求查理協助搜寻',521))],4)
    put(74,[choices(choice('离开伯纳德和谜团',32),choice('要求查理协助搜寻',521))],2)
    put(75,[choices(*healing_choices(75,'frost-75-exit'))],3)
    P['frost-75-exit']=[choices(choice('扎营休息，之后原路返回',124),choice('尝试涉水进入隐秘山谷',125))];src['frost-75-exit']=['75:p3']
    put(76,[check('navigate','导航',513,324)],2)
    put(77,[choices(choice('向闯入者开枪',78),choice('放下枪，把他带到火边帮助他',175))],5)
    put(78,[check('luck','幸运',81,79)],2)
    put(79,[check('sanity','理智',97,97,failureEffects=[add('sanity','-1D6')])],3)
    put(80,[random(6,[219,219,219,219,180,180])],2)
    put(81,[route(127)],1)
    put(82,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'}),choices(choice('沿踪迹追去',128),choice('放弃西尔维娅，设法救诺曼',279))],1)
    put(83,[check('anthropology','人类学',418,214)],1)
    put(84,[choices(choice('藏起来，等一切平静',129),choice('站起来与小人接触',130))],2)
    put(85,[choices(choice('放弃伯纳德，带诺曼和西尔维娅逃走',113),choice('向小人开枪',135))],1)
    put(86,[choices(choice('跟随抬着俘虏的人',133),choice('大喊吓退他们',134),choice('向抬俘虏者开枪',135))],1)
    put(87,[check('track','追踪',136,58)],1)
    put(88,[choices(choice('返回文明世界',232),choice('继续深入',604))],1)
    put(89,[choices(*healing_choices(89,'frost-89-luck'))],1)
    P['frost-89-luck']=[check('luck','幸运',90,85)];src['frost-89-luck']=['89:p1']
    put(90,[choices(choice('尝试穿过岩缝',91,condition=cmp('party.bernard.awake','eq',1)),choice('返回麦克唐纳堡方向',158))],1)
    put(91,[check('dex','伯纳德的敏捷',642,643,actor='bernard')],2)
    put(92,[choices(choice('继续探索岩缝',605),choice('启程回家',158))],2)
    put(93,[choices(choice('跳入水中救人',target='frost-93-str'),choice('留在岩架上',534))],1)
    P['frost-93-str']=[check('str','力量',success='frost-93-swim',failure=536)];src['frost-93-str']=['93:p1']
    P['frost-93-swim']=[check('swim','游泳',533,536)];src['frost-93-swim']=['93:p1']
    put(94,[choices(choice('继续探险',75),choice('因悲剧而返回',54))],2)
    put(95,[choices(choice('一见身影就开枪',138),choice('等它靠近',101))],1)
    put(96,[check('sanity','理智',97,97,failureEffects=[add('sanity','-1D6')])],1)
    put(97,[route(105)],1)
    put(98,[route(64)],1)
    put(99,[route(101)],1)
    put(100,[random(10,[96,99,96,99,96,99,96,99,96,99])],1)
    put(101,[check('anthropology','人类学',102,139)],1)
    put(102,[route(177)],1)
    put(103,[check('sanity','理智',105,105,failureEffects=[add('sanity','-1D6')])],1)
    put(104,[check('sanity','理智',468,468,failureEffects=[add('sanity','-1D6')])],1)
    put(105,[check('sanity','理智（结果决定退场性质）',success='frost-105-temporary',failure='frost-105-permanent')],1)
    P['frost-105-temporary']=[end('暂时疯狂后的驱逐与失势 · 原书第105节')];src['frost-105-temporary']=['105:p1']
    P['frost-105-permanent']=[end('被视为精神病罪犯而退场 · 原书第105节')];src['frost-105-permanent']=['105:p1']
    put(106,[check('dex','敏捷对抗（风行者敏捷15）',140,141,target=field('attribute.dex'),opposed=15)],1)
    put(107,[choices(choice('抬头仰望天空',72),choice('遮住脸和耳朵，等怪声消失',109))],1)
    put(108,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(361)],1)
    put(109,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),check('navigate','导航',142,48)],1)
    put(110,[choices(choice('继续进入裂隙',125),choice('转向回家',54))],1)
    put(111,[check('luck','幸运',513,67)],1)
    put(112,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(361)],1)
    put(113,[check('dex','敏捷',147,146)],1)
    put(114,[effects(add('skill.cthulhuMythos',2)),choices(choice('站出来向外星生物问候',252),choice('避免接触，尝试潜行',target='frost-114-stealth'))],2)
    P['frost-114-stealth']=[check('stealth','潜行',159,115)];src['frost-114-stealth']=['114:p2']
    put(115,[route(143)],1)
    put(116,[check('stealth','潜行',111,117)],1)
    put(117,[random(10,[263,265,263,265,263,265,263,265,263,265])],1)
    put(118,[route(116)],1)
    put(119,[check('pow','意志对抗（攻击的意志80）',120,162,target=field('attribute.pow'),opposed=80)],1)
    put(120,[check('pow','困难意志',161,68,difficulty='hard')],1)
    put(121,[check('sanity','理智',166,166,failureEffects=[add('sanity','-1D6')])],1)
    put(122,[check('luck','幸运',171,172)],1)
    put(123,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),route(95)],1)
    put(124,[check('luck','幸运',54,82)],1)
    put(125,[check('luck','幸运',174,93)],1)
    put(126,[choices(choice('乘独木舟冒险穿过险流',242),choice('把独木舟留在这里',119))],1)
    put(127,[choices(choice('尝试与生物搏斗',184),choice('尝试逃跑',187))],1)
    put(128,[check('track','追踪',188,190)],1)
    # Every present party member, including the investigator, rolls once; any failure forces 416.
    put(129,[effects(setv('counter.frostStealthFailures',0)),
       check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frostStealthFailures',1)]),
       *[check('stealth',f'{mid}潜行',condition={'all':[cmp(f'party.{mid}.present','eq',1),cmp(f'party.{mid}.awake','eq',1)]},target=field(f'party.{mid}.skill.stealth'),successEffects=[],failureEffects=[add('counter.frostStealthFailures',1)]) for mid in ['charlie','bernard','sylvia','norman']],
       route(416,cmp('counter.frostStealthFailures','gt',0)),route(195)],1)
    put(130,[choices(choice('跟随受惊的原始人',196),choice('趁他去叫同伴前撤离',131))],1)
    put(131,[check('luck','幸运',195,648)],1)
    put(132,[check('survivalWoodland','生存（林地）',54,197)],1)
    put(133,[choices(choice('保持安静，继续观察',199),choice('采取行动并开枪',135))],1)
    put(134,[check('pow','困难意志',200,201,difficulty='hard')],1)
    # §135: each present rifle holder fires once; every present party member
    # makes the printed DEX roll and a successful rifle holder may fire again.
    frost135=[]
    frost135.extend([effects(setv('counter.frost135Hits',0))])
    frost_roster=[('$player','纳德尔曼'),('charlie','查理'),('bernard','伯纳德'),('sylvia','西尔维娅'),('norman','诺曼')]
    def present_condition(member):
        return None if member=='$player' else {'all':[cmp(f'party.{member}.present','eq',1),cmp(f'party.{member}.awake','eq',1)]}
    def rifle_condition(member):
        key='inventory.rifle.count' if member=='$player' else f'party.{member}.inventory.rifle.count'
        cond=cmp(key,'gt',0)
        return cond if member=='$player' else {'all':[present_condition(member),cond]}
    def actor_kw(member): return {} if member=='$player' else {'actor':member}
    def with_condition(member, condition):
        if member=='$player': return condition
        return {'all':[present_condition(member),condition]}
    for member,label in frost_roster:
        rifle=rifle_condition(member)
        frost135.append(check('firearmsRifleShotgun',f'{label}步枪射击',condition=rifle,successEffects=[add('counter.frost135Hits',1)],**actor_kw(member)))
        dex_flag=f'counter.frost135{member.title().replace("$Player","Player")}Dex'
        frost135.extend([effects(setv(dex_flag,0)),check('dex',f'{label}敏捷',successEffects=[setv(dex_flag,1)],condition=present_condition(member),**actor_kw(member)),check('firearmsRifleShotgun',f'{label}敏捷成功后的第二枪',condition=with_condition(member,{'all':[cmp(dex_flag,'eq',1),cmp('inventory.rifle.count' if member=='$player' else f'party.{member}.inventory.rifle.count','gt',0)]}),successEffects=[add('counter.frost135Hits',1)],**actor_kw(member))])
    frost135.extend([route(202,cmp('counter.frost135Hits','gte',2)),route(201)])
    put(135,frost135,2);blocked.pop('135',None)
    put(136,[check('sanity','理智',203,203,failureEffects=[add('sanity','-1D6')])],1)
    put(137,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'},{'op':'party','member':'charlie','action':'status','value':'missing'}),choices(choice('追踪伯纳德的凶手',87),choice('放弃并徒步带剩余学生离开',324))],1,2)
    put(138,[check('firearmsRifleShotgun','枪械（步枪／霰弹枪）',100,101)],1)
    put(139,[choices(choice('靠近伯纳德并检查绷带',204),choice('让他安静休息，结束守夜',179))],1)
    put(140,[effects(add('sanity','1D6')),route(54)],1)
    put(141,[route(127)],1)
    put(142,[choices(choice('再留一天寻找查理的踪迹',144),choice('放弃向导，继续旅程',324))],1)
    put(143,[effects(setv('counter.frostCharlieDodgeFailed',1),setv('counter.frostBernardDodgeFailed',1)),check('dodge','纳德尔曼闪避',success='frost-143-companions',failure=332)],1)
    P['frost-143-companions']=[check('dodge','查理闪避',condition={'all':[cmp('party.charlie.present','eq',1),cmp('party.charlie.awake','eq',1)]},target=field('party.charlie.skill.dodge'),successEffects=[setv('counter.frostCharlieDodgeFailed',0)],failureEffects=[setv('counter.frostCharlieDodgeFailed',1)]),check('dodge','伯纳德闪避',condition={'all':[cmp('party.bernard.present','eq',1),cmp('party.bernard.awake','eq',1)]},target=field('party.bernard.skill.dodge'),successEffects=[setv('counter.frostBernardDodgeFailed',0)],failureEffects=[setv('counter.frostBernardDodgeFailed',1)]),route(150,{'all':[cmp('counter.frostCharlieDodgeFailed','eq',1),cmp('counter.frostBernardDodgeFailed','eq',1)]}),route(148,cmp('counter.frostCharlieDodgeFailed','eq',1)),route(149,cmp('counter.frostBernardDodgeFailed','eq',1)),route(143)];src['frost-143-companions']=['143:p1']
    put(144,[choices(choice('向出现的身影开枪',206),choice('让它靠近',207))],1)
    put(145,[random(10,[210,211,210,211,210,211,210,211,210,211])],1)
    put(146,[route(145)],1)
    put(147,[route(54)],1)
    put(148,[choices(choice('停下帮助查理',332),choice('和伯纳德继续逃跑',157,effect=[{'op':'party','member':'charlie','action':'status','value':'missing'}]))],1)
    put(149,[choices(choice('停下帮助伯纳德',332),choice('和查理继续逃跑',153,effect=[{'op':'party','member':'bernard','action':'status','value':'missing'}]))],1)
    put(150,[choices(choice('回头帮助他们',332),choice('独自继续逃跑',151,effect=[{'op':'party','member':'charlie','action':'status','value':'missing'},{'op':'party','member':'bernard','action':'status','value':'missing'}]))],1)
    put(151,[choices(choice('绕回去查看失踪同伴遭遇了什么',152),choice('尽量远离那些生物',147))],1)
    put(152,[effects(add('skill.cthulhuMythos',2)),check('sanity','理智',173,'frost-152-fail')],1)
    P['frost-152-fail']=[effects(add('sanity','-1D6')),route(238)];src['frost-152-fail']=['152:p1']
    put(153,[choices(choice('坚持绕回去帮助伯纳德',154),choice('同意查理',155))],1)
    put(154,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),route(152)],1)
    put(155,[route(51,{'flag':'BAREFOOT','equals':True}),route(32,{'flag':'BAREFOOT','equals':False})],1)
    put(156,[effects({'op':'party','member':'charlie','action':'status','value':'missing'}),route('frost-156-hatchet')],4)
    active156=['$player','norman','sylvia']
    def roll_156(prefix,key,label,next_target):
        P[prefix]=[random(3,[f'{prefix}-count-{i}' for i in range(3)])];src[prefix]=['156:p4']
        for die in range(3):
            count=die;helper=f'{prefix}-count-{die}'
            conflict=f'{prefix}-source-conflict-{count}'
            P[helper]=[effects(setv(f'counter.frostCurrentTotal.{key}',carried_total(active156,key))),route(conflict,cmp(f'counter.frostCurrentTotal.{key}','lt',count)),{'kind':'distribute','label':f'分配原书剩余的{count}件{label}','resource':'item','total':count,'recipients':active156,'key':key,'itemLabel':label},route(next_target)];src[helper]=['156:p4']
            P[conflict]=[{'kind':'number','label':f'{label}当前可分配总数与已掷结果不相容；修正来源未注明的当前总数并保留已掷结果','field':f'counter.frostCorrection.156.{key}.{count}','min':count,'max':30},{'kind':'distribute','label':f'按修正后的当前数量分配{label}','resource':'item','total':field(f'counter.frostCorrection.156.{key}.{count}'),'recipients':active156,'key':key,'itemLabel':label},route(helper)];src[conflict]=['156:p4']
            blocked.pop(conflict,None)
    roll_156('frost-156-hatchet','hatchet','短柄斧','frost-156-knife')
    roll_156('frost-156-knife','knife','猎刀','frost-156-rifle')
    roll_156('frost-156-rifle','rifle','步枪',54)
    put(157,[route(158,{'flag':'BAREFOOT','equals':True}),route(163,{'flag':'BAREFOOT','equals':False})],1)
    put(158,[choices(*healing_choices(158,'frost-158-exit'))],1)
    P['frost-158-exit']=[choices(choice('沿河前进',60),choice('登高前进',552),choice('以群山为路标',56),choice('沿林缘前进',233),choice('探索深林',461))];src['frost-158-exit']=['158:p1']
    put(159,[choices(choice('主张留下并继续探索',164),choice('同意结束探险',160))],1)
    put(160,[route(51,{'flag':'BAREFOOT','equals':True}),route(165,{'flag':'BAREFOOT','equals':False})],1)
    # Manually reviewed source rules 161-240; complex combat and multi-person
    # survival procedures remain explicit blockers instead of invented options.
    put(161,[route(433)],4)
    put(162,[route(215)],3)
    put(163,[route(84)],3)
    put(164,[effects({'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),route(56)],3)
    put(165,[effects(setv('counter.frost165Successes',0)),*[check('pilotBoat',f'{who}驾驶（船）',condition=cmp(f'party.{who}.awake','eq',1),target=field(f'party.{who}.skill.pilotBoat'),successEffects=[add('counter.frost165Successes',1)]) for who in ['charlie','bernard','sylvia','norman']],route(513,cmp('counter.frost165Successes','gte',3)),route(156)],2);blocked.pop('165',None)
    put(166,[effects(add('skill.cthulhuMythos',2)),choices(choice('向怪物开枪',167),choice('伏地潜藏并进行潜行检定',target='frost-166-stealth',id='hide'))],3)
    P['frost-166-stealth']=[check('stealth','潜行',171,169)];src['frost-166-stealth']=['166:p3']
    put(167,[check('firearmsRifleShotgun','步枪射击（基础射程内）',168,170)],2)
    put(168,[effects(add('sanity','1D6')),route(171)],2)
    put(169,[end('探险结束 · 原书第169节')],3)
    put(170,[route(169)],2)
    put(171,[route(649)],2)
    put(172,[route(169)],2)
    put(173,[choices(choice('继续观看仪式',253),choice('趁还能行动时逃离',250))],2)
    put(174,[effects({'op':'register','kind':'state','key':'INCHCAPE','label':'印奇凯普'}),choices(choice('离开山谷，筹备正式探险',216),choice('现在采集标本',225))],3)
    put(175,[check('anthropology','人类学',176,179)],2)
    put(176,[choices(choice('立即杀死陌生人',177),choice('继续查证',178))],4)
    put(177,[random(6,[106,106,106,106,103,103])],2)
    put(178,[check('sleightOfHand','妙手',204,80)],2)
    put(179,[random(6,[194,194,194,194,193,193])],2)
    put(180,[route(181)],2)
    put(181,[choices(choice('回家',76),choice('继续探索',75))],2)
    put(182,[effects({'op':'register','kind':'state','key':'RESONATE','label':'共鸣'}),route(513)],3)
    put(183,[end('探险结束 · 原书第183节')],4)
    put(184,[check('firearmsRifleShotgun','枪械（步枪／霰弹枪）',185,186)],2)
    put(185,[effects(add('sanity','1D6')),route(224)],3)
    frost186_roster=['$player','norman','sylvia']
    frost186_melee=[
        {'id':'hatchet','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'actors':frost186_roster},
        {'id':'knife','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'actors':frost186_roster},
        {'id':'fist','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'actors':frost186_roster},
    ]
    for fighter in frost186_roster:
        hatchet_field='inventory.hatchet.count' if fighter=='$player' else f'party.{fighter}.inventory.hatchet.count'
        knife_field='inventory.knife.count' if fighter=='$player' else f'party.{fighter}.inventory.knife.count'
        frost186_melee.append({'id':f'branch-club-{fighter.replace("$player","player")}','label':'树枝棍棒','skill':'fightingBrawl','damage':'1D6','damageBonus':True,'actors':[fighter],'condition':{'all':[cmp(hatchet_field,'eq',0),cmp(knife_field,'eq',0)]}})
    P['186']=[effects(setv('counter.frost186StudentEligible',0)),{'kind':'partyCombat','combat':{
        'sourceSection':'186','participants':[{'id':'$player'},{'id':'norman','condition':{'all':[cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1),cmp('counter.frost186StudentEligible','eq',1)]}},{'id':'sylvia','condition':{'all':[cmp('party.sylvia.present','eq',1),cmp('party.sylvia.awake','eq',1),cmp('counter.frost186StudentEligible','eq',1)]}}],
        'partyTurnOrder':frost186_roster,'enemyTurnOrder':['wind-walker'],'initiative':'enemy-first',
        'enemies':[{'id':'wind-walker','name':'风行者','hp':17,'maxHp':17,'stopAtHp':2,'skills':{'fightingBrawl':40},'attackSkill':'fightingBrawl','damage':'1D8+1D6','targetOrder':['$player']}],
        'weapons':frost186_melee,'win':'frost-186-victory','lose':'frost-186-loss','roundCalls':[{'afterRound':2,'call':'frost-186-sanity'}],
    }}]
    src['186']=['186:p2','186:p3','186:p4']
    P['frost-186-sanity']=[check('sanity','诺曼目睹风行者的理智检定',condition={'all':[cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1)]},actor='norman',successEffects=[setv('counter.frost186StudentEligible',1)],failureEffects=[{'op':'party','member':'norman','action':'unconscious','value':True}]),check('sanity','西尔维娅目睹风行者的理智检定',condition={'all':[cmp('party.sylvia.present','eq',1),cmp('party.sylvia.awake','eq',1)]},actor='sylvia',successEffects=[setv('counter.frost186StudentEligible',1)],failureEffects=[{'op':'party','member':'sylvia','action':'unconscious','value':True}]),route('$return')];src['frost-186-sanity']=['186:p3'];
    P['frost-186-victory']=[effects(add('sanity','1D6')),route(224)];src['frost-186-victory']=['186:p4'];P['frost-186-loss']=[end('纳德尔曼远征结束 · 原书第186节')];src['frost-186-loss']=['186:p4'];blocked.pop('186',None)
    put(187,[check('luck','幸运',336,304)],3)
    put(188,[choices(choice('返回',279),choice('继续穿越急流并进行敏捷检定',target='frost-188-dex',id='cross'))],5)
    P['frost-188-dex']=[check('dex','敏捷',226,189)];src['frost-188-dex']=['188:p5']
    put(189,[{'kind':'end','label':'阻塞：原文要求逐回合溺水CON/游泳检定、1D3伤害并判定死亡','collect':False}],2);blocked['189']='Multi-round drowning requires per-round CON/Swim rolls, damage and death checks; do not collapse it into one roll.'
    put(190,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'}),route(279)],2)
    put(191,[check('con','体质',67,'frost-191-end')],2)
    P['frost-191-end']=[end('探险结束 · 原书第191节')];src['frost-191-end']=['191:p2']
    put(192,[random(10,[357,395,357,395,357,395,357,395,357,395])],3)
    put(193,[check('firstAid','急救',182,181)],2)
    put(194,[check('listen','聆听',220,221)],2)
    put(195,[choices(choice('返回文明世界',158),choice('继续前进',604))],2)
    put(196,[check('dex','敏捷',228,230)],2)
    put(197,[check('pow','纳德尔曼意志',success='frost-197-norman',failure=234)],3)
    P['frost-197-norman']=[check('pow','诺曼意志',actor='norman',condition={'all':[cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1)]},success='frost-197-sylvia',failure=235),route('frost-197-sylvia',cmp('party.norman.present','eq',0)),route(235)];src['frost-197-norman']=['197:p2']
    P['frost-197-sylvia']=[check('pow','西尔维娅意志',actor='sylvia',condition={'all':[cmp('party.sylvia.present','eq',1),cmp('party.sylvia.awake','eq',1)]},success=198,failure=237),route(198,cmp('party.sylvia.present','eq',0)),route(237)];src['frost-197-sylvia']=['197:p2'];blocked.pop('197',None)
    put(198,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),route(297)],3)
    put(199,[check('sanity','理智',239,238,failureEffects=[add('sanity','-1D6')])],2)
    put(200,[route(131)],2)
    put(201,[effects(setv('counter.frost201NormanSuccess',0),setv('counter.frost201SylviaSuccess',0)),check('sanity','纳德尔曼理智',success='frost-201-norman',failure='frost-201-norman',failureEffects=[add('sanity','-1D6')])],2)
    P['frost-201-norman']=[check('sanity','诺曼理智',target=field('party.norman.sanity'),condition=cmp('party.norman.awake','eq',1),successEffects=[setv('counter.frost201NormanSuccess',1)],success='frost-201-sylvia',failure='frost-201-sylvia'),route('frost-201-sylvia',cmp('party.norman.awake','eq',0))];src['frost-201-norman']=['201:p2']
    P['frost-201-sylvia']=[check('sanity','西尔维娅理智',target=field('party.sylvia.sanity'),condition=cmp('party.sylvia.awake','eq',1),successEffects=[setv('counter.frost201SylviaSuccess',1)],success='frost-201-routes',failure='frost-201-routes'),route('frost-201-routes',cmp('party.sylvia.awake','eq',0))];src['frost-201-sylvia']=['201:p2']
    P['frost-201-routes']=[route(246,{'all':[cmp('counter.frost201NormanSuccess','eq',1),cmp('counter.frost201SylviaSuccess','eq',1)]}),route(118,{'all':[cmp('counter.frost201NormanSuccess','eq',0),cmp('counter.frost201SylviaSuccess','eq',0)]}),route(66,cmp('counter.frost201NormanSuccess','eq',0)),route(241)];src['frost-201-routes']=['201:p2'];blocked.pop('201',None)
    put(202,[effects({'op':'party','member':'bernard','action':'status','value':'present'},condition={'all':[cmp('party.bernard.dead','eq',0),cmp('party.bernard.present','eq',0)]}),route(131)],1,2)
    put(203,[effects(add('skill.cthulhuMythos',3)),choices(choice('向凶手开枪',240),choice('全队潜行；所有人成功才安全',target='frost-203-stealth',id='hide'))],3)
    P['frost-203-stealth']=[effects(setv('counter.frost203Failures',0)),check('stealth','纳德尔曼潜行',failureEffects=[add('counter.frost203Failures',1)]),*[check('stealth',f'{who}潜行',actor=who,condition=cmp(f'party.{who}.present','eq',1),failureEffects=[add('counter.frost203Failures',1)]) for who in ['charlie','bernard','sylvia','norman']],route(254,cmp('counter.frost203Failures','gt',0)),route(248)];src['frost-203-stealth']=['203:p3'];blocked.pop('203',None)
    put(204,[random(6,[205,205,205,205,180,180])],2)
    put(205,[check('stealth','潜行',140,141)],3)
    put(206,[route(127)],4)
    put(207,[check('pow','困难意志（奖励骰）',208,127,difficulty='hard',bonus=1)],2)
    put(208,[check('sanity','理智',209,209,failureEffects=[add('sanity','-1D6')])],3)
    put(209,[check('psychology','心理学',212,127)],4)
    male_sylvia_dead={'all':[{'templateId':'nadelmann-male'},cmp('party.sylvia.dead','eq',1)]}
    male_sylvia_alive={'all':[{'templateId':'nadelmann-male'},cmp('party.sylvia.dead','eq',0)]}
    put(210,[route(255,{'any':[{'templateId':'nadelmann-female'},male_sylvia_dead]}),route(260,male_sylvia_alive)],5)
    put(211,[effects({'op':'party','member':'norman','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'dead'}),random(10,[265,263,265,263,265,263,265,263,265,263])],3)
    put(212,[check('dex','敏捷对抗查理敏捷',651,141,target=field('attribute.dex'),opposed=field('party.charlie.attribute.dex'))],3)
    put(213,[check('luck','幸运',record={'roll':'frost213roll','grade':'frost213grade','success':'frost213success','target':'frost213target'}),route(108,cmp('counter.frost213grade','gte',2)),route(315,cmp('counter.frost213grade','eq',1)),route(314)],2)
    put(214,[end('探险结束 · 原书第214节')],3)
    put(215,[check('pow','困难意志',266,267,difficulty='hard')],8)
    put(216,[choices(choice('经水淹裂隙离开',217),choice('寻找更安全的出口并进行幸运检定',target='frost-216-luck',id='search-exit'))],2)
    P['frost-216-luck']=[check('luck','幸运',293,483)];src['frost-216-luck']=['216:p2']
    put(217,[effects(setv('counter.frost217PlayerFail',0),setv('counter.frost217NormanFail',0),setv('counter.frost217SylviaFail',0)),check('dex','纳德尔曼敏捷',successEffects=[],failureEffects=[setv('counter.frost217PlayerFail',1)]),check('dex','西尔维娅敏捷',target=field('party.sylvia.attribute.dex'),condition=cmp('party.sylvia.awake','eq',1),failureEffects=[setv('counter.frost217SylviaFail',1)]),check('dex','诺曼敏捷',target=field('party.norman.attribute.dex'),condition=cmp('party.norman.awake','eq',1),failureEffects=[setv('counter.frost217NormanFail',1)]),route(189,cmp('counter.frost217PlayerFail','eq',1)),route(473,{'all':[cmp('counter.frost217NormanFail','eq',1),cmp('counter.frost217SylviaFail','eq',1)]}),route(223,{'all':[cmp('counter.frost217NormanFail','eq',1),cmp('counter.frost217SylviaFail','eq',0)]}),route(540,cmp('counter.frost217SylviaFail','eq',1)),route(324)],2);blocked.pop('217',None)
    put(218,[route(113)],2)
    put(219,[route(127)],2)
    put(220,[route(127)],2)
    put(221,[check('fightingBrawl','对抗风行者的格斗（斗殴）90',success=222,failure='frost-221-injury',opposed=90,failureEffects=[add('hp','-1D6')])],2);P['frost-221-injury']=[route(221,cmp('hp','gt',0)),end('探险结束 · 生命值归零')];src['frost-221-injury']=['221:p2'];blocked.pop('221',None)
    put(222,[route(127)],2)
    put(223,[choices(choice('冒险下水营救',227),choice('留在岸上',67))],2)
    put(224,[route(513)],2)
    put(225,[check('naturalWorld','自然界',269,275)],2)
    put(226,[check('track','追踪',276,277)],3)
    put(227,[check('swim','困难游泳',251,189,difficulty='hard')],2)
    put(228,[effects(setv('counter.frost228StartHp',field('hp')),setv('counter.frost228DamageTaken',0),setv('counter.frost228Maneuvers',0),setv('counter.frost228Incapacitated',0)),route('frost-228-enemy-choice')],4)
    P['frost-228-enemy-choice']=[choices(choice('尝试闪避对方攻击',target='frost-228-dodge',id='dodge'),choice('不闪避，承受攻击',target='frost-228-attack',id='take-hit'))]
    P['frost-228-dodge']=[check('dodge','闪避小个子男子的攻击',success='frost-228-player-turn',failure='frost-228-attack',opposed=50,opposedTie='check')]
    P['frost-228-player-turn']=[check('fightingBrawl','对小个子男子施展制服战技',success='frost-228-maneuver-success',failure='frost-228-maneuver-failure',opposed=50,opposedTie='check')]
    P['frost-228-maneuver-success']=[effects(add('counter.frost228Maneuvers',1),setv('counter.frost228Incapacitated',1)),route(281,cmp('counter.frost228Maneuvers','gte',2)),route('frost-228-enemy-choice')]
    P['frost-228-maneuver-failure']=[effects(setv('counter.frost228Maneuvers',0)),route('frost-228-enemy-choice')]
    P['frost-228-attack']=[route('frost-228-light-blow',cmp('counter.frost228Incapacitated','eq',1)),route('frost-228-normal-blow')]
    P['frost-228-normal-blow']=[{'kind':'rollEffects','label':'男子以斗殴攻击，掷1D3伤害','effects':[setv('counter.frost228LastDamage','1D3')]},effects(add('hp',{'calc':'product','values':[field('counter.frost228LastDamage'),-1]}),add('counter.frost228DamageTaken',field('counter.frost228LastDamage'))),route(229,cmp('counter.frost228DamageTaken','gte',{'calc':'quotient','values':[{'calc':'sum','values':[field('maxHp'),1]},2]})),route('frost-228-player-turn')]
    P['frost-228-light-blow']=[effects(add('hp',-1),add('counter.frost228DamageTaken',1)),route(229,cmp('counter.frost228DamageTaken','gte',{'calc':'quotient','values':[{'calc':'sum','values':[field('maxHp'),1]},2]})),route('frost-228-player-turn')]
    for helper in ['frost-228-enemy-choice','frost-228-dodge','frost-228-player-turn','frost-228-maneuver-success','frost-228-maneuver-failure','frost-228-attack','frost-228-normal-blow','frost-228-light-blow']: src[helper]=['228:p3','228:p4']
    blocked.pop('228',None)
    put(229,[route(145)],2)
    put(230,[choices(choice('继续搜寻他们',85),choice('逃离其领地并进行幸运检定',target='frost-230-luck',id='flee'))],2)
    P['frost-230-luck']=[check('luck','幸运',158,85)];src['frost-230-luck']=['230:p2']
    put(231,[check('luck','幸运',158,85)],2)
    put(232,[check('luck','幸运',513,158)],3)
    put(233,[effects({'op':'party','member':'bernard','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'missing'}),choices(choice('追踪踪迹',128),choice('放弃西尔维娅，设法救诺曼',279))],4)
    put(234,[effects({'op':'party','member':'norman','action':'status','value':'missing'},{'op':'party','member':'sylvia','action':'status','value':'missing'}),route(162)],2)
    put(235,[effects({'op':'party','member':'norman','action':'unconscious','value':True}),route(236)],3)
    put(236,[check('sanity','理智',282,282,failureEffects=[add('sanity','-1D6')])],2)
    put(237,[effects({'op':'party','member':'sylvia','action':'unconscious','value':True}),route(283)],3)
    put(238,[route(113)],2)
    put(239,[choices(choice('向凶手开枪',240),choice('继续躲藏',248))],2)
    put(240,[random(10,[284,116,284,116,284,116,284,116,284,116])],2)
    # Source-grounded continuation 241-320. Keep compound party checks and
    # combat loops blocked until their exact fixed-order semantics are expressible.
    put(241,[choices(choice('让她离开，带诺曼逃走',279),choice('追上西尔维娅',243))],2)
    put(242,[check('pilotBoat','驾驶（船）',513,514)],2)
    put(243,[check('luck','幸运',244,146)],2)
    put(244,[random(10,[245,324,245,324,245,324,245,324,245,324])],2)
    put(245,[random(10,[237,324,237,324,237,324,237,324,237,324])],2)
    put(246,[route(247)],3)
    put(247,[check('stealth','潜行',53,146)],2)
    put(248,[choices(choice('抬头查看',249),choice('闭眼爬走',250))],4)
    put(249,[effects(add('skill.cthulhuMythos',1)),check('sanity','理智',253,253,failureEffects=[add('sanity','-1D6')])],2)
    put(250,[effects(setv('counter.frost250Failures',0)),*[check('stealth',f'{who}潜行',target=field(f'party.{who}.skill.stealth'),condition=cmp(f'party.{who}.awake','eq',1),failureEffects=[add('counter.frost250Failures',1)]) for who in ['charlie','bernard','sylvia','norman']],route(247,cmp('counter.frost250Failures','gt',0)),route(224)],2);blocked.pop('250',None)
    put(251,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'},{'op':'party','member':'norman','action':'hp','value':'-2D8'}),route('frost-251-norman-dead',cmp('party.norman.hp','lte',0)),choices(choice('对诺曼尝试急救',target='frost-251-first-aid',condition=cmp('party.norman.hp','gt',0),id='first-aid'),choice('不急救，继续返程',target='frost-251-finish',condition=cmp('party.norman.hp','gt',0),id='skip-first-aid'))],2)
    P['frost-251-first-aid']=[check('firstAid','急救',success='frost-251-heal',failure='frost-251-finish')];src['frost-251-first-aid']=['251:p2']
    P['frost-251-heal']=[effects({'op':'party','member':'norman','action':'hp','value':'1D3'}),route('frost-251-finish')];src['frost-251-heal']=['251:p2']
    P['frost-251-norman-dead']=[effects({'op':'party','member':'norman','action':'status','value':'dead'}),route(67)];src['frost-251-norman-dead']=['251:p2']
    P['frost-251-finish']=[route('frost-251-norman-dead',cmp('party.norman.hp','lte',0)),effects({'op':'party','member':'norman','action':'status','value':'present'}),route(279)];src['frost-251-finish']=['251:p2']
    put(252,[effects(add('skill.cthulhuMythos',1)),route(143)],5)
    put(253,[effects(add('skill.cthulhuMythos',2)),check('sanity','理智',250,250,failureEffects=[add('sanity','-1D6')])],4)
    put(254,[route(247)],2)
    put(255,[check('pow','意志对抗女王的90点意志',256,259,target=field('attribute.pow'),opposed=90)],5)
    put(256,[route(257)],3)
    put(257,[effects(setv('counter.frost257Successes',0)),check('dex','纳德尔曼困难敏捷',difficulty='hard',successEffects=[add('counter.frost257Successes',1)]),*[check('dex',f'{who}困难敏捷',actor=who,condition=cmp(f'party.{who}.present','eq',1),difficulty='hard',successEffects=[add('counter.frost257Successes',1)]) for who in ['charlie','bernard','sylvia','norman']],route(224,cmp('counter.frost257Successes','gt',0)),route(258)],2);blocked.pop('257',None)
    put(258,[end('探险结束 · 原书第258节')],3)
    put(259,[end('探险结束 · 原书第259节')],6)
    # §260 depicts Sylvia at the scene, so a missing/absent status is corrected
    # before her check. An explicit death is never overwritten: the book gives
    # no resurrection rule, so that contradictory roster is stopped for review.
    sylvia_alive={'field':'party.sylvia.dead','op':'eq','value':0}
    put(260,[effects({'op':'party','member':'sylvia','action':'status','value':'present'},condition=sylvia_alive),effects({'op':'party','member':'sylvia','action':'restore'},condition=sylvia_alive),check('pow','西尔维娅意志对抗女王的90点意志',261,262,target=field('party.sylvia.attribute.pow'),opposed=90,condition=sylvia_alive),route(255,cmp('party.sylvia.dead','eq',1))],1,2,3)
    put(261,[route(257)],3)
    put(262,[random(10,[265,263,265,263,265,263,265,263,265,263])],4)
    put(263,[route(264)],4)
    put(264,[{'kind':'rollEffects','label':'掷出召唤的意志值并保存一次','effects':[setv('counter.frostSummonsPow','4D6+60')]},check('pow','抵抗召唤的意志对抗',39,215,target=field('attribute.pow'),opposed=field('counter.frostSummonsPow'))],2)
    put(265,[route(417)],2)
    put(266,[check('pow','困难意志',285,267,difficulty='hard')],2)
    put(267,[route(268)],3)
    put(268,[end('探险结束 · 原书第268节')],3)
    put(269,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(217)],3)
    put(270,[choices(choice('为自己急救',target='frost-270-player',condition=cmp('hp','lt',field('maxHp')),id='first-aid-self'),choice('为诺曼急救',target='frost-270-norman',condition={'all':[cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1),cmp('party.norman.hp','lt',field('party.norman.maxHp'))]},id='first-aid-norman'),choice('不急救，继续',278,id='skip'))],2);blocked.pop('270',None)
    P['frost-270-player']=[check('firstAid','急救并治疗自己',success=278,failure=278,successEffects=[add('hp','1D3')])];src['frost-270-player']=['270:p2']
    P['frost-270-norman']=[check('firstAid','急救并治疗诺曼',success=278,failure=278,successEffects=[{'op':'party','member':'norman','action':'hp','value':'1D3'}])];src['frost-270-norman']=['270:p2']
    # §271 begins with the wolf already on Norman. The section gives two real
    # player actions, source HP/damage, and a Norman-death override. The opening
    # enemy action follows the present-tense attack already underway.
    wolf271_roster=['$player','norman']
    wolf271_weapons=[
        {'id':'rifle','label':'步枪射击','skill':'firearmsRifleShotgun','damage':'2D6+4','key':'rifle','firearm':True,'penalty':1,'fumbleTarget':'norman','actors':['$player']},
        {'id':'hatchet-player','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'bonus':1,'actors':['$player']},
        {'id':'knife-player','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'bonus':1,'actors':['$player']},
        {'id':'fist-player','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'bonus':1,'actors':['$player']},
        {'id':'hatchet-norman','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'actors':['norman']},
        {'id':'knife-norman','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'actors':['norman']},
        {'id':'fist-norman','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'actors':['norman']},
    ]
    wolf271={
        'sourceSection':'271','participants':[{'id':'$player'},{'id':'norman','condition':cmp('party.norman.present','eq',1)}],
        'partyTurnOrder':wolf271_roster,'enemyTurnOrder':['wolf'],'initiative':'enemy-first',
        'enemies':[{'id':'wolf','name':'狼','hp':12,'maxHp':15,'skills':{'fightingBrawl':30},'attackSkill':'fightingBrawl','damage':'1D8+1D4','targetOrder':['norman','$player'],'damageMode':'target'}],
        'weapons':wolf271_weapons,'fatalCompanions':['norman'],'win':'270','lose':'frost-271-expedition-end',
        'routes':[{'condition':cmp('party.norman.dead','eq',1),'target':'365'}],
    }
    P['frost-271-init']=[effects(setv('counter.frost271Started',1),{'op':'party','member':'sylvia','action':'status','value':'dead'},{'op':'party','member':'norman','action':'hp','value':-6}),route(271)];src['frost-271-init']=['271:p1','271:p2']
    put(271,[route('frost-271-init',cmp('counter.frost271Started','eq',0)),choices(choice('开枪救援诺曼',target='frost-271-rifle',condition=cmp('inventory.rifle.count','gt',0),id='shoot'),choice('加入诺曼，与狼近战',target='frost-271-melee',id='melee'))],4);blocked.pop('271',None)
    P['frost-271-rifle']=[{'kind':'partyCombat','combat':{**copy.deepcopy(wolf271),'weapons':[wolf271_weapons[0],*wolf271_weapons[4:]]}}];src['frost-271-rifle']=['271:p1','271:p2','271:p3','271:p4']
    P['frost-271-melee']=[{'kind':'partyCombat','combat':{**copy.deepcopy(wolf271),'weapons':wolf271_weapons[1:]}}];src['frost-271-melee']=['271:p1','271:p2','271:p3','271:p4']
    P['frost-271-expedition-end']=[{'kind':'end','label':'纳德尔曼远征结束 · 原书第271节未另列调查员失能后的编号去向','collect':False}];src['frost-271-expedition-end']=['271:p4']
    put(272,[end('探险结束 · 原书第272节')],5)
    put(273,[choices(choice('就地射击，尝试捕获标本',286),choice('跑向高树',288))],3)
    put(274,[route(272)],2)
    put(275,[choices(choice('空手返回阿卡姆',216),choice('继续探索',551))],2)
    put(276,[check('stealth','潜行',290,289)],3)
    put(277,[choices(choice('随机寻找西尔维娅',292),choice('放弃努力，返回文明世界',278),choice('放弃搜寻，继续探索山谷',38))],2)
    put(278,[route(279)],2)
    put(279,[choices(choice('你与诺曼如需治疗，各恢复1点生命',target='frost-279-paths',effect=[add('hp',1),{'op':'party','member':'norman','action':'hp','value':1}],id='heal'),choice('不恢复生命',target='frost-279-paths',id='skip-heal'))],2)
    P['frost-279-paths']=[choices(choice('走直接路线',295),choice('沿河流方向行进',280),choice('寻找现有小径',297),choice('探索岩石地带',595),choice('先扎营并掷幸运',target='frost-279-camp-luck',id='camp'))];src['frost-279-paths']=['279:p2']
    P['frost-279-camp-luck']=[check('luck','幸运',296,298)];src['frost-279-camp-luck']=['279:p2'];blocked.pop('279',None)
    put(280,[choices(choice('继续前行调查',474),choice('退入洞穴藏身',333))],2)
    put(281,[choices(choice('带走俘虏回家',299),choice('释放他',300))],4)
    put(282,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),route(328)],2)
    put(283,[effects({'op':'party','member':'sylvia','action':'restore'}),check('pow','西尔维娅的困难意志',305,306,actor='sylvia',difficulty='hard')],1,3)
    put(284,[check('luck','幸运',316,67)],2)
    put(285,[check('str','与第一名猎人对抗力量',success='frost-285-second',failure='frost-285-fail',opposed=60,bonus=1,opposedPenalty=1)],3)
    P['frost-285-second']=[check('str','与第二名猎人对抗力量',success='frost-285-third',failure='frost-285-fail',opposed=60,bonus=1,opposedPenalty=1)]
    P['frost-285-third']=[check('str','与第三名猎人对抗力量',success=268,failure='frost-285-fail',opposed=60,bonus=1,opposedPenalty=1)]
    P['frost-285-fail']=[end('被猎人制服 · 原书第285节')]
    for helper in ['frost-285-second','frost-285-third','frost-285-fail']: src[helper]=['285:p3']
    blocked.pop('285',None)
    put(286,[effects(setv('counter.frost286Hits',0)),{'kind':'rollEffects','label':'掷出并记录狼群数量','effects':[setv('counter.frost286WolfCount','2D6')]},*[check('firearmsRifleShotgun',f'{who}步枪射击（第{shot}枪）',actor=who,condition={'all':[cmp(f'party.{who}.present','eq',1),cmp(f'party.{who}.awake','eq',1),cmp(f'party.{who}.inventory.rifle.count','gt',0)]},successEffects=[add('counter.frost286Hits',1)]) for who in ['player','charlie','bernard','sylvia','norman'] for shot in [1,2] if who!='player'],*[check('firearmsRifleShotgun',f'纳德尔曼步枪射击（第{shot}枪）',condition=cmp('inventory.rifle.count','gt',0),successEffects=[add('counter.frost286Hits',1)]) for shot in [1,2]],route('frost-286-results')],4)
    enough=[cmp('counter.frost286WolfCount','eq',n) for n in range(2,13)]
    enough_hits=[cmp('counter.frost286Hits','gte',(n+1)//2) for n in range(2,13)]
    P['frost-286-results']=[route(287,{'any':[{'all':[enough[i],enough_hits[i]]} for i in range(11)]}),effects(setv('counter.frost286WolvesRemaining',{'calc':'difference','values':[field('counter.frost286WolfCount'),field('counter.frost286Hits')]})),route(307)];src['frost-286-results']=['286:p3','286:p4'];blocked.pop('286',None)
    put(287,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(652)],2)
    put(288,[effects(setv('counter.frost288Failures',0)),check('climb','纳德尔曼困难攀爬（奖励骰）',difficulty='hard',bonus=1,failureEffects=[add('counter.frost288Failures',1)]),check('climb','诺曼困难攀爬（奖励骰）',target=field('party.norman.skill.climb'),difficulty='hard',bonus=1,condition=cmp('party.norman.awake','eq',1),failureEffects=[add('counter.frost288Failures',1)]),check('climb','西尔维娅困难攀爬（奖励骰）',target=field('party.sylvia.skill.climb'),difficulty='hard',bonus=1,condition=cmp('party.sylvia.awake','eq',1),failureEffects=[add('counter.frost288Failures',1)]),route(307,cmp('counter.frost288Failures','gt',0)),route(308)],3);blocked.pop('288',None)
    put(289,[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(310,{'any':[cmp('sanity.temporary','eq',1),cmp('sanity.indefinite','eq',1)]}),route(309)],2);blocked.pop('289',None)
    put(290,[effects(setv('counter.frost290NormanFail',0)),check('sanity','纳德尔曼理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),check('sanity','诺曼理智',target=field('party.norman.sanity'),condition=cmp('party.norman.present','eq',1),failureEffects=[add('party.norman.sanity','-1D6'),setv('counter.frost290NormanFail',1)]),route(550,cmp('sanity.permanent','eq',1)),route(310,{'any':[cmp('sanity.temporary','eq',1),cmp('sanity.indefinite','eq',1)]}),route(312,cmp('counter.frost290NormanFail','eq',1)),route(311)],2);blocked.pop('290',None)
    put(291,[random(6,[217,293,294,317,370,371])],2)
    put(292,[effects(setv('counter.frost292Track',0),setv('counter.frost292Luck',0)),check('track','追踪',successEffects=[setv('counter.frost292Track',1)],failureEffects=[setv('counter.frost292Track',0)]),check('luck','幸运',successEffects=[setv('counter.frost292Luck',1)],failureEffects=[setv('counter.frost292Luck',0)]),route(290,{'all':[cmp('counter.frost292Track','eq',1),cmp('counter.frost292Luck','eq',1)]}),route(315,{'all':[cmp('counter.frost292Track','eq',0),cmp('counter.frost292Luck','eq',0)]}),route(289,cmp('counter.frost292Track','eq',1)),route(314)],2);blocked.pop('292',None)
    put(293,[route(324)],2)
    put(294,[random(10,[403,402,403,402,403,402,403,402,403,402])],3)
    put(295,[effects({'op':'party','member':'norman','action':'status','value':'missing'}),route(67)],2)
    put(296,[choices(choice('向看不见的生物开枪',325),choice('等待观察',326))],3)
    put(297,[check('survivalWoodland','生存（林地）',513,331)],2)
    put(298,[choices(choice('熄灭火焰并藏起来',333),choice('把火烧旺',329))],3)
    put(299,[choices(choice('继续回家',158),choice('折返探索北汉尼纳山谷',89))],3)
    put(300,[check('luck','幸运',success='frost-300-success',failure=85)],3)
    P['frost-300-success']=[choices(choice('继续探索',89),choice('返回家园',158))];src['frost-300-success']=['300:p3']
    put(301,[check('firearmsRifleShotgun','近距离枪械射击',302,339)],2)
    put(302,[effects(add('sanity','1D6')),route(67)],3)
    put(303,[check('sanity','理智',success='frost-303-choice',failure='frost-303-choice',failureEffects=[add('sanity','-1D6')])],2)
    P['frost-303-choice']=[choices(choice('逃入树林',304),choice('与怪物战斗',301))];src['frost-303-choice']=['303:p2']
    put(304,[check('stealth','潜行',336,337)],2)
    put(305,[choices(choice('劝说西尔维娅',306),choice('向她开枪',301),choice('追赶诺曼',338))],3)
    put(306,[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(39,cmp('sanity.temporary','eq',1)),route(364,cmp('sanity.indefinite','eq',1)),route(304)],2);blocked.pop('306',None)
    # §307 divides the pack among the three expedition members, but tells the
    # investigator to fight only the wolves that targeted him. Preserve the
    # 286 remainder when present; otherwise this is the first encounter and
    # the source calls for a fresh 2D6 pack count.
    frost307_weapons=[
        {'id':'hatchet-player-307','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'actors':['$player']},
        {'id':'knife-player-307','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'actors':['$player']},
        {'id':'fist-player-307','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'actors':['$player']},
    ]
    P['frost-307-count']=[
        {'kind':'rollEffects','label':'记录本节开始时的生命值','effects':[setv('counter.frost307StartHp',field('hp'))]},
        route('frost-307-use-remainder',cmp('counter.frost286WolvesRemaining','gt',0)),
        route('frost-307-roll-count'),
    ]
    P['frost-307-use-remainder']=[effects(setv('counter.frost307WolfCount',field('counter.frost286WolvesRemaining'))),route('frost-307-resolve-count')]
    P['frost-307-roll-count']=[{'kind':'rollEffects','label':'掷出并记录2D6只恐狼','effects':[setv('counter.frost307WolfCount','2D6')]},route('frost-307-resolve-count')]
    P['frost-307-resolve-count']=[
        route('frost-307-small-pack',cmp('counter.frost307WolfCount','lt',3)),
        {'kind':'partyCombat','combat':{
            'sourceSection':'307','participants':[{'id':'$player'}],
            'partyTurnOrder':['$player'],'enemyTurnOrder':['dire-wolves'],
            'initiative':'enemy-first',
            'enemies':[{'id':'dire-wolves','name':'袭击纳德尔曼的恐狼','count':{'calc':'quotient','values':[field('counter.frost307WolfCount'),3]},'hp':15,'maxHp':15,'skills':{'fightingBrawl':30},'attackSkill':'fightingBrawl','damage':'1D8+1D4','targetOrder':['$player'],'damageMode':'target'}],
            'weapons':frost307_weapons,'win':'frost-307-after-fight','lose':'frost-307-expedition-end'
        }}
    ]
    P['frost-307-small-pack']=[choices(choice('帮助一名学生对付他那边的狼群',271),choice('逃走保命',340))]
    P['frost-307-after-fight']=[route(340,cmp('hp','gte',field('counter.frost307StartHp'))),route(347)]
    P['frost-307-expedition-end']=[end('纳德尔曼远征结束 · 原书第307节')]
    for helper in ['frost-307-count','frost-307-use-remainder','frost-307-roll-count','frost-307-resolve-count','frost-307-small-pack','frost-307-after-fight','frost-307-expedition-end']: src[helper]=['307:p1','307:p2','307:p3']
    put(307,[route('frost-307-count')],3);blocked.pop('307',None)
    put(308,[choices(choice('挣脱狼口（敏捷检定）',target='frost-308-dex',id='dex'),choice('撞击狼头（斗殴检定）',target='frost-308-brawl',id='brawl'))],3)
    P['frost-308-dex']=[check('dex','敏捷',344,345)];src['frost-308-dex']=['308:p3']
    P['frost-308-brawl']=[check('fightingBrawl','斗殴',344,345)];src['frost-308-brawl']=['308:p3']
    put(309,[choices(choice('开枪吓退它们',346),choice('保持冷静',348))],2)
    put(310,[route(550,cmp('sanity.permanent','eq',1)),route(350,cmp('sanity.temporary','eq',1)),route(364,cmp('sanity.indefinite','eq',1))],2);blocked.pop('310',None)
    put(311,[choices(choice('开枪吓退猿人',353),choice('等到夜幕潜入营地救人',359),choice('接受无法救援西尔维娅',360))],6)
    put(312,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'}),choices(choice('追踪生物',362),choice('接受西尔维娅失踪并离开失落山谷',360),choice('暂且放下悲痛，继续探索',63))],2)
    put(313,[random(10,[315,314,315,314,315,314,315,314,315,314])],2)
    put(314,[choices(choice('抬头仰望天空',318),choice('离开空旷地带',363))],3)
    put(315,[choices(choice('让全队向巨鸟开火',366),choice('逃跑',369))],3)
    put(316,[check('str','西尔维娅力量对抗诺曼体型',322,319,target=field('party.sylvia.attribute.str'),opposed=field('party.norman.attribute.siz'))],3);blocked.pop('316',None)
    put(317,[route(288)],2)
    put(318,[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(320,{'all':[cmp('sanity.temporary','eq',0),cmp('sanity.indefinite','eq',0)]}),end('疯狂中遭踩踏致死 · 原书第318节')],2);blocked.pop('318',None)
    put(319,[choices(choice('跳入水中实施危险营救',227),choice('留在岸上，返回67',67,effect=[{'op':'party','member':'norman','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'dead'}]))],2)
    put(320,[effects(add('skill.cthulhuMythos',1)),route(321)],2)
    # Source-grounded continuation 321-400. Complex combat loops, team hit
    # accounting and insanity-dependent branches are explicit blockers below.
    put(321,[check('int','智力',323,'frost-321-damage')],2)
    P['frost-321-damage']=[effects(add('hp','-4D6'),{'op':'party','member':'norman','action':'hp','value':'-4D6'}),route(347,cmp('hp','gt',0)),end('踩踏致死 · 原书第321节')];src['frost-321-damage']=['321:p2'];blocked.pop('321',None)
    put(322,[check('luck','幸运',513,324)],2)
    put(323,[route(278)],2)
    ridge_condition={'all':[cmp('party.sylvia.dead','eq',0),cmp('party.norman.dead','eq',0)]}
    put(324,[choices(choice('沿河前进',470),choice('攀上山脊',469,condition=ridge_condition),choice('穿过疏林',218),choice('深入森林',557),choice('寻找补给并掷幸运',target='frost-324-supply',id='supplies'))],2)
    P['frost-324-supply']=[check('luck','幸运',654,132)];src['frost-324-supply']=['324:p2']
    put(325,[{'kind':'end','label':'阻塞：困难步枪检定后按实际伤害是否达到8点路由373/376','collect':False}],2);blocked['325']='Hard rifle check must route on damage dealt >=8, not just hit/miss.'
    put(326,[check('sanity','理智',493,493,failureEffects=[add('sanity','-1D6')])],2)
    put(327,[route(67,{'any':[cmp('party.norman.present','eq',0),cmp('party.norman.awake','eq',0)]}),check('con','诺曼体质',543,67,target=field('party.norman.attribute.con'),condition=cmp('party.norman.present','eq',1))],3)
    put(328,[effects({'op':'party','member':'norman','action':'restore'}),route(303)],2)
    put(329,[route(335)],2)
    put(330,[check('luck','幸运',336,516)],2)
    put(331,[random(10,[328,327,328,327,328,327,328,327,328,327])],2)
    put(332,[route(417)],2)
    put(333,[route('frost-333-roster-gap',{'any':[cmp('party.norman.present','eq',0),cmp('party.norman.awake','eq',0)]}),effects(setv('counter.frost333Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost333Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),condition=cmp('party.norman.awake','eq',1),successEffects=[],failureEffects=[add('counter.frost333Failures',1)]),route(334,cmp('counter.frost333Failures','eq',0)),route(335)],2)
    P['frost-333-roster-gap']=[{'kind':'end','label':'来源缺口：第333节要求纳德尔曼与诺曼潜行，但诺曼不在场或失能时未给去向','collect':False}];src['frost-333-roster-gap']=['333:p1','333:p2']
    put(334,[route(513)],2)
    put(335,[choices(choice('与怪异入侵者战斗',380),choice('冲出洞穴，丢下诺曼逃走',330))],2)
    put(336,[route(67)],2)
    wind337_weapons=[
        {'id':'rifle','label':'步枪','skill':'firearmsRifleShotgun','damage':'2D6+4','key':'rifle','firearm':True,'penalty':1,'actors':['$player']},
        {'id':'hatchet','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'penalty':1,'actors':['$player']},
        {'id':'knife','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'penalty':1,'actors':['$player']},
        {'id':'fist','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'penalty':1,'actors':['$player']},
    ]
    put(337,[{'kind':'rollEffects','label':'掷风行者生命值3D6+6并保存','effects':[setv('counter.frost337WindwalkerHp','3D6+6')]},{'kind':'partyCombat','combat':{'sourceSection':'337','participants':[{'id':'$player'}],'partyTurnOrder':['$player'],'enemyTurnOrder':['windwalker'],'initiative':'enemy-first','enemies':[{'id':'windwalker','name':'风行者','hp':field('counter.frost337WindwalkerHp'),'maxHp':field('counter.frost337WindwalkerHp'),'skills':{'fightingBrawl':40},'attackSkill':'fightingBrawl','damage':'1D8+1D6','targetOrder':['$player'],'damageMode':'target'}],'weapons':wind337_weapons,'win':'frost-337-victory','lose':'frost-337-loss'}}],3,4);blocked.pop('337',None)
    P['frost-337-victory']=[effects(add('sanity','1D6')),choices(choice('尝试急救，成功恢复1D3点生命',target='frost-337-first-aid',condition=cmp('hp','lt',field('maxHp')),id='aid'),choice('不急救，前往第67节',67,id='continue'))];src['frost-337-victory']=['337:p4']
    P['frost-337-first-aid']=[check('firstAid','急救',success=67,failure=67,successEffects=[add('hp','1D3')])];src['frost-337-first-aid']=['337:p4']
    P['frost-337-loss']=[{'kind':'end','label':'纳德尔曼远征结束 · 原书第337节','collect':True}];src['frost-337-loss']=['337:p3']
    put(338,[effects(setv('counter.frost338PlayerSuccess',0),setv('counter.frost338NormanSuccess',0)),check('con','困难诺曼体质',target=field('party.norman.attribute.con'),difficulty='hard',successEffects=[setv('counter.frost338NormanSuccess',1)]),check('con','纳德尔曼体质',successEffects=[setv('counter.frost338PlayerSuccess',1)]),route(337,cmp('counter.frost338PlayerSuccess','eq',0)),route(336,cmp('counter.frost338NormanSuccess','eq',0)),route(513)],2)
    put(339,[check('con','体质',336,337,difficulty='hard')],2)
    put(340,[check('con','体质（原始HP低于一半时惩罚骰）',success=356,failure='frost-340-end',modifiers=[{'condition':cmp('hp','lt',{'calc':'quotient','values':[field('maxHp'),2]}),'penalty':1}])],2)
    P['frost-340-end']=[end('远征结束 · 原书第340节')];src['frost-340-end']=['340:p2']
    put(341,[choices(choice('尝试急救',target='frost-341-first-aid',id='first-aid'),choice('不急救，继续',target='frost-341-specimen',id='continue'))],3)
    P['frost-341-first-aid']=[check('firstAid','急救',success='frost-341-specimen',failure='frost-341-specimen',successEffects=[add('hp','1D3')])];src['frost-341-first-aid']=['341:p3']
    P['frost-341-specimen']=[choices(choice('带走头颅并记录STOCKHOUSE',target='frost-341-keyword',id='take-head'),choice('不带走头颅',377,id='leave-head'))];src['frost-341-specimen']=['341:p3']
    P['frost-341-keyword']=[effects({'op':'register','kind':'state','key':'STOCKHOUSE','label':'斯托克豪斯'}),route(377)];src['frost-341-keyword']=['341:p3']
    put(342,[end('远征结束 · 原书第342节')],2)
    put(343,[effects(add('hp','1D3')),route(365)],3)
    put(344,[route(293)],2)
    put(345,[end('远征结束 · 原书第345节')],3)
    put(346,[random(6,[519,519,519,519,481,481])],2)
    put(347,[check('con','体质',343,342)],2)
    put(348,[check('anthropology','人类学',349,376)],2)
    put(349,[route(350)],2)
    put(350,[check('sanity','西尔维娅理智',352,351,target=field('party.sylvia.sanity'))],2)
    put(351,[route(389)],2)
    put(352,[check('int','智力',387,389)],3)
    put(353,[check('luck','幸运',500,354)],2)
    put(354,[{'kind':'end','label':'阻塞：两名角色分别CON检定，极难成功改变各自MOV，按猿人MOV7的条件顺序路由355/356/358','collect':False}],3);blocked['354']='Movement chase depends on two CON rolls, individual Extreme success/failure movement modifiers and ordered comparisons.'
    put(355,[effects(add('hp','-1D10')),route('frost-355-survival')],2)
    P['frost-355-survival']=[route(347,cmp('hp','gt',0)),route(191,cmp('hp','lte',0))];src['frost-355-survival']=['355:p2']
    put(356,[route(365)],3)
    put(357,[route(542)],3)
    put(358,[route(361)],3)
    put(359,[effects(setv('counter.frost359Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost359Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost359Failures',1)]),route(393,cmp('counter.frost359Failures','eq',0)),route(390)],2)
    put(360,[check('luck','困难幸运',361,313,difficulty='hard')],2)
    put(361,[route(279)],2)
    put(362,[choices(choice('开枪吓退生物',346),choice('避免攻击动作',348))],2)
    put(363,[check('con','体质（奖励骰）',success=361,failure='frost-363-stampede',bonus=1)],2)
    P['frost-363-stampede']=[effects(add('hp','-2D10')),route(347,cmp('hp','gt',0)),end('远征结束 · 原书第363节')];src['frost-363-stampede']=['363:p2']
    put(364,[effects(add('skill.cthulhuMythos',5),condition={'not':{'flag':'indefinite','equals':True}}),effects(add('skill.cthulhuMythos',1),condition={'flag':'indefinite','equals':True}),effects(flag('indefinite')),random(6,[550,550,550,550,549,549])],2,3)
    put(365,[route(67)],2)
    # §366 has one normal-range shot per present rifle holder, then a real
    # optional point-blank bonus-die shot for each shooter who passes DEX.
    frost366=[effects(setv('counter.frost366Damage',0))]
    for member,label in frost_roster:
        key=member.replace('$player','player'); rifle=rifle_condition(member)
        dex_flag=f'counter.frost366{key.title()}Dex'; shooter=f'frost-366-shooter-{key}'
        extra=f'frost-366-extra-{key}'; shot=f'frost-366-shot-{key}'
        frost366.append({'kind':'call','target':shooter})
        shooter_checks=[]
        count_field='inventory.rifle.count' if member=='$player' else f'party.{member}.inventory.rifle.count'
        for shot_no in range(1,31):
            shooter_checks.append(check('firearmsRifleShotgun',f'{label}正常射程步枪射击（第{shot_no}支枪）',condition=with_condition(member,cmp(count_field,'gte',shot_no)),successEffects=[add('counter.frost366Damage','2D6+4')],**actor_kw(member)))
            shooter_checks.append(route('$return',cmp(count_field,'lt',shot_no)))
        P[shooter]=[*shooter_checks,effects(setv(dex_flag,0)),check('dex',f'{label}敏捷',condition=with_condition(member,cmp(count_field,'gt',0)),successEffects=[setv(dex_flag,1)],**actor_kw(member)),route(extra,cmp(dex_flag,'eq',1)),route('$return')]
        P[extra]=[choices(choice(f'{label}以奖励骰进行近距离追加射击',target=shot,id='pointblank'),choice('不追加射击',target='$return',id='skip-pointblank'))]
        P[shot]=[check('firearmsRifleShotgun',f'{label}近距离追加射击（奖励骰）',success='$return',failure='$return',bonus=1,condition=rifle,successEffects=[add('counter.frost366Damage','2D6+4')],**actor_kw(member))]
        src[shooter]=src[extra]=src[shot]=['366:p2']
    frost366.extend([route(399,cmp('counter.frost366Damage','gte',10)),route(367)])
    put(366,frost366,2);blocked.pop('366',None)
    put(367,[random(10,[356,368,356,368,356,368,356,368,356,368])],2)
    put(368,[effects({'op':'party','member':'norman','action':'status','value':'missing'}),check('con','困难体质',365,'frost-368-end',difficulty='hard')],2)
    P['frost-368-end']=[end('远征结束 · 原书第368节')];src['frost-368-end']=['368:p2']
    put(369,[effects(setv('counter.frost369Failures',0)),check('con','纳德尔曼体质',successEffects=[],failureEffects=[add('counter.frost369Failures',1)]),check('con','诺曼体质',target=field('party.norman.attribute.con'),successEffects=[],failureEffects=[add('counter.frost369Failures',1)]),route(361,cmp('counter.frost369Failures','eq',0)),route(367)],2)
    put(370,[route(616)],5)
    put(371,[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(364,cmp('sanity.indefinite','eq',1)),effects(add('hp','-1D10'),condition=cmp('sanity.temporary','eq',1)),route(347,cmp('sanity.temporary','eq',1)),route(400)],2);blocked.pop('371',None)
    put(372,[end('远征结束 · 原书第372节')],4)
    put(373,[effects(add('sanity','1D6')),route(379)],2)
    put(374,[choices(choice('先考虑另一项发现',529),choice('展示大腳怪頭顱並掷幸运',target='frost-374-luck',id='show-head'))],2)
    P['frost-374-luck']=[check('luck','幸运',372,375)];src['frost-374-luck']=['374:p2']
    put(375,[end('远征结束 · 原书第375节')],6)
    # §376 may follow one point-blank/Hard rifle hit that failed the book's
    # damage threshold. Carry that real damage into the 18-HP melee encounter.
    pre376_damage={'calc':'max','values':[field('counter.frost325Damage'),field('counter.frost423Damage')]}
    pre376_hp={'calc':'max','values':[1,{'calc':'difference','values':[18,pre376_damage]}]}
    frost376_roster=['$player','norman']
    frost376_weapons=[]
    for actor_id in frost376_roster:
        suffix='player' if actor_id=='$player' else 'norman'
        frost376_weapons.extend([
            {'id':f'axe-{suffix}','label':'斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'actors':[actor_id]},
            {'id':f'knife-{suffix}','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'actors':[actor_id]},
            {'id':f'fist-{suffix}','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'actors':[actor_id]},
        ])
    frost376={
        'sourceSection':'376','participants':[{'id':'$player'},{'id':'norman','condition':cmp('party.norman.present','eq',1)}],
        'partyTurnOrder':frost376_roster,'enemyTurnOrder':['ape-man'],'initiative':'enemy-first',
        'enemies':[{'id':'ape-man','name':'猿人','hp':pre376_hp,'maxHp':18,'skills':{'fightingBrawl':30},'attackSkill':'fightingBrawl','damage':'2D6','targetOrder':frost376_roster,'damageMode':'party'}],
        'weapons':frost376_weapons,'fatalCompanions':['norman'],'win':'frost-376-roster-check','lose':'frost-376-unmapped-loss',
        'routes':[{'condition':{'all':[cmp('hp','eq',0),cmp('party.norman.present','eq',1),cmp('party.norman.dead','eq',0)]},'target':'191'},{'condition':{'all':[cmp('party.norman.dead','eq',1),{'flag':'majorWound','equals':True}]},'target':'191'},{'condition':cmp('party.norman.dead','eq',1),'target':'341'},{'condition':{'all':[cmp('combat.enemy.0.hp','lte',0),cmp('party.norman.present','eq',1)]},'target':'378'}],
    }
    put(376,[route('frost-376-missing-norman',{'any':[cmp('party.norman.present','eq',0),cmp('party.norman.dead','eq',1),cmp('party.norman.unconscious','eq',1)]}),{'kind':'partyCombat','combat':frost376}],1,2,3);blocked.pop('376',None)
    P['frost-376-roster-check']=[route('frost-376-missing-norman',cmp('party.norman.present','eq',0)),route(378)];src['frost-376-roster-check']=['376:p3']
    P['frost-376-missing-norman']=[{'kind':'end','label':'来源缺口：第376节仅规定纳德尔曼与诺曼参战，但进入时诺曼不在场或已失能；原文未给此队伍状态去向','collect':False}];src['frost-376-missing-norman']=['376:p1','376:p3']
    P['frost-376-unmapped-loss']=[{'kind':'end','label':'来源缺口：第376节未说明纳德尔曼失能而诺曼仍在场时的去向','collect':False}];src['frost-376-unmapped-loss']=['376:p3']
    put(377,[check('luck','幸运',513,67)],2)
    put(378,[choices(choice('尝试急救自己和诺曼',target='frost-378-aid',id='aid'),choice('不急救',379,id='skip'))],2)
    P['frost-378-aid']=[check('firstAid','急救（成功后恢复自己与诺曼）',success=379,failure=379,successEffects=[add('hp','1D3'),{'op':'party','member':'norman','action':'hp','value':'1D3'}])];src['frost-378-aid']=['378:p2']
    put(379,[choices(choice('带走头颅并记录STOCKHOUSE',target='frost-379-keyword',id='take-head'),choice('不带走头颅',513,id='leave-head'))],2)
    P['frost-379-keyword']=[effects({'op':'register','kind':'state','key':'STOCKHOUSE','label':'斯托克豪斯'}),route(513)];src['frost-379-keyword']=['379:p2']
    frost380=[effects(setv('counter.frost380Hits',0))]
    for member,label in [('$player','纳德尔曼'),('norman','诺曼')]:
        for shot in range(1,4):
            frost380.append(check('firearmsRifleShotgun',f'{label}正常射程射击（第{shot}/3枪）',condition=rifle_condition(member),successEffects=[add('counter.frost380Hits',1)],**actor_kw(member)))
    frost380.append(route(381,cmp('counter.frost380Hits','gte',3)))
    frost380.extend([*[effects({'op':'party','member':member,'action':'unconscious','value':True},condition=cmp(f'party.{member}.present','eq',1)) for member in ['charlie','bernard','sylvia','norman']],route(417)])
    put(380,frost380,2);blocked.pop('380',None)
    put(381,[effects(add('sanity','1D6')),route(513)],3)
    put(382,[choices(choice('跳下峭壁跃入湖中',383),choice('继续随俘虏者攀登',386))],2)
    put(383,[check('jump','跳跃',success='frost-383-swim',failure=385)],2)
    P['frost-383-swim']=[check('swim','游泳',384,385)];src['frost-383-swim']=['383:p2']
    put(384,[route(365)],2)
    put(385,[{'kind':'end','label':'阻塞：先受1D8伤害，再重复困难游泳；每次失败再受1D3，存活到岸去397，溺亡结束','collect':False}],2);blocked['385']='Repeated Hard Swim attempts with per-failure damage and drowning state require a loop.'
    put(386,[choices(choice('逃跑',485),choice('相信大腳怪并不怀恶意',488))],2)
    put(387,[check('luck','西尔维娅幸运（角色卡固定65）',401,388,target=65)],2)
    put(388,[route(389)],2)
    put(389,[route(382)],2)
    put(390,[choices(choice('摆出顺从姿态并被带走',350),choice('反抗',391))],2)
    frost391_roster=['$player','charlie','bernard','sylvia','norman']
    frost391_participants=[{'id':'$player'}]+[{'id':member,'condition':{'all':[cmp(f'party.{member}.present','eq',1),cmp(f'party.{member}.awake','eq',1)]}} for member in frost391_roster[1:]]
    frost391_weapons=[
        {'id':'rifle','label':'点射步枪','skill':'firearmsRifleShotgun','damage':'2D6+4','key':'rifle','ammo':'counter.frost391RifleShots','bonus':1,'firearm':True,'damageBonus':True,'condition':cmp('counter.frost391RifleShots','gt',0),'actors':['$player']},
        {'id':'hatchet','label':'短柄斧','skill':'hatchet','damage':'1D6+1','key':'hatchet','damageBonus':True,'actors':frost391_roster},
        {'id':'knife','label':'猎刀','skill':'fightingBrawl','damage':'1D4+2','key':'knife','damageBonus':True,'actors':frost391_roster},
        {'id':'fist','label':'徒手','skill':'fightingBrawl','damage':'1D3','damageBonus':True,'actors':frost391_roster},
    ]
    frost391=[effects(setv('counter.frost391RifleShots',1),setv('counter.frost391DamageTaken',0)),{
        'kind':'partyCombat','combat':{
            'sourceSection':'391','participants':frost391_participants,'partyTurnOrder':frost391_roster,
            'enemyTurnOrder':['sasquatch'],'initiative':'enemy-first',
            'enemies':[{'id':'sasquatch','name':'大脚怪','hp':18,'maxHp':18,'count':2,'skills':{'fightingBrawl':30},'attackSkill':'fightingBrawl','damage':'2D6','targetOrder':frost391_roster}],
            'weapons':frost391_weapons,'win':'392','lose':'frost-391-party-lost',
            'options':[choice('投降',target='frost-391-surrender-sylvia',id='surrender',condition=cmp('party.sylvia.present','eq',1)),choice('投降',target='frost-391-surrender-no-sylvia',id='surrender-no-sylvia',condition=cmp('party.sylvia.present','eq',0))],
            'routes':[{'condition':{'all':[cmp('combat.enemy.0.hp','lte',9),cmp('combat.enemy.1.hp','lte',9)]},'target':'392'}],
        }}]
    put(391,frost391,3)
    for helper,target in [('frost-391-surrender-sylvia',544),('frost-391-surrender-no-sylvia',347)]:
        P[helper]=[route(target)];src[helper]=['391:p3']
    P['frost-391-party-lost']=[route(191,cmp('hp','lte',0)),{'kind':'end','label':'探险结束','collect':False}];src['frost-391-party-lost']=['391:p2','391:p3']
    blocked.pop('391',None)
    put(392,[check('con','体质（感染检定）',343,342,condition=cmp('counter.frost391DamageTaken','gt',0)),route(365)],2);blocked.pop('392',None)
    put(393,[random(10,[394,420,394,420,394,420,394,420,394,420])],2)
    put(394,[route('frost-394-roster-gap',cmp('party.sylvia.dead','eq',1)),effects({'op':'party','member':'sylvia','action':'status','value':'present'},{'op':'party','member':'sylvia','action':'restore'},setv('counter.frost394Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost394Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost394Failures',1)]),check('stealth','西尔维娅潜行',target=field('party.sylvia.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost394Failures',1)]),route(653,cmp('counter.frost394Failures','gt',0)),route(395)],1,2)
    P['frost-394-roster-gap']=[{'kind':'end','label':'来源冲突：第394节明确描写西尔维娅在场，但她此前已被记录为死亡；原文未给复活去向','collect':False}];src['frost-394-roster-gap']=['394:p1','394:p2']
    put(395,[effects({'op':'register','kind':'state','key':'INCHCAPE','label':'印奇凯普'}),choices(choice('探索失落山谷',225),choice('离开山谷回家',291))],2)
    put(396,[choices(choice('带西尔维娅同行',398),choice('留下西尔维娅，诺曼与你潜行',target='frost-396-stealth',id='leave-sylvia'))],4)
    P['frost-396-stealth']=[effects(setv('counter.frost396Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost396Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost396Failures',1)]),route(390,cmp('counter.frost396Failures','gt',0)),route(291)];src['frost-396-stealth']=['396:p4']
    put(397,[choices(choice('尝试急救',target='frost-397-first-aid',id='aid'),choice('不急救',365,id='skip'))],2)
    P['frost-397-first-aid']=[check('firstAid','急救',success=365,failure=365,successEffects=[add('hp','1D3')])];src['frost-397-first-aid']=['397:p2']
    put(398,[effects(setv('counter.frost398Failures',0)),check('stealth','纳德尔曼潜行',failureEffects=[add('counter.frost398Failures',1)]),*[check('stealth',f'{who}潜行',target=15 if who=='sylvia' else field(f'party.{who}.skill.stealth'),condition=cmp(f'party.{who}.awake','eq',1),failureEffects=[add('counter.frost398Failures',1)]) for who in ['charlie','bernard','sylvia','norman']],route(390,cmp('counter.frost398Failures','gt',0)),route(357)],2);blocked.pop('398',None)
    put(399,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(361)],3)
    put(400,[choices(choice('冲过落石',406),choice('开枪试图吓退大腳怪',539),choice('退回山谷，待它们离开后再返回',291))],2)
    # Source-grounded continuation 401-480. Keep party-count, repeated-roll,
    # and combat procedures blocked unless the current DSL can model them exactly.
    put(401,[effects({'op':'party','member':'sylvia','action':'status','value':'present'}),check('luck','幸运',402,403)],3)
    put(402,[route(395)],2)
    put(403,[check('luck','幸运',404,405)],2)
    put(404,[route(324)],3)
    put(405,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'},{'op':'party','member':'norman','action':'status','value':'dead'}),check('luck','幸运',408,407)],6)
    frost406=[effects(setv('counter.frost406PlayerFailed',0),setv('counter.frost406CharlieFailed',0),setv('counter.frost406BernardFailed',0),setv('counter.frost406SylviaFailed',0),setv('counter.frost406NormanFailed',0))]
    for actor,label,key in [('$player','纳德尔曼','Player'),('charlie','查理','Charlie'),('bernard','伯纳德','Bernard'),('sylvia','西尔维娅','Sylvia'),('norman','诺曼','Norman')]:
        fail_counter=f'counter.frost406{key}Failed'
        failure=[setv(fail_counter,1),add('hp','-2D6')] if actor=='$player' else [setv(fail_counter,1),{'op':'party','member':actor,'action':'hp','value':'-2D6'}]
        frost406.append(check('dodge',f'{label}闪避落石',**({'actor':actor} if actor!='$player' else {}),condition=cmp(f'party.{actor}.awake','eq',1) if actor!='$player' else None,successEffects=[setv(fail_counter,0)],failureEffects=failure))
    frost406.extend([route(347,cmp('counter.frost406PlayerFailed','eq',1)),route(491,{'all':[cmp('counter.frost406NormanFailed','eq',1),cmp('counter.frost406SylviaFailed','eq',1)]}),route(278,cmp('counter.frost406SylviaFailed','eq',1)),route(490,cmp('counter.frost406NormanFailed','eq',1)),route(347,{'any':[cmp('counter.frost406CharlieFailed','eq',1),cmp('counter.frost406BernardFailed','eq',1)]}),route(293)])
    put(406,frost406,2);blocked.pop('406',None)
    put(407,[{'kind':'end','label':'阻塞：连续三次困难体质成功才去408；每次失败及其后每次失败造成1D3伤害并可死亡','collect':False}],3);blocked['407']='Three successful Hard CON checks with repeat-until-three-successes, failure damage and death require a sourced loop.'
    put(408,[route(67)],3)
    put(409,[effects({'op':'party','member':'charlie','action':'status','value':'missing'},{'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),choices(choice('徒步回家',158),choice('没有向导也继续探索',604))],3)
    put(410,[check('psychoanalysis','精神分析',492,164)],2)
    put(411,[check('luck','幸运',513,34)],2)
    put(412,[{'kind':'end','label':'阻塞：连续三次游泳成功；首次失败开始每轮组合游泳与体质检定，并按失败体质受1D6溺水伤害直至死亡或上岸','collect':False}],2);blocked['412']='Three successful Swim checks, followed after any failure by repeated combined Swim/CON and per-failed-CON drowning damage, need loop and survival state.'
    put(413,[effects(add('luck','1D10')),random(10,[470,77,470,77,470,77,470,77,470,77])],2)
    put(414,[random(10,[515,518,515,518,515,518,515,518,515,518])],2)
    put(415,[choices(choice('尝试急救',target='frost-415-aid',condition=cmp('hp','lt',field('maxHp')),id='aid'),choice('不急救或未受溺水伤害',67,id='skip'))],2)
    P['frost-415-aid']=[check('firstAid','急救',success=67,failure=67,successEffects=[add('hp','1D3')])];src['frost-415-aid']=['415:p2']
    put(416,[choices(choice('追赶逃跑者',196),choice('逃离此地',131))],2)
    put(417,[end('远征结束 · 原书第417节')],6)
    put(418,[route(33)],2)
    put(419,[choices(choice('开枪',423),choice('让生物离开',513))],2)
    put(420,[choices(choice('放弃搜寻',421),choice('潜行搜寻',target='frost-420-stealth',id='search'))],2)
    P['frost-420-stealth']=[check('stealth','潜行',422,390)];src['frost-420-stealth']=['420:p2']
    put(421,[effects(setv('counter.frost421Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost421Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost421Failures',1)]),route(528,cmp('counter.frost421Failures','eq',0)),route(390)],2)
    put(422,[random(10,[396,394,396,394,396,394,396,394,396,394])],2)
    put(423,[{'kind':'end','label':'阻塞：点射攻击必须同时命中且造成至少9点伤害才去373，否则376','collect':False}],2);blocked['423']='Point-blank rifle attack must route on damage dealt >=9, not only hit/miss.'
    put(424,[choices(choice('继续前进',89),choice('折返',158))],2)
    put(425,[{'kind':'end','label':'阻塞：按仍存活/失踪的学生人数分别去602、600、604或598','collect':False}],2);blocked['425']='Destination depends on exact surviving/lost roster composition.'
    put(426,[route(485)],3)
    put(427,[check('scienceGeology','科学（地质学）',428,513)],2)
    put(428,[effects({'op':'register','kind':'state','key':'CHARCOAL','label':'木炭'}),route(513)],3)
    put(429,[effects(flag('RESONATE',False),flag('CHARCOAL',False)),route(529)],3)
    put(430,[route(83,{'any':[cmp(f'party.{who}.present','eq',0) for who in ['bernard','sylvia','norman']]}),route(33)],2);blocked.pop('430',None)
    put(431,[choices(choice('先考虑另一项发现',529),choice('公布发现',target='frost-431-backwater',id='announce'))],2)
    P['frost-431-backwater']=[route(274,{'flag':'BACKWATER','equals':True}),route(432,{'flag':'BACKWATER','equals':False})];src['frost-431-backwater']=['431:p2']
    put(432,[end('远征结束 · 原书第432节')],3)
    put(433,[{'kind':'end','label':'阻塞：按失踪或确认死亡人数×15计算责任分，再掷1D100并与责任分比较','collect':False}],2);blocked['433']='Liability score depends on recorded lost/dead party count and must be computed before D100 comparison.'
    put(434,[effects({'op':'register','kind':'state','key':'TANGENT','label':'切线'}),choices(choice('调查异象',435),choice('忽略；若赤脚去458，否则继续',target='frost-434-barefoot',id='ignore'))],3)
    P['frost-434-barefoot']=[route(458,{'flag':'BAREFOOT','equals':True}),route(20,{'flag':'BAREFOOT','equals':False})];src['frost-434-barefoot']=['434:p3']
    put(435,[check('luck','幸运',448,436)],4)
    put(436,[check('sanity','理智',successEffects=[add('sanity','-1')],failureEffects=[add('sanity','-1D3')]),choices(choice('丢下查理逃走',437),choice('留下帮助查理',443))],3)
    put(437,[route(438,{'any':[cmp('party.bernard.present','eq',0),cmp('party.bernard.awake','eq',0)]}),check('pow','伯纳德困难意志',442,438,difficulty='extreme',actor='bernard',target=field('party.bernard.attribute.pow'))],2)
    put(438,[route(439,{'any':[cmp('party.sylvia.present','eq',0),cmp('party.sylvia.awake','eq',0)]}),check('pow','西尔维娅困难意志',442,439,difficulty='hard',actor='sylvia',target=field('party.sylvia.attribute.pow'))],2)
    put(439,[route(440,{'any':[cmp('party.norman.present','eq',0),cmp('party.norman.awake','eq',0)]}),check('pow','诺曼意志',442,440,actor='norman',target=field('party.norman.attribute.pow'))],2)
    put(440,[check('pow','纳德尔曼意志（奖励骰）',442,441,bonus=1)],2)
    put(441,[end('远征结束 · 原书第441节')],3)
    put(442,[{'kind':'end','label':'阻塞：按学生失踪/死亡数量分别去158、324、279或67','collect':False}],2);blocked['442']='Destination depends on exact student roster losses, including missing versus confirmed dead.'
    put(443,[check('sanity','理智',444,444,failureEffects=[add('sanity','-1D6')])],3)
    put(444,[choices(choice('尝试与实体沟通',445),choice('逃离',437))],2)
    put(445,[check('pow','力量（惩罚骰）',447,446,penalty=1)],3)
    frost446=[effects(setv('counter.frost446CharlieHp',0),*[setv(f'counter.frost446{member.title()}PsychSuccess',0) for member in ['player','charlie','bernard','sylvia','norman']])]
    for member,label in [('$player','纳德尔曼'),('charlie','查理'),('bernard','伯纳德'),('sylvia','西尔维娅'),('norman','诺曼')]:
        key='player' if member=='$player' else member
        conditions=None if member=='$player' else cmp(f'party.{member}.awake','eq',1)
        frost446.append(check('psychology',f'{label}心理学',**({'actor':member} if member!='$player' else {}),condition=conditions,successEffects=[setv(f'counter.frost446{key.title()}PsychSuccess',1)]))
    for member,label in [('$player','纳德尔曼'),('charlie','查理'),('bernard','伯纳德'),('sylvia','西尔维娅'),('norman','诺曼')]:
        key='player' if member=='$player' else member
        helper=f'frost-446-shot-choice-{key}'
        shot=f'frost-446-shot-{key}'
        pcondition=cmp('counter.frost446PlayerPsychSuccess','eq',1) if member=='$player' else {'all':[cmp(f'party.{member}.present','eq',1),cmp(f'party.{member}.awake','eq',1),cmp(f'counter.frost446{key.title()}PsychSuccess','eq',1)]}
        icount='inventory.rifle.count' if member=='$player' else f'party.{member}.inventory.rifle.count'
        frost446.append(call(helper,{'all':[pcondition,cmp(icount,'gt',0)]}))
        P[helper]=[choices(choice(f'{label}以奖励骰进行近距离步枪射击',target=shot,id='shoot'),choice('不追加射击',target='$return',id='skip'))]
        P[shot]=[check('firearmsRifleShotgun',f'{label}近距离步枪射击（奖励骰）',actor=member if member!='$player' else None,success='$return',failure='$return',bonus=1,successEffects=[add('counter.frost446CharlieHp','2D6+4')])]
        if member=='$player': P[shot][0]['check'].pop('actor',None)
        src[helper]=src[shot]=['446:p2','446:p3']
    frost446.extend([route('frost-446-destroyed',cmp('counter.frost446CharlieHp','gte',28)),route('frost-446-fight')])
    put(446,frost446,1,2,3,4);blocked.pop('446',None)
    P['frost-446-destroyed']=[effects({'op':'party','member':'charlie','action':'status','value':'dead'}),route(442)];src['frost-446-destroyed']=['446:p4']
    frost446_weapons=[]
    for actor_id in ['$player','bernard','sylvia','norman']:
        for wid,label,damage,key,bonus in [('rifle','步枪','2D6+4','rifle',False),('hatchet','短柄斧','1D6+1','hatchet',True),('knife','猎刀','1D4+2','knife',True),('fist','徒手','1D3',None,True)]:
            weapon={'id':f'{wid}-{actor_id.replace("$","player")}-446','label':label,'skill':'firearmsRifleShotgun' if wid=='rifle' else 'hatchet' if wid=='hatchet' else 'fightingBrawl','damage':damage,'actors':[actor_id]}
            if key: weapon['key']=key
            if bonus: weapon['damageBonus']=True
            if wid=='rifle': weapon['firearm']=True
            frost446_weapons.append(weapon)
    P['frost-446-fight']=[{'kind':'partyCombat','combat':{'sourceSection':'446','participants':[{'id':'$player'},{'id':'bernard','condition':cmp('party.bernard.awake','eq',1)},{'id':'sylvia','condition':cmp('party.sylvia.awake','eq',1)},{'id':'norman','condition':cmp('party.norman.awake','eq',1)}],'partyTurnOrder':['$player','bernard','sylvia','norman'],'enemyTurnOrder':['charlie'],'initiative':'party-first','enemies':[{'id':'charlie','name':'附身的查理','hp':{'calc':'max','values':[1,{'calc':'difference','values':[28,field('counter.frost446CharlieHp')]}]},'maxHp':28,'skills':{'fightingBrawl':35},'attackSkill':'fightingBrawl','damage':'2D6+1','targetOrder':['bernard','$player'],'damageMode':'target'}],'weapons':frost446_weapons,'win':'frost-446-destroyed','lose':'191'}}];src['frost-446-fight']=['446:p2','446:p3','446:p4']
    put(447,[choices(choice('赶紧离开巨石遗迹',442),choice('说出护身词进入轮形神庙',450))],3)
    put(448,[choices(choice('留下队伍进入建筑',449),choice('原路返回并掷幸运',target='frost-448-luck',id='return'))],4)
    P['frost-448-luck']=[check('luck','幸运',457,554)];src['frost-448-luck']=['448:p4']
    put(449,[effects(setv('counter.frost449Failures',0)),check('sanity','理智',failureEffects=[add('sanity','-1D6')]),check('pow','意志',failureEffects=[add('attribute.pow','-1D3')]),route(450)],3)
    put(450,[effects(add('skill.cthulhuMythos',5)),choices(choice('离开神庙返回队伍',532),choice('继续学习',target='frost-450-stay',id='stay'))],4)
    P['frost-450-stay']=[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),check('pow','意志（惩罚骰）',failureEffects=[add('attribute.pow','-1D3')],penalty=1),route(451)];src['frost-450-stay']=['450:p4']
    put(451,[effects(add('skill.cthulhuMythos',6)),choices(choice('离开神庙返回队伍',532),choice('继续学习',target='frost-451-stay',id='stay'))],3)
    P['frost-451-stay']=[effects(setv('counter.frost451Failures',0)),check('sanity','理智',failureEffects=[add('sanity','-1D6'),add('counter.frost451Failures',1)]),check('pow','困难意志',difficulty='hard',failureEffects=[add('attribute.pow','-1D3'),add('counter.frost451Failures',1)]),route(456,cmp('counter.frost451Failures','eq',2)),route(452)];src['frost-451-stay']=['451:p3']
    put(452,[effects(add('skill.cthulhuMythos',7)),choices(choice('离开神庙返回队伍',532),choice('继续学习',target='frost-452-stay',id='stay'))],3)
    P['frost-452-stay']=[effects(setv('counter.frost452Failures',0)),check('sanity','理智',failureEffects=[add('sanity','-1D6'),add('counter.frost452Failures',1)]),check('pow','极难意志',difficulty='extreme',failureEffects=[add('attribute.pow','-1D3'),add('counter.frost452Failures',1)]),route(455,cmp('counter.frost452Failures','eq',2)),route(453)];src['frost-452-stay']=['452:p3']
    put(453,[effects(add('skill.cthulhuMythos',10)),check('pow','意志（记录成功等级）',record={'roll':'frost453roll','grade':'frost453grade','success':'frost453success','target':'frost453target'}),route(532,cmp('counter.frost453grade','gte',3)),route(456,cmp('counter.frost453grade','eq',2)),route(455,cmp('counter.frost453grade','eq',1)),route(454)],4)
    put(454,[end('远征结束 · 原书第454节')],2)
    put(455,[effects(*[{'op':'party','member':member,'action':'status','value':'missing'} for member in ['bernard','sylvia','norman']]),route(264)],3)
    put(456,[effects(add('hp','-1D6')),{'kind':'end','label':'阻塞：按队伍当前人数仍为5去547，否则去437','collect':False}],4);blocked['456']='Destination depends on current party member count after 1D6 damage.'
    party_five={'all':[cmp(f'party.{mid}.present','eq',1) for mid in ['charlie','bernard','sylvia','norman']]}
    put(457,[route(556,party_five),route(513,{'not':party_five})],2)
    put(458,[check('persuade','说服',459,460)],2)
    put(459,[choices(choice('乘独木舟顺流而下',32),choice('深入汉尼纳地区',20))],2)
    put(460,[route(51)],2)
    put(461,[route(95)],4)
    put(462,[choices(choice('追查怪物',69),choice('离开闹鬼森林',463))],2)
    put(463,[check('listen','聆听',464,467)],2)
    put(464,[effects(setv('counter.frost464BernardSTR',110)),check('str','借助诺曼协助，以奖励骰对抗伯纳德力量110',success=465,failure='frost-464-sylvia-injury',opposed=field('counter.frost464BernardSTR'),bonus=1,failureEffects=[{'op':'party','member':'sylvia','action':'hp','value':'-1D6'}])],4)
    P['frost-464-sylvia-injury']=[route(464,cmp('party.sylvia.hp','gt',0)),route(466)];src['frost-464-sylvia-injury']=['464:p4'];blocked.pop('464',None)
    put(465,[choices(choice('尝试急救西尔维娅',target='frost-465-aid',id='aid'),choice('不急救',324,id='skip'))],4)
    P['frost-465-aid']=[check('firstAid','急救',success=324,successEffects=[{'op':'party','member':'sylvia','action':'hp','value':'1D3'}],failure=324)];src['frost-465-aid']=['465:p4']
    put(466,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'},{'op':'party','member':'bernard','action':'status','value':'dead'}),route(279)],5)
    put(467,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'},{'op':'party','member':'bernard','action':'status','value':'dead'}),route(279)],5)
    put(468,[effects(add('skill.cthulhuMythos',2)),route(143)],3)
    put(469,[route('frost-469-roster-gap',{'any':[cmp('party.sylvia.dead','eq',1),cmp('party.norman.dead','eq',1)]}),effects({'op':'party','member':'sylvia','action':'status','value':'present'},{'op':'party','member':'sylvia','action':'restore'},{'op':'party','member':'norman','action':'status','value':'present'},{'op':'party','member':'norman','action':'restore'}),check('str','西尔维娅力量对抗诺曼体型',322,319,target=field('party.sylvia.attribute.str'),opposed=field('party.norman.attribute.siz'))],6)
    P['frost-469-roster-gap']=[{'kind':'end','label':'来源冲突：第469节明确描写的同行此前已被记为死亡；原文未给复活去向','collect':False}];src['frost-469-roster-gap']=['469:p5','469:p6']
    put(470,[route(471,{'flag':'INCHCAPE','equals':True}),route(82,{'flag':'INCHCAPE','equals':False})],2)
    put(471,[choices(choice('继续步行',197),choice('乘独木舟闯过急流并掷驾驶船只',target='frost-471-boat',id='canoe'))],4)
    P['frost-471-boat']=[check('pilotBoat','驾驶（船）',472,412)];src['frost-471-boat']=['471:p4']
    put(472,[route(513)],2)
    put(473,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'},{'op':'party','member':'norman','action':'status','value':'missing'}),route(67)],3)
    put(474,[effects(setv('counter.frost474Failures',0)),check('sanity','纳德尔曼理智',successEffects=[],failureEffects=[add('sanity','-1D6'),add('counter.frost474Failures',1)]),check('sanity','诺曼理智',target=field('party.norman.sanity'),successEffects=[],failureEffects=[add('party.norman.sanity','-1D6'),add('counter.frost474Failures',1)]),route(475,cmp('counter.frost474Failures','gt',0)),route(477)],2)
    put(475,[effects(add('skill.cthulhuMythos',1)),choices(choice('逃跑',476),choice('开枪与恐怖生物交战',380))],2)
    put(476,[effects(setv('counter.frost476PlayerSuccess',0),setv('counter.frost476NormanSuccess',0)),check('dodge','纳德尔曼闪避',successEffects=[setv('counter.frost476PlayerSuccess',1)]),check('dodge','诺曼闪避',actor='norman',successEffects=[setv('counter.frost476NormanSuccess',1)]),route(513,{'all':[cmp('counter.frost476PlayerSuccess','eq',1),cmp('counter.frost476NormanSuccess','eq',1)]}),route(332,{'all':[cmp('counter.frost476PlayerSuccess','eq',0),cmp('counter.frost476NormanSuccess','eq',1)]}),route(332,{'all':[cmp('counter.frost476PlayerSuccess','eq',0),cmp('counter.frost476NormanSuccess','eq',0)]}),route(336,{'all':[cmp('counter.frost476PlayerSuccess','eq',1),cmp('counter.frost476NormanSuccess','eq',0)]})],2);blocked.pop('476',None)
    put(477,[effects(add('skill.cthulhuMythos',2)),choices(choice('友好地向它们打招呼',478),choice('潜行离开',480),choice('开枪',479))],2)
    put(478,[effects(add('skill.cthulhuMythos',1)),choices(choice('信任人类学训练并现身',332),choice('逃跑',476),choice('改为开火',380))],2)
    frost479=[effects(setv('counter.frost479Hits',1),add('skill.cthulhuMythos',1))]
    for shot,member in enumerate(['$player','norman','$player','norman'],1):
        attack=check('firearmsRifleShotgun',f'{"纳德尔曼" if member=="$player" else "诺曼"}步枪射击（第{shot}/4枪）',condition=rifle_condition(member),successEffects=[add('counter.frost479Hits',1)],**actor_kw(member))
        frost479.extend([attack,route(381,cmp('counter.frost479Hits','gte',2))])
    frost479.append(route(380))
    put(479,frost479,4);blocked.pop('479',None)
    put(480,[effects(setv('counter.frost480Failures',0)),check('stealth','纳德尔曼潜行',successEffects=[],failureEffects=[add('counter.frost480Failures',1)]),check('stealth','诺曼潜行',target=field('party.norman.skill.stealth'),successEffects=[],failureEffects=[add('counter.frost480Failures',1)]),route(513,cmp('counter.frost480Failures','eq',0)),route(476)],2)
    # Source-grounded continuation 481-560.
    put(481,[route(192)],2)
    put(482,[effects({'op':'party','member':'norman','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'dead'}),route(491)],3)
    put(483,[choices(choice('循踪追查',484),choice('不理会，离开山谷',278),choice('不理会，继续深入山谷',38))],3)
    put(484,[check('track','追踪',276,277)],2)
    put(485,[check('con','体质',336,'frost-485-grip')],2)
    P['frost-485-grip']=[random(10,[486,487,486,487,486,487,486,487,486,487])];src['frost-485-grip']=['485:p2']
    put(486,[effects(add('hp','-1D6')),route(489)],2)
    put(487,[effects(add('skill.cthulhuMythos',1)),route(510)],3)
    put(488,[random(6,[487,487,487,487,489,489])],2)
    put(489,[route(67)],2)
    put(490,[effects({'op':'party','member':'norman','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'dead'}),route(491)],3)
    put(491,[route(67)],2)
    put(492,[random(10,[11,10,11,10,11,10,11,10,11,10])],3)
    put(493,[check('luck','幸运',419,325)],2)
    put(494,[check('stealth','潜行',111,495)],3)
    put(495,[route(116)],2)
    put(496,[check('sanity','理智',426,426,failureEffects=[add('sanity','-1D6')])],3)
    put(497,[choices(choice('调查石轮传闻',434),choice('返回独木舟',20))],4)
    put(498,[effects({'op':'party','member':'charlie','action':'status','value':'missing'},{'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),choices(choice('继续调查灰人',84),choice('弃置调查，徒步前进',89),choice('回家',158))],5)
    put(499,[choices(choice('劝查理留下',30),choice('依她的意愿埋葬死者并乘船返回',165))],4)
    put(500,[random(10,[357,395,357,395,357,395,357,395,357,395])],2)
    put(501,[check('listen','聆听',502,506)],2)
    put(502,[check('sanity','理智',503,503,failureEffects=[add('sanity','-1D6')])],2)
    put(503,[effects(add('skill.cthulhuMythos',3)),check('sanity','理智',504,504,failureEffects=[add('sanity','-1D6')])],6)
    put(504,[check('stealth','潜行',505,506)],2)
    put(505,[route(161)],3)
    put(506,[check('sanity','理智',507,507,failureEffects=[add('sanity','-1D6')])],2)
    put(507,[effects(add('skill.cthulhuMythos',1)),choices(choice('持有步枪，向异形射击',508,condition=cmp('inventory.rifle.count','gt',0)),choice('没有步枪，或保持安静不动',414))],4)
    put(508,[{'kind':'end','label':'阻塞：步枪攻击必须按命中且伤害至少12判断509；较低伤害去510','collect':False}],2);blocked['508']='Rifle check must branch on hit and damage >=12.'
    put(509,[effects(add('sanity','1D6')),route(513)],2)
    put(510,[random(10,[336,511,336,511,336,511,336,511,336,511])],2)
    put(511,[check('dodge','闪避',512,332)],2)
    put(512,[{'kind':'end','label':'阻塞：连续三次游泳成功；失败后重复游泳与体质并按体质失败造成溺水伤害，存活上岸后可急救','collect':False}],2);blocked['512']='Repeated Swim/CON drowning loop with three successes and per-failure damage.'
    # The source at §594 names only roster configurations with downstream
    # text that can accept them. A short-trip option must be hidden for other
    # rosters instead of sending a player into a mismatched companion script.
    def exact_roster(present):
        return {'all':[cmp(f'party.{mid}.present','eq',1 if mid in present else 0) for mid in ['charlie','bernard','sylvia','norman']]}
    trip_rosters=[exact_roster({'charlie','bernard','sylvia','norman'}),exact_roster({'bernard','sylvia','norman'}),exact_roster({'charlie','norman','sylvia'}),exact_roster({'norman','sylvia'}),exact_roster({'norman'}),exact_roster(set())]
    short_trip_condition={'any':trip_rosters}
    party_two_students={'any':[{'all':[cmp(f'party.{a}.present','eq',1),cmp(f'party.{b}.present','eq',1)]} for a,b in [('charlie','bernard'),('charlie','sylvia'),('charlie','norman'),('bernard','sylvia'),('bernard','norman'),('sylvia','norman')]]}
    one_student_with_charlie={'all':[cmp('party.charlie.present','eq',1),{'any':[{'all':[cmp(f'party.{student}.present','eq',1),*[cmp(f'party.{other}.present','eq',0) for other in ['bernard','sylvia','norman'] if other!=student]]} for student in ['bernard','sylvia','norman']]}]}
    wild_return_condition={'all':[party_two_students,{'not':one_student_with_charlie}]}
    put(513,[choices(choice('返回麦克唐纳堡结束探险',593),choice('进行短途探索',594,condition=short_trip_condition),choice('队伍至少三人时重返荒野',425,condition=wild_return_condition))],2)
    put(514,[{'kind':'end','label':'阻塞：连续三次游泳成功；失败后进入重复溺水检定与伤害，直至存活上岸或溺亡','collect':False}],2);blocked['514']='Repeated Swim/CON drowning loop and death state.'
    put(515,[choices(choice('持有武器并开枪',517),choice('逃跑',330))],3)
    put(516,[random(10,[332,511,332,511,332,511,332,511,332,511])],2)
    put(517,[{'kind':'end','label':'阻塞：先掷1D4+1确定所需命中数；每次射击后体质检定的奖励/惩罚骰随累计轮数变化，失败昏迷，达到命中数则513','collect':False}],2);blocked['517']='Attack sequence needs a persisted hit target and per-shot changing CON dice modifiers.'
    put(518,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'}),route(513)],2)
    put(519,[effects(add('hp','-2D6')),route(347)],2)
    put(520,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),route(278)],3)
    put(521,[choices(choice('普通说服检定',target='frost-521-persuade',id='persuade'),choice('困难精神分析检定',target='frost-521-psychoanalysis',id='psychoanalysis'))],2)
    P['frost-521-persuade']=[check('persuade','说服',522,123)];src['frost-521-persuade']=['521:p2']
    P['frost-521-psychoanalysis']=[check('psychoanalysis','困难精神分析',522,123,difficulty='hard')];src['frost-521-psychoanalysis']=['521:p2']
    put(522,[check('track','查理的困难追踪',525,523,target=field('party.charlie.skill.track'),difficulty='hard')],2)
    put(523,[choices(choice('派查理回营地，自己继续追踪',524),choice('接受伯纳德失踪并结束搜索',32))],2)
    put(524,[effects({'op':'party','member':'charlie','action':'status','value':'missing'},{'op':'register','kind':'state','key':'BAREFOOT','label':'赤脚'}),route(95)],3)
    put(525,[effects({'op':'party','member':'bernard','action':'status','value':'missing'}),check('psychoanalysis','困难精神分析',526,123,difficulty='hard')],6)
    put(526,[choices(choice('留在附近繼續調查',527),choice('放弃探险',32))],2)
    put(527,[route(62)],3)
    put(528,[choices(choice('探索失落山谷',38),choice('离开山谷',278))],2)
    put(529,[choices(choice('公布木炭或共鸣地图发现',545,condition={'any':[{'flag':'CHARCOAL','equals':True},{'flag':'RESONATE','equals':True}]}),choice('公布失落山谷发现',431,condition={'flag':'INCHCAPE','equals':True}),choice('没有相关发现',430,condition={'all':[{'flag':'CHARCOAL','equals':False},{'flag':'RESONATE','equals':False},{'flag':'INCHCAPE','equals':False}]}))],2)
    put(530,[route(529)],2)
    put(531,[route(538)],2)
    put(532,[route(458,{'all':[{'flag':'BAREFOOT','equals':True},party_five]}),route(424,{'all':[{'flag':'BAREFOOT','equals':True},{'not':party_five}]}),route(20,{'all':[{'flag':'BAREFOOT','equals':False},party_five]}),route(163,{'all':[{'flag':'BAREFOOT','equals':False},{'not':party_five}]})],2)
    put(533,[{'kind':'end','label':'阻塞：可分别对自己及西尔维娅进行急救；每次成功恢复对应角色1D3 HP，再去324','collect':False}],3);blocked['533']='Independent optional First Aid checks and per-target healing.'
    put(534,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),choices(choice('继续前进',535),choice('返家',279))],4)
    put(535,[effects({'op':'register','kind':'state','key':'INCHCAPE','label':'印奇凯普'}),route(63)],3)
    put(536,[{'kind':'end','label':'阻塞：连续三次游泳成功；任一次失败进入每轮游泳与体质检定，体质失败受1D6溺水伤害，存活后537','collect':False}],2);blocked['536']='Repeated Swim/CON drowning loop and per-failure damage.'
    put(537,[{'kind':'end','label':'阻塞：调查员或诺曼可尝试急救；成功恢复上一节所失1D3 HP，之后去534','collect':False}],2);blocked['537']='Optional healer selection and last-entry HP cap need source-aware actor recovery.'
    put(538,[end('远征结束 · 原书第538节')],5)
    put(539,[random(6,[481,481,519,519,57,57])],2)
    put(540,[choices(choice('留在岸上',542),choice('跳入水中（力量与游泳均成功）',target='frost-540-rescue',id='rescue'))],2)
    P['frost-540-rescue']=[check('str','力量',success='frost-540-swim',failure=189)];src['frost-540-rescue']=['540:p2']
    P['frost-540-swim']=[check('swim','游泳',541,189)];src['frost-540-swim']=['540:p2']
    put(541,[route(54)],2)
    put(542,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),route(278)],3)
    put(543,[route(513)],3)
    put(544,[check('firstAid','急救全队',success=389,failure=389,successEffects=[add('hp','1D3'),{'op':'party','member':'norman','action':'hp','value':'1D3'},{'op':'party','member':'sylvia','action':'hp','value':'1D3'}])],2);blocked.pop('544',None)
    put(545,[choices(choice('先考虑另一项发现',529),choice('按共鸣地图寻宝',546,condition={'flag':'RESONATE','equals':True}),choice('依CHARCOAL地图导航',target='frost-545-navigate',condition={'all':[{'flag':'CHARCOAL','equals':True},{'flag':'RESONATE','equals':False}]}))],2)
    P['frost-545-navigate']=[check('navigate','导航',183,429)];src['frost-545-navigate']=['545:p2']
    put(546,[check('luck','幸运',183,429)],2)
    put(547,[route(437)],2)
    put(548,[end('远征结束 · 原书第548节')],3)
    put(549,[end('远征结束 · 原书第549节')],4)
    put(550,[random(6,[548,548,548,548,215,215])],2)
    put(551,[random(10,[273,483,273,483,273,483,273,483,273,483])],2)
    put(552,[route(462,{'flag':'TANGENT','equals':True}),route(553,{'flag':'TANGENT','equals':False})],2)
    put(553,[effects({'op':'register','kind':'state','key':'TANGENT','label':'切线'}),route(448)],3)
    put(554,[route(436,party_five),route(555,{'not':party_five})],2)
    put(555,[route(437)],3)
    put(556,[route(458,{'flag':'BAREFOOT','equals':True}),route(20,{'flag':'BAREFOOT','equals':False})],2)
    put(557,[check('track','追踪',558,569)],2)
    put(558,[choices(choice('跟踪前行',559),choice('避开旅人',572))],2)
    put(559,[choices(choice('站出来向楚蒂纳人问候',560),choice('藏身观察并掷潜行',target='frost-559-stealth',id='hide'))],3)
    P['frost-559-stealth']=[check('stealth','潜行',576,573)];src['frost-559-stealth']=['559:p3']
    put(560,[choices(choice('示意和平并留下',561),choice('逃跑',574))],2)
    # Final numbered source entries. Every unsupported repeat/combat/state
    # mechanic remains visibly blocked; no extracted relation edge becomes a choice.
    disarm=[]
    for who in party:
        for key,label in [('rifle','步枪'),('knife','猎刀')]:
            disarm.append({'op':'item-count','key':key,'label':label,'action':'set','member':who,'value':0})
    P['frost-561-disarm']=[effects(*disarm),route(562)];src['frost-561-disarm']=['561:p1','561:p4']
    put(561,[route('frost-561-disarm')],4)
    put(562,[random(10,[566,571,566,571,566,571,566,571,566,571])],4)
    put(563,[effects(add('hp','-1'),{'op':'party','member':'sylvia','action':'status','value':'missing'},{'op':'party','member':'norman','action':'restore'}),choices(choice('用力量挣脱（困难力量）',target='frost-563-player-first-str',id='first-str'),choice('用敏捷挣脱（困难敏捷）',target='frost-563-player-first-dex',id='first-dex'))],1,2,3,5)
    def escape_attempt(node,who,attribute,success,failure):
        skill=attribute.lower(); label=('纳德尔曼' if who=='player' else '诺曼')+('困难力量' if skill=='str' else '困难敏捷')
        target=success
        program=check(skill,label,success=target,failure=failure,difficulty='hard',**({'actor':'norman'} if who=='norman' else {}))
        P[node]=[program];src[node]=['563:p5']
    escape_attempt('frost-563-player-first-str','player','str',564,'frost-563-norman-first-choice')
    escape_attempt('frost-563-player-first-dex','player','dex',564,'frost-563-norman-first-choice')
    P['frost-563-norman-first-choice']=[choices(choice('由诺曼用力量尝试（困难力量）',target='frost-563-norman-first-str',id='norman-first-str'),choice('由诺曼用敏捷尝试（困难敏捷）',target='frost-563-norman-first-dex',id='norman-first-dex'))];src['frost-563-norman-first-choice']=['563:p5']
    escape_attempt('frost-563-norman-first-str','norman','str',564,'frost-563-player-second-choice')
    escape_attempt('frost-563-norman-first-dex','norman','dex',564,'frost-563-player-second-choice')
    P['frost-563-player-second-choice']=[choices(choice('再次用力量尝试（困难力量）',target='frost-563-player-second-str',id='second-str'),choice('再次用敏捷尝试（困难敏捷）',target='frost-563-player-second-dex',id='second-dex'))];src['frost-563-player-second-choice']=['563:p5']
    escape_attempt('frost-563-player-second-str','player','str',565,'frost-563-norman-second-choice')
    escape_attempt('frost-563-player-second-dex','player','dex',565,'frost-563-norman-second-choice')
    P['frost-563-norman-second-choice']=[choices(choice('诺曼再次用力量尝试（困难力量）',target='frost-563-norman-second-str',id='norman-second-str'),choice('诺曼再次用敏捷尝试（困难敏捷）',target='frost-563-norman-second-dex',id='norman-second-dex'))];src['frost-563-norman-second-choice']=['563:p5']
    escape_attempt('frost-563-norman-second-str','norman','str',565,258)
    escape_attempt('frost-563-norman-second-dex','norman','dex',565,258)
    blocked.pop('563',None)
    put(564,[effects({'op':'party','member':'sylvia','action':'status','value':'present'}),choices(choice('继续探索',600),choice('撤回文明世界',513))],4)
    put(565,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'}),choices(choice('循踪追查西尔维娅',128),choice('放弃寻找',279))],4)
    P['frost-566-sylvia']=[check('dex','西尔维娅极难敏捷',actor='sylvia',condition={'all':[cmp('party.sylvia.present','eq',1),cmp('party.sylvia.awake','eq',1)]},successEffects=[add('counter.frost566Successes',1)]),route('$return')];src['frost-566-sylvia']=['566:p3']
    P['frost-566-norman']=[check('dex','诺曼极难敏捷',actor='norman',condition={'all':[cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1)]},successEffects=[add('counter.frost566Successes',1)]),call('frost-566-sylvia'),route('$return')];src['frost-566-norman']=['566:p3']
    put(566,[effects(setv('counter.frost566Successes',0)),check('dex','纳德尔曼极难敏捷',successEffects=[add('counter.frost566Successes',1)],difficulty='extreme'),call('frost-566-norman'),route(567,cmp('counter.frost566Successes','gt',0)),route(568)],3)
    put(567,[choices(choice('继续探索',600),choice('回家',513))],2)
    put(568,[route(210)],5)
    put(569,[check('listen','聆听',581,570)],2)
    put(570,[route(562)],5)
    put(571,[route(566,{'flag':'INCHCAPE','equals':True}),route(563,{'flag':'INCHCAPE','equals':False})],2)
    put(572,[check('luck','幸运',513,569)],2)
    put(573,[route(561)],2)
    put(574,[check('con','队伍中体质最低者',147,575,target={'calc':'min','values':[field('attribute.con'),field('party.norman.attribute.con'),field('party.sylvia.attribute.con')]})],2)
    put(575,[route(561)],2)
    put(576,[choices(choice('喊住猎人',560),choice('等他们走远再接近女孩',577))],3)
    put(577,[choices(choice('割开绳索，带女孩离开',578),choice('让她留在原处',513))],5)
    put(578,[random(10,[580,579,580,579,580,579,580,579,580,579])],2)
    put(579,[choices(choice('陪她去麦克唐纳堡',593),choice('继续探索，她会自行前往堡垒',600))],3)
    put(580,[route(513)],4)
    put(581,[choices(choice('走出掩体与猎人打招呼',560),choice('留在隐蔽处，按队伍潜行最低者检定',target='frost-581-stealth',id='hide'))],2)
    P['frost-581-stealth']=least_stealth_checks(582,584);src['frost-581-stealth']=['581:p2'];blocked.pop('581',None)
    put(582,[choices(choice('暗中跟随猎人',586),choice('折返查看他们来处',583))],2)
    put(583,[route(577)],3)
    put(584,[choices(choice('和平现身',561),choice('逃跑',585),choice('仍有步枪时展示武器',590,condition={'any':[cmp('inventory.rifle.count','gt',0),cmp('party.charlie.inventory.rifle.count','gt',0),cmp('party.bernard.inventory.rifle.count','gt',0),cmp('party.sylvia.inventory.rifle.count','gt',0),cmp('party.norman.inventory.rifle.count','gt',0)]}))],2)
    put(585,[check('luck','幸运',147,575)],2)
    put(586,least_stealth_checks(587,570),2);blocked.pop('586',None)
    put(587,[choices(choice('接近猎人',588),choice('放弃',513))],3)
    put(588,[check('anthropology','人类学',589,560)],2)
    put(589,[choices(choice('交出步枪并让他们带路',target='frost-589-trade',id='trade'),choice('谢绝，继续前行',513,id='decline'))],3)
    P['frost-589-trade']=[effects({'op':'item-count','key':'rifle','label':'步枪','action':'add','member':'$player','value':-1}),route(433)];src['frost-589-trade']=['589:p2','589:p3']
    put(590,[random(6,[591,591,591,591,592,592])],2)
    put(591,[{'kind':'rollEffects','label':'掷出并保存猎人枪手人数1D6+2','effects':[setv('counter.frost591HunterCount','1D6+2')]},{'kind':'partyCombat','combat':{'sourceSection':'591','participants':[{'id':'$player'},*[{'id':member,'condition':{'all':[cmp(f'party.{member}.present','eq',1),cmp(f'party.{member}.awake','eq',1)]}} for member in ['charlie','bernard','sylvia','norman']]],'partyTurnOrder':['$player','charlie','bernard','sylvia','norman'],'enemyTurnOrder':['hunters'],'initiative':'enemy-first','enemies':[{'id':'hunters','name':'持旧式步枪的猎人','count':field('counter.frost591HunterCount'),'hp':1,'maxHp':1,'skills':{'firearmsRifleShotgun':20},'attackSkill':'firearmsRifleShotgun','damage':'2D6','impaling':True,'targetOrder':['$player'],'damageMode':'target'}],'victoryHitThreshold':{'calc':'quotient','values':[{'calc':'sum','values':[field('counter.frost591HunterCount'),1]},2]},'weapons':[{'id':'rifle-player-591','label':'步枪','skill':'firearmsRifleShotgun','damage':'2D6+4','key':'rifle','firearm':True,'actors':['$player']},*[{'id':f'rifle-{member}-591','label':'步枪','skill':'firearmsRifleShotgun','damage':'2D6+4','key':'rifle','firearm':True,'actors':[member]} for member in ['charlie','bernard','sylvia','norman']]],'win':'frost-591-after-firefight','lose':'191','options':[choice('现在投降',561,id='surrender')]}}],2);blocked.pop('591',None)
    P['frost-591-after-firefight']=[choices(choice('尝试急救，成功恢复1D3点生命',target='frost-591-first-aid',condition=cmp('hp','lt',field('maxHp')),id='aid'),choice('不急救，前往第513节',513,id='continue'))];src['frost-591-after-firefight']=['591:p2']
    P['frost-591-first-aid']=[check('firstAid','急救',success=513,failure=513,successEffects=[add('hp','1D3')])];src['frost-591-first-aid']=['591:p2']
    put(592,[route(589)],2)
    put(593,[route(433)],2)
    roster_all={'all':[cmp(f'party.{mid}.present','eq',1) for mid in ['charlie','bernard','sylvia','norman']]}
    no_charlie={'all':[cmp('party.charlie.present','eq',0),cmp('party.bernard.present','eq',1),cmp('party.sylvia.present','eq',1),cmp('party.norman.present','eq',1)]}
    no_bernard={'all':[cmp('party.charlie.present','eq',1),cmp('party.bernard.present','eq',0),cmp('party.sylvia.present','eq',1),cmp('party.norman.present','eq',1)]}
    two_students=exact_roster({'norman','sylvia'})
    one_student=exact_roster({'norman'})
    no_students=exact_roster(set())
    put(594,[route(602,roster_all),route(158,no_charlie),route(598,no_bernard),route(324,two_students),route(279,one_student),route(597,no_students),route(593)],2)
    put(595,[check('scienceGeology','科学（地质学）',596,513)],2)
    put(596,[effects({'op':'register','kind':'state','key':'CHARCOAL','label':'木炭'}),check('luck','幸运',513,279)],3)
    put(597,[choices(choice('深入森林',501),choice('沿林缘前进',494),choice('探索岩石地带',427),choice('沿河前进并掷幸运',target='frost-597-luck',id='river'))],2)
    P['frost-597-luck']=[check('luck','幸运',126,119)];src['frost-597-luck']=['597:p2']
    put(598,[choices(choice('放弃，回文明世界',593),choice('提醒查理由你付酬',599))],3)
    put(599,[effects({'op':'party','member':'charlie','action':'status','value':'missing'},flag('SUPPLIES_CHARLIE_SHARE_LOST')),choices(choice('带学生逆流而上',600),choice('绕行回堡垒并继续找发现',324),choice('直接前往堡垒',593))],2)
    put(600,[choices(choice('INCHCAPE途径',601,condition={'flag':'INCHCAPE','equals':True}),choice('攀上山脊',469,condition=ridge_condition),choice('沿河前进',75),choice('平行前进',55),choice('穿过疏林',218),choice('深入森林',557))],2)
    put(601,[choices(choice('穿过疏林',218),choice('深入森林',557),choice('攀上山脊',469,condition=ridge_condition),choice('沿河前进',470),choice('寻找庇护并掷导航',target='frost-601-navigate',id='shelter'))],2)
    P['frost-601-navigate']=[check('navigate','导航',77,55)];src['frost-601-navigate']=['601:p2']
    put(602,[choices(choice('放弃计划并回家',593),choice('提醒查理由你付酬',603))],3)
    put(603,[effects({'op':'party','member':'charlie','action':'status','value':'missing'},flag('SUPPLIES_CHARLIE_SHARE_LOST')),choices(choice('无向导逆流而上',604),choice('绕路回堡垒并继续调查',158),choice('直接回堡垒',593))],2)
    put(604,[choices(choice('前往峡谷',90),choice('沿河前进',60),choice('以群山作路标',56),choice('登高前进',552),choice('探索深林',461),choice('INCHCAPE途径',158,condition={'flag':'INCHCAPE','equals':True}))],2)
    put(605,[effects({'op':'register','kind':'state','key':'INCHCAPE','label':'印奇凯普'}),choices(choice('困难智力检定',target='frost-605-int',id='int'),choice('普通科学（植物学）检定',target='frost-605-botany',id='botany'))],4)
    P['frost-605-int']=[check('int','困难智力',606,607,difficulty='hard')];src['frost-605-int']=['605:p4']
    P['frost-605-botany']=[check('scienceBotany','科学（植物学）',606,607)];src['frost-605-botany']=['605:p4']
    put(606,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(158)],3)
    put(607,[choices(choice('离开山谷',158),choice('继续寻找证据',608))],3)
    put(608,[effects(setv('counter.frost608NaturalSuccess',0),setv('counter.frost608LuckSuccess',0)),check('naturalWorld','自然界',successEffects=[setv('counter.frost608NaturalSuccess',1)]),check('luck','幸运',successEffects=[setv('counter.frost608LuckSuccess',1)]),route(620,{'all':[cmp('counter.frost608NaturalSuccess','eq',1),cmp('counter.frost608LuckSuccess','eq',1)]}),route(617,{'all':[cmp('counter.frost608NaturalSuccess','eq',0),cmp('counter.frost608LuckSuccess','eq',0)]}),route(610,{'all':[cmp('counter.frost608NaturalSuccess','eq',1),cmp('counter.frost608LuckSuccess','eq',0)]}),route(630)],2)
    put(609,[effects({'op':'party','member':'bernard','action':'status','value':'dead'},{'op':'party','member':'sylvia','action':'status','value':'missing'}),choices(choice('带诺曼离开山谷',278),choice('循踪寻找西尔维娅',484))],3)
    put(610,[check('listen','聆听',611,615)],2)
    put(611,[effects(setv('counter.frost611Damage',0),setv('counter.frost611PlayerDex',0),setv('counter.frost611BernardDex',0)),check('firearmsRifleShotgun','納德爾曼步槍射擊劍齒貓',condition=cmp('inventory.rifle.count','gt',0),successEffects=[add('counter.frost611Damage','2D6+4')]),check('firearmsRifleShotgun','伯納德步槍射擊劍齒貓',actor='bernard',condition={'all':[cmp('party.bernard.present','eq',1),cmp('party.bernard.awake','eq',1),cmp('party.bernard.inventory.rifle.count','gt',0)]},successEffects=[add('counter.frost611Damage','2D6+4')]),check('dex','納德爾曼困難敏捷',difficulty='hard',condition=cmp('inventory.rifle.count','gt',0),successEffects=[setv('counter.frost611PlayerDex',1)]),check('dex','伯納德困難敏捷',actor='bernard',difficulty='hard',condition={'all':[cmp('party.bernard.present','eq',1),cmp('party.bernard.awake','eq',1),cmp('party.bernard.inventory.rifle.count','gt',0)]},successEffects=[setv('counter.frost611BernardDex',1)]),route('frost-611-extra-shot',{'any':[cmp('counter.frost611PlayerDex','eq',1),cmp('counter.frost611BernardDex','eq',1)]}),route('frost-611-result')],3)
    P['frost-611-extra-shot']=[choices(choice('再开一枪',target='frost-611-second-shot',id='second-shot'),choice('不再开枪',target='frost-611-result',id='skip-second'))];src['frost-611-extra-shot']=['611:p2']
    P['frost-611-second-shot']=[check('firearmsRifleShotgun','纳德尔曼追加步枪射击',success='frost-611-result',failure='frost-611-result',condition=cmp('inventory.rifle.count','gt',0),successEffects=[add('counter.frost611Damage','2D6+4')]),route('frost-611-result')];src['frost-611-second-shot']=['611:p2']
    P['frost-611-result']=[route('frost-611-kill',cmp('counter.frost611Damage','gte',12)),route(612)];src['frost-611-result']=['611:p3']
    P['frost-611-kill']=[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(613)];src['frost-611-kill']=['611:p3']
    blocked.pop('611',None)
    put(612,[effects({'op':'party','member':'bernard','action':'hp','value':'-1D10'}),choices(choice('再向剑齿猫开一枪',target='frost-612-shot',id='shoot'),choice('不射击',target='frost-612-result',id='skip'))],3)
    P['frost-612-shot']=[check('firearmsRifleShotgun','纳德尔曼步枪射击',success='frost-612-result',failure='frost-612-result',condition=cmp('inventory.rifle.count','gt',0),successEffects=[add('counter.frost611Damage','2D6+4')]),route('frost-612-result')];src['frost-612-shot']=['612:p2']
    P['frost-612-result']=[route('frost-612-cat-killed',cmp('counter.frost611Damage','gte',12)),effects({'op':'party','member':'bernard','action':'status','value':'dead'}),route(614)];src['frost-612-result']=['612:p2']
    P['frost-612-cat-killed']=[route('frost-612-aid-choice',cmp('party.bernard.hp','gt',0)),effects({'op':'party','member':'bernard','action':'status','value':'dead'}),route(614)];src['frost-612-cat-killed']=['612:p2','612:p3']
    P['frost-612-aid-choice']=[choices(choice('尝试急救伯纳德',target='frost-612-aid',id='aid'),choice('不急救',613,id='skip-aid'))];src['frost-612-aid-choice']=['612:p3']
    P['frost-612-aid']=[check('firstAid','急救伯纳德',success=613,failure=613,successEffects=[{'op':'party','member':'bernard','action':'hp','value':'1D3'}])];src['frost-612-aid']=['612:p3']
    blocked.pop('612',None)
    put(613,[route(158)],2)
    put(614,[choices(choice('继续探索',551),choice('离开山谷',291))],2)
    put(615,[route(612)],2)
    put(616,[effects(setv('counter.frost616PlayerSuccess',0),setv('counter.frost616NormanSuccess',0),setv('counter.frost616SylviaSuccess',0)),check('con','纳德尔曼体质（奖励骰）',successEffects=[setv('counter.frost616PlayerSuccess',1)],bonus=1),check('con','诺曼体质（奖励骰）',target=field('party.norman.attribute.con'),successEffects=[setv('counter.frost616NormanSuccess',1)],bonus=1),check('con','西尔维娅体质（奖励骰）',target=field('party.sylvia.attribute.con'),successEffects=[setv('counter.frost616SylviaSuccess',1)],bonus=1),route(344,{'all':[cmp('counter.frost616PlayerSuccess','eq',1),cmp('counter.frost616NormanSuccess','eq',1),cmp('counter.frost616SylviaSuccess','eq',1)]}),route('frost-616-damage',cmp('counter.frost616PlayerSuccess','eq',0)),route(356,{'all':[cmp('counter.frost616PlayerSuccess','eq',1),cmp('counter.frost616NormanSuccess','eq',0),cmp('counter.frost616SylviaSuccess','eq',0)]}),route(482,{'all':[cmp('counter.frost616PlayerSuccess','eq',1),cmp('counter.frost616NormanSuccess','eq',0),cmp('counter.frost616SylviaSuccess','eq',1)]}),route(520)],2)
    P['frost-616-damage']=[effects(add('hp','-2D10')),route(347,cmp('hp','gt',0)),route(191,cmp('hp','lte',0))];src['frost-616-damage']=['616:p2']
    put(617,[check('dex','伯纳德敏捷',618,619,target=field('party.bernard.attribute.dex'))],6)
    put(618,[choices(choice('放弃继续探索',613),choice('暂留山谷',645))],3)
    put(619,[effects({'op':'party','member':'bernard','action':'status','value':'missing'}),route(616)],2)
    put(620,[effects({'op':'register','kind':'state','key':'BACKWATER','label':'回水湾'}),route(613)],6)
    put(621,[check('sanity','理智',623,622)],6)
    put(622,[effects(add('sanity','-1D6')),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(646,cmp('sanity.temporary','eq',1)),route(364,cmp('sanity.indefinite','eq',1)),route(623)],2);blocked.pop('622',None)
    put(623,[choices(choice('追赶伯纳德',624),choice('与诺曼、西尔维娅留下并友好接触',626))],2)
    put(624,[check('spotHidden','侦查',625,628)],2)
    put(625,[choices(choice('放弃山谷',613),choice('继续探索',645))],2)
    put(626,[check('anthropology','人类学',627,629)],3)
    put(627,[choices(choice('继续寻找伯纳德',551),choice('离开山谷',291))],4)
    put(628,[effects({'op':'party','member':'bernard','action':'status','value':'dead'}),choices(choice('无伯纳德继续探索',551),choice('离开山谷',291))],4)
    put(629,[route(644)],4)
    put(630,[check('sanity','理智',failureEffects=[add('sanity','-1D6')]),call('frost-source-insanity-check'),route(550,cmp('sanity.permanent','eq',1)),route(646,cmp('sanity.temporary','eq',1)),route(364,cmp('sanity.indefinite','eq',1)),route(631)],2);blocked.pop('630',None)
    put(631,[effects(add('skill.cthulhuMythos',1)),choices(choice('逃跑寻找掩护',637),choice('留下战斗',632))],3)
    frost632=[effects(setv('counter.frost632Hits',0))]
    for member,label in [('charlie','查理'),('bernard','伯纳德'),('sylvia','西尔维娅'),('norman','诺曼')]:
        next_id='frost-632-next-'+member
        fire_id='frost-632-fire-'+member
        cond={'all':[cmp(f'party.{member}.present','eq',1),cmp(f'party.{member}.awake','eq',1),cmp(f'party.{member}.inventory.rifle.count','gt',0)]}
        frost632.append(check('sanity',f'{label}理智检定（持步枪时）',success=fire_id,failure=next_id,condition=cond,actor=member))
        frost632.append(route(next_id))
        P[fire_id]=[check('firearmsRifleShotgun',f'{label}向飞行生物开火',success=next_id,failure=next_id,condition=cond,successEffects=[add('counter.frost632Hits',1)],actor=member),route(next_id)]
        src[fire_id]=['632:p2','632:p3'];P[next_id]=[];src[next_id]=['632:p2','632:p3']
    for index,member in enumerate(['charlie','bernard','sylvia','norman']):
        P['frost-632-next-'+member]=([route('frost-632-next-'+['charlie','bernard','sylvia','norman'][index+1])] if index<3 else [effects(add('skill.cthulhuMythos',1)),route(633,cmp('counter.frost632Hits','gte',2)),route(634)])
    put(632,frost632,2,3);blocked.pop('632',None)
    put(633,[effects(add('skill.cthulhuMythos',1),add('sanity','1D6'),*[add(f'party.{mid}.sanity','1D6') for mid in ['charlie','bernard','sylvia','norman']]),choices(choice('离开山谷',613),choice('继续搜寻',645))],2)
    put(634,[effects(add('skill.cthulhuMythos',1)),check('con','伯纳德困难体质',636,635,target=field('party.bernard.attribute.con'),difficulty='hard')],3)
    put(635,[effects(add('counter.frostDay',1),{'op':'sanityBaseline'},{'op':'party','member':'bernard','action':'status','value':'dead'}),choices(choice('继续探索',551),choice('离开山谷',291))],3)
    put(636,[choices(choice('继续探索山谷',645),choice('离开山谷',613))],2)
    put(637,[effects(add('skill.cthulhuMythos',1)),check('dodge','伯纳德闪避',639,638,target=field('party.bernard.skill.dodge'))],2)
    put(638,[route(641,{'any':[cmp('party.sylvia.present','eq',0),cmp('party.sylvia.awake','eq',0)]}),check('dodge','西尔维娅闪避',640,641,target=field('party.sylvia.skill.dodge'))],2)
    put(639,[route(636)],2)
    put(640,[route(635)],2)
    put(641,[effects({'op':'party','member':'sylvia','action':'status','value':'missing'},{'op':'party','member':'bernard','action':'status','value':'missing'}),choices(choice('带诺曼探索山谷',213),choice('离开山谷',361))],3)
    put(642,[route(605)],2)
    put(643,[check('swim','伯纳德游泳',92,110,target=field('party.bernard.skill.swim'))],2)
    put(644,[check('int','智力',387,389)],3)
    put(645,[choices(choice('前往山丘',621),choice('探索草原动物',620),choice('分组侦察',609))],2)
    put(646,[route(365)],3)
    put(647,[end('远征结束 · 原书第647节')],3)
    put(648,[route(113)],3)
    put(649,[random(10,[463,650,463,650,463,650,463,650,463,650])],2)
    put(650,[effects({'op':'party','member':'bernard','action':'status','value':'missing'}),choices(choice('返回堡垒',324),choice('继续探索',600))],2)
    put(651,[effects(add('sanity','1D6'),{'op':'party','member':'charlie','action':'status','value':'dead'}),route(54)],4)
    put(652,[effects({'op':'party','member':'sylvia','action':'status','value':'dead'}),route(278)],5)
    put(653,[choices(choice('杀出重围',391),choice('摆出顺从姿态让它们带走',389))],2)
    put(654,[{'kind':'end','label':'阻塞：按Luck improvement check规则判定是否获得1D10 Luck，而非普通Luck检定；之后去77','collect':False}],2);blocked['654']='Luck improvement check semantics differ from ordinary Luck check and must be implemented explicitly.'
    # Source-grounded repeat procedures use local loops inside called helpers.
    # They preserve one roll per attempt and return only on sourced success/death.
    def repeat_until_success(entry, skill, label, difficulty, damage, destination):
        helper=f'frost-{entry}-repeat'
        opening=[effects(setv(f'counter.frost{entry}Success',0))]
        if entry == 385:
            # Printed §385 applies this once before the repeated Hard Swim checks.
            opening.extend([effects(add('hp','-1D8')),route(helper,cmp('hp','gt',0)),route(drowning_ending(entry))])
        P[str(entry)]=opening+[{'kind':'call','target':helper},route(destination,cmp('hp','gt',0)),route(drowning_ending(entry))]
        P[helper]=[check(skill,label,difficulty=difficulty,successEffects=[setv(f'counter.frost{entry}Success',1)],failureEffects=[add('hp',damage)]),route('$return',cmp(f'counter.frost{entry}Success','eq',1)),route(helper,cmp('hp','gt',0)),route(drowning_ending(entry))]
        src[helper]=[f'{entry}:p2' if entry != 407 else '407:p2']
        blocked.pop(str(entry),None)
    repeat_until_success(385,'swim','困难游泳', 'hard','-1D3',397)
    # §407 requires three successful Hard CON rolls, not a single success.
    # Every failed attempt applies 1D3 smoke-inhalation damage; death ends here.
    P['407']=[effects(setv('counter.frost407Successes',0)),{'kind':'call','target':'frost-407-repeat'},route(408,cmp('hp','gt',0)),route(drowning_ending(407))]
    P['frost-407-repeat']=[check('con','困难体质（需累计三次成功）',difficulty='hard',successEffects=[add('counter.frost407Successes',1)],failureEffects=[add('hp','-1D3')]),route('$return',cmp('counter.frost407Successes','gte',3)),route('frost-407-repeat',cmp('hp','gt',0)),route(drowning_ending(407))]
    src['frost-407-repeat']=['407:p2'];blocked.pop('407',None)
    P['385']=[effects(setv('counter.frost385Success',0)),{'kind':'call','target':'frost-385-entry'},route(397,cmp('hp','gt',0)),route(drowning_ending(385))]
    P['frost-385-entry']=[effects(add('hp','-1D8')),route('frost-385-dead',cmp('hp','lte',0)),{'kind':'call','target':'frost-385-repeat'},{'kind':'route','target':'$return'}]
    P['frost-385-dead']=[route(drowning_ending(385))]
    src['frost-385-entry']=['385:p2'];src['frost-385-dead']=['385:p2']
    # §189 specifies a random finite number of underwater rounds. Each failed
    # CON starts drowning damage on that round and on every remaining round.
    P['189']=[effects(setv('counter.frost189Drowning',0)),random(6,[f'frost-189-round-{n}' for n in range(1,7)])]
    for remaining in range(1,7):
        helper=f'frost-189-round-{remaining}'
        steps=[check('con',f'水下第{7-remaining}轮体质检定',failureEffects=[setv('counter.frost189Drowning',1)]),effects(add('hp','-1D3'),condition=cmp('counter.frost189Drowning','eq',1))]
        if remaining>1: steps.extend([route(f'frost-189-round-{remaining-1}',cmp('hp','gt',0)),route(drowning_ending(189))])
        else: steps.extend([route('frost-189-surface',cmp('hp','gt',0)),route(drowning_ending(189))])
        P[helper]=steps;src[helper]=['189:p2']
    P['frost-189-surface']=[check('swim','浮出水面后的游泳检定',success=191,failure='frost-189-hold-breath')];src['frost-189-surface']=['189:p2']
    P['frost-189-hold-breath']=[check('con','最后一次屏息体质检定',failureEffects=[add('hp','-1D3')]),route('frost-189-last-chance',cmp('hp','gt',0)),route(drowning_ending(189))];src['frost-189-hold-breath']=['189:p2']
    P['frost-189-last-chance']=[effects(setv('counter.frost189FinalSwim',0),setv('counter.frost189FinalCon',0)),check('swim','最后一次逃生游泳检定',successEffects=[setv('counter.frost189FinalSwim',1)]),check('con','最后一次逃生体质检定',successEffects=[setv('counter.frost189FinalCon',1)]),route(191,{'all':[cmp('counter.frost189FinalSwim','eq',1),cmp('counter.frost189FinalCon','eq',1)]}),route(drowning_ending(189))];src['frost-189-last-chance']=['189:p2']
    for helper in ['frost-189-surface','frost-189-hold-breath']:
        src.setdefault(helper,['189:p2'])
    blocked.pop('189',None)
    blocked.pop('385',None); blocked.pop('407',None)

    def three_swims(entry, destination, first_aid=False):
        loop=f'frost-{entry}-swim-loop'; drowning=f'frost-{entry}-drowning-loop'
        P[str(entry)]=[effects(*([setv('counter.frost536StartHp',field('hp'))] if entry==536 else []),setv(f'counter.frost{entry}SwimSuccesses',0),setv(f'counter.frost{entry}Drowning',0)),{'kind':'call','target':loop},route(f'frost-{entry}-after-swim',cmp('hp','gt',0)),route(drowning_ending(entry))]
        P[loop]=[route(drowning,cmp(f'counter.frost{entry}Drowning','eq',1)),check('swim','游泳',successEffects=[add(f'counter.frost{entry}SwimSuccesses',1)],failureEffects=[setv(f'counter.frost{entry}Drowning',1)]),route('$return',cmp(f'counter.frost{entry}SwimSuccesses','gte',3)),route(loop,cmp('hp','gt',0)),route(drowning_ending(entry))]
        P[drowning]=[check('swim','溺水中的游泳',successEffects=[add(f'counter.frost{entry}SwimSuccesses',1)]),check('con','溺水中的体质',failureEffects=[add('hp','-1D6')]),route('$return',{'all':[cmp(f'counter.frost{entry}SwimSuccesses','gte',3),cmp('hp','gt',0)]}),route(drowning,cmp('hp','gt',0)),route(drowning_ending(entry))]
        src[loop]=[f'{entry}:p2']; src[drowning]=[f'{entry}:p2']
        if first_aid:
            P[f'frost-{entry}-after-swim']=[choices(choice('尝试急救',target=f'frost-{entry}-first-aid',id='aid'),choice('不急救',destination,id='skip'))]
            P[f'frost-{entry}-first-aid']=[check('firstAid','急救',success=destination,failure=destination,successEffects=[add('hp','1D3')])]
            src[f'frost-{entry}-after-swim']=[f'{entry}:p2']; src[f'frost-{entry}-first-aid']=[f'{entry}:p2']
        else:
            P[f'frost-{entry}-after-swim']=[route(destination)]; src[f'frost-{entry}-after-swim']=[f'{entry}:p2']
        blocked.pop(str(entry),None)
    three_swims(412,415)
    three_swims(512,513,first_aid=True)
    three_swims(514,513)
    three_swims(536,537)
    # A Luck improvement succeeds only when the raw D100 roll exceeds current Luck.
    # In the ordinary check contract that is the failed Luck check; success grants nothing.
    put(654,[check('luck','幸运值成长检定（记录原始D100与当前幸运）',record={'roll':'frost654roll','grade':'frost654grade','success':'frost654success','target':'frost654target'}),route('frost-654-improve',cmp('counter.frost654roll','gt',field('counter.frost654target'))),route(77)],2)
    P['frost-654-improve']=[effects(add('luck','1D10')),route(77)];src['frost-654-improve']=['654:p2']
    blocked.pop('654',None)
    # §354 uses source-recorded CON grades to adjust movement, then compares each
    # value against the sasquatches' printed movement rate of 7.
    put(354,[effects(setv('counter.frost354PlayerMove',8),setv('counter.frost354NormanMove',7)),check('con','纳德尔曼体质',record={'roll':'frost354PlayerRoll','grade':'frost354PlayerGrade','success':'frost354PlayerSuccess','target':'frost354PlayerTarget'}),check('con','诺曼体质',actor='norman',record={'roll':'frost354NormanRoll','grade':'frost354NormanGrade','success':'frost354NormanSuccess','target':'frost354NormanTarget'}),effects(add('counter.frost354PlayerMove',1),condition=cmp('counter.frost354PlayerGrade','gte',3)),effects(add('counter.frost354PlayerMove',-1),condition=cmp('counter.frost354PlayerGrade','lte',0)),effects(add('counter.frost354NormanMove',1),condition=cmp('counter.frost354NormanGrade','gte',3)),effects(add('counter.frost354NormanMove',-1),condition=cmp('counter.frost354NormanGrade','lte',0)),route(355,cmp('counter.frost354PlayerMove','lte',7)),route(356,cmp('counter.frost354NormanMove','lte',7)),route(358)],2);blocked.pop('354',None)
    # The report liability score counts every missing or confirmed-dead student.
    put(433,[effects(setv('counter.frost433Liability',0)),*[effects(add('counter.frost433Liability',15),condition={'any':[cmp(f'party.{member}.missing','eq',1),cmp(f'party.{member}.dead','eq',1)]}) for member in ['charlie','bernard','sylvia','norman']],{'kind':'rollEffects','label':'计算责任分并掷1D100','effects':[setv('counter.frost433Roll','1D100')]},route(530,cmp('counter.frost433Roll','gt',field('counter.frost433Liability'))),route(531)],2);blocked.pop('433',None)
    # §533: the player can independently attempt First Aid for themself and Sylvia.
    put(533,[choices(choice('分别尝试急救自己与西尔维娅',target='frost-533-first-aid',id='aid'),choice('不急救，继续',324,id='skip'))],3)
    # Resolve the two separate successes against their respective current HP.
    P['frost-533-first-aid']=[check('firstAid','急救自己',successEffects=[add('hp','1D3')]),check('firstAid','急救西尔维娅',successEffects=[{'op':'party','member':'sylvia','action':'hp','value':'1D3'}],condition={'all':[cmp('party.sylvia.present','eq',1),cmp('party.sylvia.hp','lt',field('party.sylvia.maxHp'))]}),route(324)]
    src['frost-533-first-aid']=['533:p3'];blocked.pop('533',None)
    # §537 lets either the investigator or Norman perform the check. Healing is
    # capped at the HP actually lost during §536, using the saved entry baseline.
    put(537,[choices(choice('由纳德尔曼进行急救',target='frost-537-player-aid',id='player-aid',condition=cmp('hp','lt',field('counter.frost536StartHp'))),choice('由诺曼进行急救',target='frost-537-norman-aid',id='norman-aid',condition={'all':[cmp('hp','lt',field('counter.frost536StartHp')),cmp('party.norman.present','eq',1),cmp('party.norman.awake','eq',1)]}),choice('不急救，继续',534,id='skip'))],2)
    P['frost-537-player-aid']=[check('firstAid','纳德尔曼急救',success='frost-537-heal',failure=534)]
    P['frost-537-norman-aid']=[check('firstAid','诺曼急救',actor='norman',success='frost-537-heal',failure=534)]
    P['frost-537-heal']=[{'kind':'rollEffects','label':'掷1D3并限制恢复量为本节实际损失','effects':[setv('counter.frost537HealRoll','1D3')]},effects(add('hp',{'calc':'min','values':[field('counter.frost537HealRoll'),{'calc':'difference','values':[field('counter.frost536StartHp'),field('hp')]}]})),route(534)]
    for helper in ['frost-537-player-aid','frost-537-norman-aid','frost-537-heal']: src[helper]=['537:p2']
    blocked.pop('537',None)
    # §§425/456 keep each printed roster outcome explicit. §442 counts only the
    # three students; Charlie is expedition staff, not a student. Any student no
    # longer present is recorded as lost, regardless of whether an earlier route
    # marked them missing, absent, or dead.
    students=['charlie','bernard','sylvia','norman']
    def roster_condition(present_ids):
        return {'all':[cmp(f'party.{member}.present','eq',1 if member in present_ids else 0) for member in students]}
    full_roster=roster_condition(set(students))
    # §425's printed condition is only the number of remaining students.
    # The descriptions at §§600-601 do not add a Charlie-absent restriction.
    exactly_two_students=[{'all':[cmp(f'party.{member}.present','eq',1 if member in pair else 0) for member in ['bernard','sylvia','norman']]} for pair in [('bernard','sylvia'),('bernard','norman'),('sylvia','norman')]]
    charlie_only_lost=roster_condition({'bernard','sylvia','norman'})
    bernard_only_lost=roster_condition({'charlie','sylvia','norman'})
    put(425,[route(602,full_roster),route(598,bernard_only_lost),route(604,charlie_only_lost),route(600,{'any':exactly_two_students}),{'kind':'end','label':'来源缺口：原书未说明当前队伍阵容的去向（第425节；不是原书结局）','collect':False}],2)
    # The only witnessed unsupported roster is covered by the user-authorized
    # §513 adaptation, so it is no longer reachable in this candidate.
    blocked.pop('425',None)
    frost442_students=['bernard','sylvia','norman']
    frost442_count=[effects(setv('counter.frost442LostStudents',0))]
    frost442_count.extend(effects(add('counter.frost442LostStudents',1),condition=cmp(f'party.{member}.present','eq',0)) for member in frost442_students)
    put(442,[*frost442_count,route(158,cmp('counter.frost442LostStudents','eq',0)),route(324,cmp('counter.frost442LostStudents','eq',1)),route(279,cmp('counter.frost442LostStudents','eq',2)),route(67,cmp('counter.frost442LostStudents','eq',3))],2)
    blocked.pop('442',None)
    one_loss_any=[{'all':[cmp(f'party.{lost}.present','eq',0),*[cmp(f'party.{other}.present','eq',1) for other in students if other!=lost]]} for lost in students]
    put(456,[effects(add('hp','-1D6')),route(547,full_roster),route(437)],2)
    blocked.pop('456',None)
    # Rifle attacks resolve the source-printed damage once, then compare the
    # actual damage roll with each paragraph's explicit threshold.
    put(325,[check('firearmsRifleShotgun','困难步枪攻击',success='frost-325-damage',failure=376,difficulty='hard')],2)
    P['frost-325-damage']=[{'kind':'rollEffects','label':'掷步枪伤害2D6+4','effects':[setv('counter.frost325Damage','2D6+4')]},route(373,cmp('counter.frost325Damage','gte',8)),route(376)];src['frost-325-damage']=['325:p2'];blocked.pop('325',None)
    put(423,[check('firearmsRifleShotgun','近距离步枪攻击',success='frost-423-damage',failure=376)],2)
    P['frost-423-damage']=[{'kind':'rollEffects','label':'掷步枪伤害2D6+4','effects':[setv('counter.frost423Damage','2D6+4')]},route(373,cmp('counter.frost423Damage','gte',9)),route(376)];src['frost-423-damage']=['423:p2'];blocked.pop('423',None)
    put(508,[check('firearmsRifleShotgun','步枪攻击',success='frost-508-damage',failure=510)],2)
    P['frost-508-damage']=[{'kind':'rollEffects','label':'掷步枪伤害2D6+4','effects':[setv('counter.frost508Damage','2D6+4')]},route(509,cmp('counter.frost508Damage','gte',12)),route(510)];src['frost-508-damage']=['508:p2'];blocked.pop('508',None)
    # §517 repeats shots until the recorded hit target is reached or a CON roll fails.
    first_shots=[]
    first_shots.extend([effects(setv('counter.frost517Hits',0)),{'kind':'rollEffects','label':'掷出驱散目标命中数','effects':[setv('counter.frost517RequiredHits','1D4+1')]}])
    for shot in (1,2):
        first_shots.extend([check('firearmsRifleShotgun',f'步枪射击（第{shot}枪）',successEffects=[add('counter.frost517Hits',1)]),check('con',f'开枪后保持清醒（第{shot}次，奖励骰）',failure=417,bonus=1),route(513,cmp('counter.frost517Hits','gte',field('counter.frost517RequiredHits')))])
    for shot in (3,4):
        first_shots.extend([check('firearmsRifleShotgun',f'步枪射击（第{shot}枪）',successEffects=[add('counter.frost517Hits',1)]),check('con',f'开枪后保持清醒（第{shot}次，普通骰）',failure=417),route(513,cmp('counter.frost517Hits','gte',field('counter.frost517RequiredHits')))])
    first_shots.extend([{'kind':'call','target':'frost-517-penalty-loop'},route(513)])
    put(517,first_shots,2)
    P['frost-517-penalty-loop']=[check('firearmsRifleShotgun','步枪射击（后续）',successEffects=[add('counter.frost517Hits',1)]),check('con','开枪后保持清醒（后续，惩罚骰）',failure=417,penalty=1),route('$return',cmp('counter.frost517Hits','gte',field('counter.frost517RequiredHits'))),route('frost-517-penalty-loop')]
    src['frost-517-penalty-loop']=['517:p2'];blocked.pop('517',None)
    # guessed. These procedures preserve the current scene cursor via $return.
    P['frost-insanity-check']=[check('int','疯狂后的智力检定',success=39,failure='$return')];src['frost-insanity-check']=['39:p3']
    P['frost-source-insanity-check']=[route('$return',{'any':[cmp('sanity.permanent','eq',1),cmp('sanity.indefinite','eq',1),cmp('sanity.temporary','eq',1)]}),check('int','单次理智损失后的智力检定',success='$return',failure='$return',condition=cmp('counter.sanityLastLoss','gte',5),successEffects=[{'op':'sanityCondition','value':'temporary'}]),route('$return')]
    src['frost-source-insanity-check']=['289:p2','290:p2','306:p2','318:p2','371:p2','622:p2','630:p2']
    P['frost-major-wound-check']=[check('con','重伤后的体质检定',success='$return',failure=191)];src['frost-major-wound-check']=['191:p2']
    # Named-companion checks are performed by that companion. Use the typed
    # actor field so the runtime records the performer and resolves their
    # actual skill/attribute without pretending it is Nadelmann's check.
    # Every independent drowning route resolves to one canonical outcome ID.
    # This keeps round/loop helper nodes from inflating the collected ending list.
    for death_entry in [12,189,385,407,412,512,514,536]:
        P[drowning_ending(death_entry)]=[end(f'探险结束 · 原书第{death_entry}节')]
        src[drowning_ending(death_entry)]=[f'{death_entry}:p2']

    for steps in P.values():
        for step in steps:
            if step.get('kind') != 'check':
                continue
            check_spec = step['check']
            target = check_spec.get('target')
            if not isinstance(target, dict) or not isinstance(target.get('field'), str):
                continue
            match = re.fullmatch(r'party\.(charlie|bernard|sylvia|norman)\.(?:skill|attribute)\.[A-Za-z]+', target['field'])
            if match:
                check_spec['actor'] = match.group(1)
                check_spec.pop('target')
    return P,src,blocked

def protect_review_output(output):
    target=Path(output)
    if target.name=='rules.json':
        raise ValueError('refuse to overwrite curated rules.json with a generated program review; choose runtime-program-001-654.json')
    if target.exists():
        try: existing=json.loads(target.read_text())
        except (OSError, json.JSONDecodeError): existing={}
        if existing.get('format')=='coc-frost-rule-review@1':
            raise ValueError('refuse to overwrite a curated coc-frost-rule-review@1 ledger with a generated program review')

def review_program(output):
    protect_review_output(output)
    graph=json.loads(GRAPH.read_text()); programs,sources,blocked=reviewed_programs()
    rows=[{'id':n,'program':steps,'sourceParagraphs':sources[n],**({'blocked':blocked[n]} if n in blocked else {})} for n,steps in programs.items()]
    data={'format':'coc-frost-reviewed-program@1','sourceGraphSha256':digest(GRAPH),'sourcePdfSha256':graph['source']['sha256'],'runtimePlayable':False,'compiledRange':['1','654'],'programs':rows,'blockedMechanisms':blocked,'uncompiledEntries':[],'notes':['Program map is manually authored against the cited original English paragraph IDs; source graph edges were not converted into choices.','Entries 1–654 have explicit programs except the listed source gaps. Character creation uses the source card attributes, 360 professional skill points, 180 interest skill points, English 90 starting skill and fixed Luck 85.','An entry-1 route probe witnessed investigator+Charlie+only Norman at §425 (seed 105). The user authorized a §513 adaptation: hide wild-return for that exact roster and preserve the printed §593/§594 choices.','Source §476 prints three dodge outcomes only. The user explicitly authorized an adaptation mapping the unprinted investigator-failure/Norman-success result to §332; this is an adaptation, not an original printed fourth outcome.','§§581/586 identify the least-Stealthy present party member but leave ties unspecified; the candidate deterministically resolves tied minimum values by roster order: investigator, Charlie, Bernard, Sylvia, Norman.','The user authorized a §376 adaptation routing investigator HP 0 with Norman alive to §191, leaving the investigator unconscious at 0 HP. This is not a printed §376 route.','The user authorized web-play fallback routing for otherwise unspecified HP-0 outcomes at §§355, 391, and 616 to §191; these are not printed destinations or official endings.','An unavailable Sylvia at §438 follows the printed failure destination §439; no check is rolled and no companion is revived or substituted. This is a dated web-play adaptation.','§201 says to test each remaining party member; absent or unconscious Norman/Sylvia are skipped and retain their initialized failed flags for the printed outcome matrix.','This artifact is a review candidate, not a formal release.']}
    Path(output).parent.mkdir(parents=True,exist_ok=True);Path(output).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    return {'programs':len(programs),'sourceEntries':len({k for k in programs if k.isdigit()}),'blocked':blocked,'output':str(output)}

def inventory(output):
    protect_review_output(output)
    graph=json.loads(GRAPH.read_text()); programs,sources,blocked=reviewed_programs()
    rows=[]
    for n,steps in programs.items():
        rows.append({'id':n,'program':steps,'sourceParagraphs':sources[n],**({'blocked':blocked[n]} if n in blocked else {})})
    out={'format':'coc-frost-reviewed-program@1','sourceGraphSha256':digest(GRAPH),'sourcePdfSha256':graph['source']['sha256'],'runtimePlayable':False,'compiledRange':['1','80'],'programs':rows,'blockedMechanisms':blocked,'uncompiledEntries':[str(i) for i in range(81,655)],'notes':['Program map is manually authored against the cited original English paragraph IDs; source graph edges were not converted into choices.','The first 80 entries have explicit programs except the three listed inventory blockers. Character creation remains a separate blocker pending precise allocation semantics.','This artifact is a review candidate, not a formal release.']}
    Path(output).parent.mkdir(parents=True,exist_ok=True);Path(output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    return {'entries':len(programs),'blocked':blocked,'output':str(output)}

def compile_candidate(review_path,translation_root,output,version=None):
    graph=json.loads(GRAPH.read_text());review=json.loads(Path(review_path).read_text()); trroot=Path(translation_root)
    if review.get('sourceGraphSha256')!=digest(GRAPH) or review.get('sourcePdfSha256')!=graph['source']['sha256']: raise ValueError('review program does not match current PDF source graph')
    if not trroot.is_dir(): raise ValueError('translation directory missing')
    trs={x['id']:x for x in json.loads((trroot/'manifest.json').read_text())['nodes']}
    programs={r['id']:r for r in review['programs']}
    graphnodes={n['id']:n for n in graph['nodes']}
    nodes=[]; audit=[]; auto_helpers=[]
    for node in graph['nodes']:
        n=node['id']; sp=ROOT/'scripts'/node['fragment']['path']; source=json.loads(sp.read_text()); trpath=(trroot/trs[n]['fragment']['path']).resolve()
        if not trpath.is_relative_to(trroot.resolve()) or digest(trpath)!=trs[n]['fragment']['sha256']: raise ValueError(f'unsafe or changed translation {n}')
        tr=json.loads(trpath.read_text())
        if tr.get('sourceFragmentSha256')!=node['fragment']['sha256']: raise ValueError(f'translation/source pin mismatch at {n}')
        tmap={p['id']:p['text'] for p in tr['paragraphs']}; smap={p['id']:p for p in source['paragraphs']}
        if set(tmap)!=set(smap): raise ValueError(f'paragraph coverage mismatch at {n}')
        rule=programs.get(n); removed=set(rule['sourceParagraphs']) if rule else set()
        for pid in removed:
            if pid not in smap or smap[pid]['kind']!='body': raise ValueError(f'program source reference is not a body paragraph: {pid}')
        en=[];zh=[]
        for p in source['paragraphs']:
            if p['kind'] in ('heading','trace') or p['id'] in removed or re.fullmatch(r'[（(]?\s*\d[\d,\s\-–—]*[）)]', p['text'].strip()) or re.fullmatch(r'[（(]\s*\d[\d,\s\-–—]*[）)]', tmap[p['id']].strip()): continue
            en.append(re.sub(r'\s+',' ',p['text']).strip());zh.append(re.sub(r'\s+',' ',tmap[p['id']]).strip())
        if n == '259' and len(en) >= 4:
            en[2:4] = [' '.join(en[2:4])]; zh[2:4] = [''.join(zh[2:4])]
        if not en: en=['Continue with the current action.'];zh=['继续当前行动。']
        title='冰霜独行 · '+n
        row={'id':n,'sourceId':n,'type':'program','title':title,'chapter':'原书条目 '+n,'text':zh,'reading':{'zh-CN':{'title':title,'text':zh},'en':{'title':'Alone Against the Frost · '+n,'text':en}},'background':'/art/lighthouse.svg'}
        if n in ('186','228','307','321','376','406') or n in SOURCE_LETHAL_INJURY_SECTIONS or n in SOURCE_HP_ZERO_ADAPTATIONS: row['healthRouting']={'injury':'source'}
        if n in ('289','290','306','318','371','622','630'): row['healthRouting']={'sanity':'source'}
        if rule: row['program']=rule['program']
        elif node.get('terminal'): row['program']=[end('结局 · 原书第 '+n+' 节')]
        else: row['program']=[{'kind':'end','label':'候选阻塞：原书本节规则尚未审校编译','collect':False}]
        # Numbered sections with no player-facing action must still show their
        # narrative before their automatic effects/routes run. Keep one visible
        # “next” action on the source node, then evaluate the original program in
        # an invisible helper that shares the exact same paragraph fragment.
        program=row['program']
        if n.isdigit() and any(step['kind']=='route' for step in program) and all(step['kind'] in ('effects','route','end','check') for step in program) and program[0]['kind'] in ('effects','route'):
            helper='frost-auto-'+n
            row['program']=[choices(choice('下一节',target=helper,id='next'))]
            helper_row={'id':helper,'sourceId':n,'type':'program','title':title,'chapter':'原书条目 '+n,'text':zh,'reading':{'zh-CN':{'title':title,'text':zh},'en':{'title':'Alone Against the Frost · '+n,'text':en}},'background':'/art/lighthouse.svg','program':program}
            if n in SOURCE_LETHAL_INJURY_SECTIONS or n in SOURCE_HP_ZERO_ADAPTATIONS: helper_row['healthRouting']={'injury':'source'}
            auto_helpers.append(helper_row)
            if rule:
                audit.append({'sourceId':n,'sourceFragmentSha256':node['fragment']['sha256'],'translationFragmentSha256':trs[n]['fragment']['sha256'],'sourceParagraphs':rule['sourceParagraphs'],'programSha256':hashlib.sha256(json.dumps(program,ensure_ascii=False,sort_keys=True).encode()).hexdigest(),'narrativeGate':helper})
        elif rule:
            audit.append({'sourceId':n,'sourceFragmentSha256':node['fragment']['sha256'],'translationFragmentSha256':trs[n]['fragment']['sha256'],'sourceParagraphs':rule['sourceParagraphs'],'programSha256':hashlib.sha256(json.dumps(rule['program'],ensure_ascii=False,sort_keys=True).encode()).hexdigest()})
        nodes.append(row)
    nodes.extend(auto_helpers)
    for helper,row in programs.items():
        if helper.isdigit(): continue
        source_id=helper.split('-')[1] if helper.startswith('frost-') else helper
        is_ending=any(step.get('kind')=='end' for step in row['program'])
        helper_node={'id':helper,'sourceId':source_id,'type':'program','title':'探险结束' if is_ending else '规则辅助步骤','chapter':'探险结束' if is_ending else '规则处理','text':[''],'reading':{'zh-CN':{'title':'探险结束' if is_ending else '规则处理','text':['']},'en':{'title':'Adventure End' if is_ending else 'Rules','text':['']}},'background':'/art/lighthouse.svg','program':row['program']}
        if is_ending and source_id.isdigit() and int(source_id) in (12,189,385,407,412,512,514,536) and helper == drowning_ending(int(source_id)):
            if source_id == '12':
                outcome_zh = '你被北汉尼纳河的湍流卷走，命丧翻涌的河水。纳德尔曼远征就此结束。'
                outcome_en = 'You are swept to your death in the churning waters of the North Hanninah. The Nadelmann Expedition is over.'
            elif source_id == '407':
                outcome_zh = '吸入烟雾造成的伤害夺去了你的生命。纳德尔曼远征就此结束。'
                outcome_en = 'You die from smoke inhalation. The Nadelmann Expedition is over.'
            else:
                outcome_zh = '你溺水身亡。纳德尔曼远征就此结束。'
                outcome_en = 'You have drowned. The Nadelmann Expedition is over.'
            helper_node['text'] = [outcome_zh]
            helper_node['reading']['zh-CN']['text'] = [outcome_zh]
            helper_node['reading']['en']['text'] = [outcome_en]
        if source_id in SOURCE_LETHAL_INJURY_SECTIONS or source_id in SOURCE_HP_ZERO_ADAPTATIONS: helper_node['healthRouting']={'injury':'source'}
        nodes.append(helper_node)
    presets=[{'id':'nadelmann-male','templateId':'nadelmann-male','label':'纳德尔曼博士（男性角色表）','description':'来源角色卡的属性与派生值；职业点与兴趣点待规则审校后分配。','occupation':'人类学教授','attributes':{'str':65,'con':85,'siz':70,'dex':70,'app':70,'pow':80,'int':90,'edu':90},'skills':{'anthropology':1,'history':5,'libraryUse':20,'naturalWorld':10,'languageOther':1,'languageOwn':90,'psychology':10,'persuade':10,'pilotBoat':1,'scienceGeology':1,'survivalWoodland':10},'hp':15,'sanity':80,'mp':16,'damageBonus':'+1D4','build':1,'movement':8,'profile':{'age':29,'pronouns':'他'}},{'id':'nadelmann-female','templateId':'nadelmann-female','label':'纳德尔曼博士（女性角色表）','description':'来源角色卡的属性与派生值；职业点与兴趣点待规则审校后分配。','occupation':'人类学教授','attributes':{'str':65,'con':85,'siz':70,'dex':70,'app':70,'pow':80,'int':90,'edu':90},'skills':{'anthropology':1,'history':5,'libraryUse':20,'naturalWorld':10,'languageOther':1,'languageOwn':90,'psychology':10,'persuade':10,'pilotBoat':1,'scienceGeology':1,'survivalWoodland':10},'hp':15,'sanity':80,'mp':16,'damageBonus':'+1D4','build':1,'movement':8,'profile':{'age':29,'pronouns':'她'}}]
    recipients=['$player','charlie','bernard','sylvia','norman']
    def invfield(who,key): return 'inventory.'+key+'.count' if who=='$player' else f'party.{who}.inventory.{key}.count'
    baseline=[]
    for who in recipients:
        for key in ['hatchet','knife','rifle']:
            baseline.append(setv(f'counter.frostBaseline.{who.replace("$player","player")}.{key}',field(invfield(who,key))))
    creation_program=[{'kind':'allocation','allocation':{'kind':'bonus','pool':360,'allowedSkills':['anthropology','history','libraryUse','naturalWorld','languageOther','languageOwn','psychology','persuade'],'occupation':'人类学教授'}},{'kind':'allocation','allocation':{'kind':'bonus','pool':180,'minimums':{'anthropology':75}}},effects(setv('luck',85),{'op':'sanityBaseline'})]
    # The source character sheets list weapon profiles but no starting quantities.
    # Ask the player to register group totals, then distribute them once, so later
    # source-directed loss/recovery has a per-member baseline without inventing it.
    for key,label in [('hatchet','短柄斧'),('knife','猎刀'),('rifle','步枪')]:
        creation_program.append({'kind':'number','label':f'登记探险开始时队伍的{label}总数（角色卡列武器数据但未印数量；按玩家登记，30仅为技术输入上限）','field':f'counter.frostStartTotal.{key}','min':0,'max':30})
        creation_program.append({'kind':'distribute','label':f'分配探险开始时的{label}','resource':'item','total':field(f'counter.frostStartTotal.{key}'),'recipients':recipients,'key':key,'itemLabel':label})
    creation_program.extend([effects(*baseline),route(1)])
    creation={'id':'0','title':'冰霜独行 · 建立调查员','chapter':'开始前准备','type':'program','text':['选择纳德尔曼博士的男性或女性角色卡，然后依照原书分配技能点。角色卡列出短柄斧、猎刀和步枪的武器数据，但没有打印持有数量；请登记队伍起始总数并分配，系统会记录每人的原始数量供后文恢复。'],'reading':{'zh-CN':{'title':'建立调查员','text':['选择纳德尔曼博士的男性或女性角色卡，然后依照原书分配技能点。角色卡列出短柄斧、猎刀和步枪的武器数据，但没有打印持有数量；请登记队伍起始总数并分配，系统会记录每人的原始数量供后文恢复。']},'en':{'title':'Create Investigator','text':['Choose the male or female Dr. Nadelmann sheet, then allocate skills as directed by the book. The character sheets list hatchet, knife and rifle weapon profiles but print no quantities; register the expedition totals and distribute them. The runtime records each person’s starting quantities for later restoration.']}},'background':'/art/lighthouse.svg','program':creation_program}
    chars=json.loads((SOURCE/'review/character-audit.json').read_text())['characters']; base={'accounting':5,'anthropology':1,'archaeology':1,'appraise':5,'artCraft':5,'charm':15,'climb':20,'creditRating':0,'cthulhuMythos':0,'disguise':5,'dodge':0,'driveAuto':20,'electricalRepair':10,'fastTalk':5,'fightingBrawl':25,'firearmsHandgun':20,'firearmsRifleShotgun':25,'firstAid':30,'history':5,'intimidate':15,'jump':20,'languageOther':1,'languageOwn':0,'law':5,'libraryUse':20,'listen':20,'locksmith':1,'mechanicalRepair':10,'medicine':1,'naturalWorld':10,'navigate':10,'occult':5,'persuade':10,'psychology':10,'ride':5,'science':1,'scienceBiology':1,'scienceBotany':1,'sciencePharmacy':1,'sleightOfHand':10,'spotHidden':25,'stealth':20,'survival':10,'swim':20,'throw':20,'track':10,'pilotBoat':1,'scienceGeology':1,'survivalWoodland':10,'psychoanalysis':1,'hatchet':15,'axe':0}
    skill_keys={'Anthropology':'anthropology','Climb':'climb','Dodge':'dodge','Fighting (Brawl)':'fightingBrawl','Hatchet':'hatchet','Axe':'axe','Firearms (Rifle/Shotgun)':'firearmsRifleShotgun','First Aid':'firstAid','Language (Own) English':'languageOwn','Language (Other) English':'languageOther','Language (Own) Tsuut’ina':'languageOwn','Listen':'listen','Navigate':'navigate','Pilot (Boat)':'pilotBoat','Psychology':'psychology','Psychoanalysis':'psychoanalysis','Science (Geology)':'scienceGeology','Sleight of Hand':'sleightOfHand','Stealth':'stealth','Survival (Woodland)':'survivalWoodland','Swim':'swim','Track':'track','Throw':'throw'}
    members=[]
    for c in chars:
        if c['role']!='companion': continue
        skills=copy.deepcopy(base)
        for label,value in c.get('skillValues',{}).items(): skills[skill_keys[label]]=value
        if 'Axe' in c.get('skillValues',{}): skills['hatchet']=c['skillValues']['Axe']
        names={'charlie-foxtail':'查理·狐尾','bernard-ebstein':'伯纳德·埃布斯坦','sylvia-davidson':'西尔维娅·戴维森','norman-falkner':'诺曼·福克纳'}
        d=c['derived']; members.append({'id':{'charlie-foxtail':'charlie','bernard-ebstein':'bernard','sylvia-davidson':'sylvia','norman-falkner':'norman'}[c['id']],'character':{'name':names[c['id']],'occupation':'同行调查员','profile':{'age':c['age']},'hp':d['hp'],'maxHp':d['hp'],'sanity':d['sanity'],'luck':d['luck'],'attributes':c['attributes'],'skills':skills,'mp':d['mp'],'damageBonus':d['damageBonus'],'build':d['build'],'specializations':{'languageOther':'英语','languageOwn':'楚蒂纳语' if c['id']=='charlie-foxtail' else '英语'}}})
    for preset in presets:
        preset['skills']=base|preset['skills']
        preset['skills']['creditRating']=64
    compiled_end=int(review['compiledRange'][1]); version=version or f'1.0.{compiled_end//80+78}-candidate'
    story={'id':'alone-against-frost','version':version,'rulesVersion':'coc7-solo@2','creationPolicy':'guided','healthPolicy':'frost','spendLuck':True,'party':{'members':members},'title':'冰霜独行','subtitle':'Alone Against the Frost','description':'在北汉尼纳河流域寻找失踪学生，面对荒野、异象与远古恐惧。','duration':'3–6小时','difficulty':'进阶','cover':'/art/lighthouse.svg','accent':'#66808a','tags':['单人','KP-less','CoC 7','中文 / English'],'entry':'0','presets':presets,'nodes':[creation]+nodes,'source':{'file':'scripts/'+graph['source']['filename'],'sha256':graph['source']['sha256'],'notes':[f'候选程序审校覆盖原书1–{compiled_end}；后续编号保留来源与译文，但尚未审校编译。','职业点数360与兴趣点数180分两阶段追加；角色卡属性为预印值，English Own Language以90为起点；固定Luck85。','装备数量分配、完整HP/疯狂/Daily SAN由剩余规则审校和共享运行时实现覆盖。']}}
    story['source']['notes'].extend(review.get('notes',[])[2:])
    story['source']['notes'].append('Character-card correction: Nadelmann Credit Rating to the printed 64 (PDF p.111), uses the printed Hatchet/Axe specialization for axe attacks, and aliases Charlie’s printed Axe 50 to that specialization. The blank player Hatchet base is explicitly adapted to 15% for KP-less character creation; it is not a printed score in this adventure. Authorization: user 2026-10-14. The official Chaosium weapons wiki identifies Hatchet/Sickle as Fighting (Axe); the official BRP SRD hand-axe base 15% is corroborating evidence, not a claim that this adventure prints the value. Original source/card files remain intact.')
    story['source']['notes'].append('Player prose revision 1.0.1: numeric reverse-reference footnotes are omitted from display only; §259:p1 and §285:p1 mistranslations are corrected, and §259 cross-page continuation is rejoined. Drowning and smoke terminal helpers now explicitly display the source-determined outcome; these concise English/Chinese outcome summaries are web presentation text, not additional source paragraphs or official ending names. Original source paragraphs remain intact. The 30-item entry control cap is a technical boundary recorded here, not a printed equipment limit.')
    story['source']['notes'].append('The user authorized on 2026-10-14 to offer §594 short-trip only for the six source-resolved rosters recorded in rules.json; all other rosters retain §593 and do not receive an invented destination.')
    story['source']['notes'].append('Repeated drowning-loop exits converge within their own printed source section; §§12, 189, 385, 407, 412, 512, 514 and 536 retain eight source-specific ending IDs and paragraph pins.')
    story['source']['notes'].append('On the printed §331→327 route, an unavailable Norman cannot make the explicitly required Hard CON roll; the candidate treats this as the printed failed-check destination §67. At §638, an unavailable Sylvia likewise follows the printed failed Dodge destination §641. Neither route rolls for an unconscious companion or revives one.')
    byid={n['id']:n for n in story['nodes']}; reachable={'0','39','191','364','550','frost-insanity-check','frost-major-wound-check'}; pending=['0','39','191','364','550','frost-insanity-check','frost-major-wound-check']
    while pending:
        cur=pending.pop(); current=byid.get(cur)
        if not current: continue
        for step in current.get('program',[]):
            dest=[]
            if step['kind']=='route': dest.append(step['target'])
            elif step['kind']=='check': dest.extend(x for x in [step['check'].get('success'),step['check'].get('failure'),step['check'].get('fumble')] if x)
            elif step['kind']=='choices': dest.extend(x for c in step['choices'] for x in [c.get('target'),c.get('call')] if x)
            elif step['kind']=='random': dest.extend(step['targets'])
            elif step['kind']=='call': dest.append(step['target'])
            elif step['kind']=='partyCombat':
                spec=step['combat']
                dest.extend([spec['win'],spec['lose']])
                if spec.get('flee'): dest.append(spec['flee'])
                dest.extend(route['target'] for route in spec.get('routes',[]))
                dest.extend(hook['call'] for hook in spec.get('roundCalls',[]))
                dest.extend(choice.get('target') or choice.get('call') for choice in spec.get('options',[]) if choice.get('target') or choice.get('call'))
            for target in dest:
                if target in byid and target not in reachable: reachable.add(target);pending.append(target)
    story['nodes']=[n for n in story['nodes'] if n['id'] in reachable]
    story['presets'][0]['skills']['languageOwn']=90
    target=Path(output)
    if target.resolve().is_relative_to((ROOT/'stories').resolve()): raise ValueError('refuse writing to formal stories directory')
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='coc-frost-review-') as temp:
        pack_story(story,Path(temp)/story['id']/story['version'])
        subprocess.run(['npx','tsx',str(ROOT/'tools/story/validate.ts'),temp],cwd=ROOT,check=True)
    summary=pack_story(story,target)
    review_out={'format':'coc-frost-program-audit@1','sourceGraphSha256':digest(GRAPH),'sourcePdfSha256':graph['source']['sha256'],'candidateSha256':digest(target/'story.json'),'compiledEntries':audit,'compiledCount':len(audit),'uncompiledEntries':[str(i) for i in range(compiled_end+1,655)],'blockedMechanisms':review.get('blockedMechanisms',{}),'runtimePlayable':False}
    outaudit=ROOT/f'work/alone-against-frost/review/runtime-audit-001-{int(review["compiledRange"][1]):03}.json';outaudit.parent.mkdir(parents=True,exist_ok=True);outaudit.write_text(json.dumps(review_out,ensure_ascii=False,indent=2)+'\n')
    return {'candidate':str(target),'summary':summary,'compiledEntries':len(audit),'runtimePlayable':False,'blockers':review_out['blockedMechanisms']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    r=sub.add_parser('review');r.add_argument('--output',default=str(REVIEW))
    c=sub.add_parser('compile');c.add_argument('--review',default=str(REVIEW));c.add_argument('--translations',default=str(TRANSLATIONS));c.add_argument('--output',default='work/alone-against-frost/preview/alone-against-frost/1.0.10-candidate');c.add_argument('--version',default=None)
    a=parser.parse_args();print(json.dumps(review_program(a.output) if a.command=='review' else compile_candidate(a.review,a.translations,a.output,**({'version':a.version} if a.version else {})),ensure_ascii=False))
