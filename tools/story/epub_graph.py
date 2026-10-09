"""Extract Flames relationships and separate verbatim scene fragments."""
import argparse
import hashlib
import io
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

FORMAT = 'coc-story-graph@2'
XHTML = '{http://www.w3.org/1999/xhtml}'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def text(element):
    return ''.join(element.itertext())


def components(nodes, edges):
    """Tarjan SCCs retain every original node, including isolated nodes."""
    adjacency = {n['id']: [] for n in nodes}
    for edge in edges:
        adjacency[edge['source']].append(edge['target'])
    index, low, stack, active, groups = {}, {}, [], set(), []

    def visit(node):
        index[node] = low[node] = len(index)
        stack.append(node)
        active.add(node)
        for target in adjacency[node]:
            if target not in index:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in active:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            members = []
            while True:
                member = stack.pop()
                active.remove(member)
                members.append(member)
                if member == node:
                    break
            groups.append(sorted(members, key=int))

    for node in adjacency:
        if node not in index:
            visit(node)
    groups.sort(key=lambda g: int(g[0]))
    dag_nodes = [{'id': 'scc-' + g[0], 'members': g,
                  'cyclic': len(g) > 1 or any(e['source'] == g[0] == e['target'] for e in edges)}
                 for g in groups]
    owners = {member: n['id'] for n in dag_nodes for member in n['members']}
    grouped_edges = {}
    for edge in edges:
        pair = (owners[edge['source']], owners[edge['target']])
        if pair[0] != pair[1]:
            grouped_edges.setdefault(pair, []).append(edge['id'])
    dag_edges = [{'source': a, 'target': b, 'originalEdgeIds': ids}
                 for (a, b), ids in grouped_edges.items()]
    indegree = {n['id']: 0 for n in dag_nodes}
    outgoing = {n: [] for n in indegree}
    for e in dag_edges:
        indegree[e['target']] += 1
        outgoing[e['source']].append(e['target'])
    ready = [n for n in indegree if not indegree[n]]
    order = []
    while ready:
        node = ready.pop(0)
        order.append(node)
        for target in outgoing[node]:
            indegree[target] -= 1
            if not indegree[target]:
                ready.append(target)
    if len(order) != len(dag_nodes):
        raise ValueError('Condensation graph is not acyclic')
    return {'entry': owners['1'], 'nodes': dag_nodes, 'edges': dag_edges,
            'topologicalOrder': order}


