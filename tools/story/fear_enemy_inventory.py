"""Source-pinned audit locator, never an executable monster-rule compiler."""
import collections
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'work/alone-against-fear'
catalog = json.loads((WORK / 'static-catalog-candidate.json').read_text())
definition = json.loads((WORK / 'reviewed-definition.json').read_text())
inventory_path = WORK / 'enemy-source-inventory.json'
previous_inventory = json.loads(inventory_path.read_text()) if inventory_path.exists() else {}
previous_rows = {row['enemyId']: row for row in previous_inventory.get('enemies', [])}
patterns = {
    'before-combat': r'突袭|惊袭|惊讶|惊吓|遭遇|遇见|发现|变形|形态|腐坏|腐烂',
    'attack': r'攻击|命中|击中|伤害|弹开|鳞|炮|射击|爆炸',
    'defense': r'防御|防守|闪避|格挡|防护|自然1|掷出1|投出1',
    'state': r'感染|疾病|中毒|麻痹|恢复|再生|每回合|每次|持续|直到|理智|生命|痊愈',
    'escape': r'逃跑|逃离|逃脱|撤退|离开|逃走|驱魔',
    'immunity-vulnerability': r'免疫|无效|只能|银|圣水|圣符|魔法|灵体|不可|不受',
    'reward': r'战利品|掉落|奖励|经验|XP|获得|线索|食物|物品',
}
rows = []
for key, entry in catalog['enemies'].items():
    pin = entry['source']
    raw = (ROOT / 'scripts' / pin['fragment']).read_bytes()
    translated_raw = (ROOT / 'scripts' / pin['translation']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin['sha256'] or hashlib.sha256(translated_raw).hexdigest() != pin['translationSha256']:
        raise ValueError('Source pin changed: ' + key)
    fragment, translation = json.loads(raw), json.loads(translated_raw)
    sm = {p['id']: p for p in fragment['paragraphs']}
    tm = {p['id']: p for p in translation['paragraphs']}
    ids, profile = pin['paragraphIds'], definition['enemies'].get(key)
    body, phases = [], collections.defaultdict(list)
    for pid in ids:
        original, translated = sm[pid]['text'], tm[pid]['text']
        body.append({'paragraphId': pid, 'original': original, 'translation': translated})
        for index, clause in enumerate(re.split(r'(?<=[。！？；])', translated)):
            clause = clause.strip()
            if not clause:
                continue
            labels = [name for name, pattern in patterns.items() if re.search(pattern, clause)] or ['unclassified']
            for label in labels:
                phases[label].append({'paragraphId': pid, 'clause': index, 'text': clause})
    numbered = [p['id'] for p in fragment['paragraphs'] if re.match(r'^\s*[1-6](?:\s|$)', p['text'])]
    shared = [{'paragraphId': p['id'], 'original': p['text'], 'translation': tm[p['id']]['text']}
              for p in fragment['paragraphs'] if p['id'] not in numbered and p['id'] not in ids]
    rows.append({'enemyId': key, 'label': (profile or entry)['label'], 'source': pin,
                 'runtimeProfileFields': sorted(profile) if profile else [], 'runtimeProfilePresent': profile is not None,
                 'sourceParagraphs': body, 'sharedTableParagraphs': shared, 'mechanicsByPhase': dict(phases),
                 'reviewStatus': 'source-bound-draft-requires-semantic-rule-audit',
                 'notes': ['Phase grouping is a locator; verify triggering order, exceptions and runtime coverage against the original.',
                           'A missing profile may be a bespoke noncombat encounter; trace its operations before treating it as a gap.']})
def references(value, enemy_id):
    if isinstance(value, dict):
        return any(key in ('enemyId', 'primaryEnemyId') and item == enemy_id for key, item in value.items()) or any(references(item, enemy_id) for item in value.values())
    if isinstance(value, list):
        return any(references(item, enemy_id) for item in value)
    return False


def context_source(section_id, context):
    source = ROOT / 'scripts/alone-against-fear/fragments' / (section_id + '.json')
    translated = ROOT / 'scripts/alone-against-fear/translations/zh-CN' / (section_id + '.json')
    src_raw, tr_raw = source.read_bytes(), translated.read_bytes()
    src, tr = json.loads(src_raw), json.loads(tr_raw)
    if tr['sourceFragmentSha256'] != hashlib.sha256(src_raw).hexdigest():
        raise ValueError('Named encounter translation pin changed: ' + section_id)
    translated_rows = {paragraph['id']: paragraph for paragraph in tr['paragraphs']}
    paragraphs = [{'paragraphId': paragraph['id'], 'original': paragraph['text'], 'translation': translated_rows[paragraph['id']]['text']}
                  for paragraph in src['paragraphs']]
    return {'context': context, 'fragment': str(source.relative_to(ROOT / 'scripts')), 'sha256': hashlib.sha256(src_raw).hexdigest(),
            'translation': str(translated.relative_to(ROOT / 'scripts')), 'translationSha256': hashlib.sha256(tr_raw).hexdigest(),
            'sourcePages': sorted(set(int(match) for paragraph in src['paragraphs'] for match in re.findall(r'\[(\d+),', paragraph['sourceLocation']))),
            'sourceParagraphs': paragraphs, 'scope': 'Complete source context; verify the indicated table row and shared rules against the page.'}


noncombat_rows = [row for row in rows if not row['runtimeProfilePresent']]
rows = [row for row in rows if row['runtimeProfilePresent']]
table_aliases = {'church-initial': 'place-of-worship', 'worship': 'place-of-worship', 'military': 'military-installation-lab'}
for enemy_id in sorted(set(definition['enemies']) - set(catalog['enemies'])):
    contexts = []
    for table_id, table in definition['tables'].items():
        for entry in table['entries']:
            if references(entry, enemy_id):
                contexts.append(context_source('section-' + table_aliases.get(table_id, table_id) + '-table',
                                               {'kind': 'table', 'tableId': table_id, 'roll': entry['roll']}))
    for event_id, operations in definition['eventPrograms'].items():
        if references(operations, enemy_id):
            contexts.append(context_source(str(event_id).zfill(3), {'kind': 'numbered-event', 'eventId': event_id}))
    # These source-backed profiles are created by mission runtime hooks rather
    # than table/event JSON operations, so trace them to their printed rows.
    mission_contexts = {
        'coven-witch': ('section-mission-table-continued', 'section-mission-table-continued:p2', 5),
        'living-dolls-6-dinosaur': ('section-living-dolls-table', 'section-living-dolls-table:p6', 6),
    }
    if enemy_id in mission_contexts:
        section_id, paragraph_id, source_row = mission_contexts[enemy_id]
        context = context_source(section_id, {'kind': 'mission-or-table-profile',
                                              'paragraphId': paragraph_id, 'row': source_row})
        context['sourceParagraphs'] = [paragraph for paragraph in context['sourceParagraphs']
                                       if paragraph['paragraphId'] == paragraph_id]
        contexts.append(context)
    # Reuse an already pinned exceptional context for established profiles
    # whose runtime creation is performed by source-specific helper hooks.
    previous = previous_rows.get(enemy_id, {})
    if not contexts and previous.get('sourceContexts'):
        contexts = previous['sourceContexts']
    if not contexts:
        raise ValueError('No source context traced for named runtime profile: ' + enemy_id)
    rows.append({'enemyId': enemy_id, 'label': definition['enemies'][enemy_id]['label'],
                 'runtimeProfileFields': sorted(definition['enemies'][enemy_id]), 'runtimeProfilePresent': True,
                 'sourceContexts': contexts, 'reviewStatus': 'source-bound-draft-requires-semantic-rule-audit',
                 'notes': ['Named runtime profiles are traced through actual table/event operations. Context text is not an executable recipe.']})

# Keep completed semantic audit decisions when source identity is unchanged.
# Catalog extraction can refresh names/stats, but must not erase review state.
for row in rows:
    old = previous_rows.get(row['enemyId'])
    if not old:
        continue
    same_source = (row.get('source') == old.get('source') if row.get('source') else
                   row.get('sourceContexts') == old.get('sourceContexts'))
    if not same_source:
        continue
    for field in ('implementedOps', 'missingOps', 'reviewStatus', 'reviewNotes'):
        if field in old:
            row[field] = old[field]

output = {'format': 'fear-enemy-source-inventory@1', 'sourcePdfSha256': catalog['sourcePdfSha256'],
          'definitionSha256': hashlib.sha256((WORK / 'reviewed-definition.json').read_bytes()).hexdigest(),
          'purpose': 'Source-bound runtime-profile audit inventory including table-wide rules. Never loaded as executable rules.',
          'counts': {'runtimeProfiles': len(rows), 'staticTableProfiles': len(catalog['enemies']), 'noncombatTableAliases': len(noncombat_rows)},
          'enemies': rows, 'noncombatTableAliases': noncombat_rows}
inventory_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'enemyCount': len(rows), 'profilesMapped': sum(row['runtimeProfilePresent'] for row in rows),
                  'noncombatTableAliases': len(noncombat_rows)}))