def extract(source):
    raw = source.read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(raw))
    container = ET.fromstring(archive.read('META-INF/container.xml'))
    opf_path = container.find('.//{*}rootfile').get('full-path')
    opf = ET.fromstring(archive.read(opf_path))
    opf_dir = posixpath.dirname(opf_path)
    manifest = {i.get('id'): {'id': i.get('id'), 'path': posixpath.normpath(posixpath.join(opf_dir, i.get('href'))),
                            'mediaType': i.get('media-type'), 'attributes': dict(i.attrib)}
                for i in opf.find('{*}manifest')}
    spine = [{'idref': i.get('idref'), 'path': manifest[i.get('idref')]['path'],
              'attributes': dict(i.attrib)} for i in opf.find('{*}spine')]
    documents, blocks, nodes, anchors, issues = [], [], [], {}, []
    # Archive order is retained separately; reading order comes from the OPF spine.
    html_paths = [s['path'] for s in spine]
    html_paths += [n for n in archive.namelist() if n.endswith(('.xhtml', '.html', '.htm')) and n not in html_paths]
    for path in html_paths:
        document_raw = archive.read(path)
        root = ET.fromstring(document_raw)
        body = root.find('{*}body')
        current = None
        first_number = False
        document_blocks = []

        def walk(element, location, parent=None):
            nonlocal current, first_number
            tag = element.tag.rsplit('}', 1)[-1]
            # Only the numbered story's text container owns gameplay paragraphs.
            # Artwork and back matter remain document blocks, never appended to 270.
            if tag == 'div':
                previous = current
                for ordinal, child in enumerate(element):
                    walk(child, location + '/' + str(ordinal), element)
                current = previous
                return
            if tag not in ('p', 'img', 'h1', 'h2', 'h3', 'table', 'ul', 'ol'):
                for ordinal, child in enumerate(element):
                    walk(child, location + '/' + str(ordinal), element)
                return
            value = text(element)
            numbered = tag == 'p' and 'Head-1' in element.get('class', '').split() and re.fullmatch(r'\d+', value.strip())
            if numbered:
                current = value.strip()
                first_number = True
                nodes.append({'id': current, 'sourceNumber': int(current), 'document': path,
                              'headingBlockId': f'{path}:{location}', 'blockIds': [],
                              'text': [], 'sourceInstructions': [], 'outgoingEdgeIds': []})
            owner = current if parent is not None and parent.get('id') == '_idContainer009' else None
            block = {'id': f'{path}:{location}', 'document': path, 'location': location,
                     'tag': tag, 'attributes': dict(element.attrib), 'text': value,
                     'xhtml': ET.tostring(element, encoding='unicode'), 'ownerNodeId': owner,
                     'section': 'story' if owner else ('back-matter' if first_number else 'front-matter'),
                     'links': [{'href': a.get('href', ''), 'text': text(a), 'attributes': dict(a.attrib)}
                               for a in element.iter(XHTML + 'a')],
                     'resources': [{'src': img.get('src'), 'archivePath': posixpath.normpath(posixpath.join(posixpath.dirname(path), img.get('src', ''))),
                                    'attributes': dict(img.attrib)} for img in element.iter(XHTML + 'img')]}
            blocks.append(block)
            document_blocks.append(block['id'])
            if owner:
                node = nodes[-1]
                node['blockIds'].append(block['id'])
                if not numbered:
                    node['text'].append(value)
                for a in element.iter():
                    if a.get('id'):
                        anchors[path + '#' + a.get('id')] = owner

        if body is not None:
            for ordinal, element in enumerate(body):
                walk(element, str(ordinal), body)
        documents.append({'path': path, 'sha256': sha(document_raw),
                          'rawText': document_raw.decode('utf-8'), 'blockIds': document_blocks})
    by_id = {n['id']: n for n in nodes}
    if set(by_id) != set(map(str, range(1, 271))) or len(nodes) != 270:
        raise ValueError('Expected exactly numbered entries 1 through 270')
    by_block = {b['id']: b for b in blocks}
    edges = []

    def add_edge(node, target, block, evidence, **extra):
        if target not in by_id:
            raise ValueError(f'Missing target {target} in {node}')
        edge = {'id': f'e-{len(edges) + 1}', 'source': node, 'target': target,
                'blockId': block['id'], 'instructionText': block['text'],
                'evidence': evidence, 'execution': 'requires-rule-compilation', **extra}
        edges.append(edge)
        by_id[node]['outgoingEdgeIds'].append(edge['id'])

    mechanical = re.compile(r'\b(roll|sanity|hit points?|magic points?|luck|check.mark|skill|STR|CON|SIZ|DEX|APP|INT|POW|EDU|occupation|damage|combat|secret|tried four|do not repeat)\b', re.I)
    for node in nodes:
        for block_id in node['blockIds']:
            block = by_block[block_id]
            if block_id == node['headingBlockId']:
                continue
            linked = set()
            for link in block['links']:
                label = link['text'].strip()
                if not label.isdigit() or label not in by_id:
                    continue
                href = link['href']
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(block['document']), href)) if href else ''
                destination = anchors.get(resolved)
                if destination != label:
                    issues.append({'kind': 'broken-or-mismatched-hyperlink', 'nodeId': node['id'],
                                   'blockId': block_id, 'originalHref': href,
                                   'printedTarget': label, 'anchorTarget': destination,
                                   'resolution': 'printed-number-retained-as-edge'})
                add_edge(node['id'], label, block, 'printed-link-number', originalHref=href,
                         anchorTarget=destination, linkText=link['text'])
                linked.add(label)
            # The EPUB has a real transition to 3 without a hyperlink at entry 25.
            for match in re.finditer(r'\b(?:go|turn)\s+to\s+(\d+)\b', block['text'], re.I):
                target = match.group(1)
                if target not in linked:
                    add_edge(node['id'], target, block, 'printed-prose-number', textOffset=match.start())
                    linked.add(target)
            if linked or mechanical.search(block['text']) or 'CharOverride-11' in block['xhtml']:
                node['sourceInstructions'].append({'blockId': block_id, 'text': block['text'],
                                                   'execution': 'uncompiled-original-text'})
        node['terminal'] = any(t.strip().lower() == 'the end.' for t in node['text'])
    # Explicit source-book arithmetic secrets: hint and discovery are both retained.
    # These are conditional edges, never automatic jumps merely from visiting a node.
    hidden = [('112', '7', 100, 'another way to leave'),
              ('112', '87', 100, 'You have lost him'),
              ('112', '112', 100, 'This might have been an interesting find'),
              ('175', '40', 10, 'strange chant'), ('197', '40', 40, 'strange chant'),
              ('202', '40', 50, 'strange chant'), ('259', '180', 20, 'previous appointment')]
    secrets = []
    for discovery, origin, offset, hint in hidden:
        rule_block = next(by_block[b] for b in by_id[discovery]['blockIds'] if f'add {offset} to' in by_block[b]['text'])
        hint_block = next(by_block[b] for b in by_id[origin]['blockIds'] if hint in by_block[b]['text'])
        add_edge(origin, str(int(origin) + offset), hint_block, 'source-arithmetic-secret',
                 condition={'type': 'discovered-secret-and-player-choice', 'discoveryNodeId': discovery},
                 offset=offset, ruleBlockId=rule_block['id'])
        secrets.append({'discoveryNodeId': discovery, 'ruleBlockId': rule_block['id'],
                        'instructionText': rule_block['text'], 'offset': offset,
                        'hintNodeId': origin, 'edgeId': edges[-1]['id']})
    for node in nodes:
        if not node['outgoingEdgeIds'] and not node['terminal']:
            issues.append({'kind': 'nonterminal-without-transition', 'nodeId': node['id']})
        for b in node['blockIds']:
            if b != node['headingBlockId'] and by_block[b]['text'].strip().isdigit():
                issues.append({'kind': 'standalone-number-in-body', 'nodeId': node['id'], 'blockId': b,
                               'resolution': 'preserved-verbatim-not-invented-as-transition'})
    reachable, pending = set(), ['1']
    while pending:
        node = pending.pop()
        if node in reachable:
            continue
        reachable.add(node)
        pending.extend(e['target'] for e in edges if e['source'] == node)
    unreachable = sorted(set(by_id) - reachable, key=int)
    dag = components(nodes, edges)
    members = [{'path': i.filename, 'size': i.file_size, 'sha256': sha(archive.read(i)),
                'compression': i.compress_type, 'crc32': i.CRC} for i in archive.infolist()]
    return {'format': FORMAT, 'id': 'alone-against-flames', 'title': 'Alone Against the Flames',
            'language': 'en-US', 'entry': '1',
            'status': {'losslessSource': True, 'graphExtracted': True, 'runtimePlayable': False,
                       'reason': 'Original rules, combat, guided character creation and state conditions require compilation beyond coc7-subset@1.'},
            'source': {'filename': source.name, 'sha256': sha(raw), 'size': len(raw),
                       'members': members, 'packagePath': opf_path, 'manifest': list(manifest.values()), 'spine': spine},
            'documents': documents, 'blocks': blocks, 'nodes': nodes, 'edges': edges,
            'secrets': secrets, 'dag': dag,
            'validation': {'numberedNodes': len(nodes), 'edges': len(edges), 'blocks': len(blocks),
                           'archiveMembers': len(members), 'reachableFromEntry': len(reachable),
                           'unreachableNodeIds': unreachable, 'issues': issues,
                           'ruleCompilationRequiredNodeIds': [n['id'] for n in nodes if n['sourceInstructions']],
                           'cyclicComponents': [n for n in dag['nodes'] if n['cyclic']]}}

def encode(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def convert(source):
    extracted = extract(source)
    blocks = {b['id']: b for b in extracted['blocks']}
    files, nodes, paragraph_ids = {}, [], {}
    folder = 'alone-against-flames/fragments'
    for node in extracted['nodes']:
        paragraphs = []
        for index, block_id in enumerate(node['blockIds']):
            block = blocks[block_id]
            paragraph_id = f"{node['id']}:p{index}"
            paragraph_ids[block_id] = paragraph_id
            paragraphs.append({'id': paragraph_id, 'kind': 'heading' if block_id == node['headingBlockId'] else 'body',
                               'text': block['text'], 'sourceLocation': block['location']})
        fragment = {'id': node['id'], 'document': node['document'], 'paragraphs': paragraphs}
        path = f"{folder}/{int(node['id']):03}.json"
        files[path] = encode(fragment)
        nodes.append({'id': node['id'], 'fragment': {'path': path, 'sha256': sha(files[path])}, 'terminal': node['terminal']})
    # Keep every other source paragraph and image reference in reading order.
    supplements = []
    for doc in extracted['documents']:
        entries = []
        for block_id in doc['blockIds']:
            block = blocks[block_id]
            if block['ownerNodeId'] is not None:
                continue
            entry = {'kind': block['tag'], 'section': block['section'], 'sourceLocation': block['location']}
            if block['tag'] == 'p':
                entry['text'] = block['text']
            if block['resources']:
                entry['resources'] = block['resources']
            if block['links']:
                entry['links'] = block['links']
            entries.append(entry)
        supplements.append({'document': doc['path'], 'entries': entries})
    supplement_path = f'{folder}/supplements.json'
    files[supplement_path] = encode({'documents': supplements})
    edges = []
    for old in extracted['edges']:
        edge = {k: old[k] for k in ('id', 'source', 'target', 'evidence')}
        edge['paragraphId'] = paragraph_ids[old['blockId']]
        for key in ('originalHref', 'textOffset', 'condition', 'offset'):
            if key in old:
                edge[key] = old[key]
        if 'ruleBlockId' in old:
            edge['ruleParagraphId'] = paragraph_ids[old['ruleBlockId']]
        edges.append(edge)
    issues = []
    for old in extracted['validation']['issues']:
        issue = {k: v for k, v in old.items() if k != 'blockId'}
        if 'blockId' in old:
            issue['paragraphId'] = paragraph_ids[old['blockId']]
        issues.append(issue)
    graph = {'format': FORMAT, 'id': extracted['id'], 'title': extracted['title'],
             'language': extracted['language'], 'entry': extracted['entry'],
             'runtimePlayable': False,
             'source': {k: extracted['source'][k] for k in ('filename', 'sha256', 'size')},
             'supplements': {'path': supplement_path, 'sha256': sha(files[supplement_path])},
             'nodes': nodes, 'edges': edges, 'issues': issues}
    return graph, files


def validate(path, source):
    actual = json.loads(path.read_text(encoding='utf-8'))
    expected, files = convert(source)
    if actual != expected:
        raise ValueError('Relationship graph differs from source extraction')
    for name, content in files.items():
        if (path.parent / name).read_bytes() != content:
            raise ValueError(f'Fragment text, order or metadata mismatch: {name}')
    # Independent check: every source paragraph, including headings and supplements,
    # appears exactly once, with the same Unicode text and location.
    preserved = {}
    for name, content in files.items():
        item = json.loads(content)
        if 'paragraphs' in item:
            for p in item['paragraphs']:
                key = (item['document'], p['sourceLocation'])
                if key in preserved:
                    raise ValueError('Duplicate paragraph')
                preserved[key] = p['text']
        else:
            for doc in item['documents']:
                for p in doc['entries']:
                    if p['kind'] == 'p':
                        key = (doc['document'], p['sourceLocation'])
                        if key in preserved:
                            raise ValueError('Duplicate supplement paragraph')
                        preserved[key] = p['text']
    with zipfile.ZipFile(source) as archive:
        original = {}
        for document in [n for n in archive.namelist() if n.endswith('.xhtml')]:
            body = ET.fromstring(archive.read(document)).find('{*}body')
            def walk(element, location):
                if element.tag == XHTML + 'p':
                    original[(document, location)] = text(element)
                for index, child in enumerate(element):
                    walk(child, location + '/' + str(index))
            for index, element in enumerate(body):
                walk(element, str(index))
    if original != preserved:
        raise ValueError('Original paragraph coverage mismatch')
    dag = components(actual['nodes'], actual['edges'])
    reachable, pending = set(), [actual['entry']]
    while pending:
        node = pending.pop()
        if node not in reachable:
            reachable.add(node)
            pending.extend(e['target'] for e in actual['edges'] if e['source'] == node)
    return {'nodes': len(actual['nodes']), 'edges': len(actual['edges']),
            'fragmentFiles': len(files), 'originalParagraphs': len(original),
            'graphBytes': path.stat().st_size, 'fragmentBytes': sum(map(len, files.values())),
            'cyclicComponents': len([n for n in dag['nodes'] if n['cyclic']]),
            'unreachableNodeIds': sorted(set(n['id'] for n in actual['nodes']) - reachable, key=int)}


def main():
    parser = argparse.ArgumentParser(description='Flames 剧情关系与逐段原文分开存储；不嵌入 EPUB。')
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--validate', type=Path)
    args = parser.parse_args()
    if args.validate:
        result = validate(args.validate, args.source)
    else:
        if args.output is None:
            parser.error('--output is required')
        graph, files = convert(args.source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            target = args.output.parent / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        args.output.write_bytes(encode(graph))
        result = validate(args.output, args.source)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
