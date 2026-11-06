#!/usr/bin/env python3
"""Extract pinned language resources without loading or executing any game code."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile


def checksum(file, algorithm):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def ore_prefixes(source):
    result = []
    for match in re.finditer(r'new OrePrefixBuilder\("([^"\n]+)"\)(.*?)\.build\(\)', source, re.S):
        key, body = match.groups()
        values = {}
        for method in ['withPrefix', 'withSuffix', 'withDefaultLocalName']:
            value = re.search(r'\.' + method + r'\("([^"\\]*)"\)', body)
            if value:
                values[method] = value.group(1)
        if 'withPrefix' in values or 'withSuffix' in values:
            result.append({'key': key, 'prefix': values.get('withPrefix', ''),
                           'suffix': values.get('withSuffix', ''), 'defaultName': values.get('withDefaultLocalName')})
    return result


def extract(pack, minecraft, chinese, prefixes, lock):
    for file, algorithm, expected in [
        (pack, 'sha256', lock['modpack']['sha256']),
        (minecraft, 'sha1', lock['minecraft']['client']['sha1']),
        (chinese, 'sha1', lock['minecraft']['chinese']['hash']),
        (prefixes, 'sha256', lock['gregtech']['orePrefixes']['sha256']),
    ]:
        if checksum(file, algorithm) != expected:
            raise ValueError(f'Game language source checksum mismatch: {file}')
    languages, sources, notices = [], [], {}

    def language(source, domain, en, zh, en_file, zh_file):
        languages.append({
            'source': source, 'domain': domain, 'en': en.decode('utf-8-sig'),
            'zh': zh.decode('utf-8-sig') if zh else '',
            'format': 'json' if en_file.endswith('.json') else 'lang',
            'englishFile': en_file, 'chineseFile': zh_file,
        })

    with zipfile.ZipFile(minecraft) as jar:
        en_file = 'assets/minecraft/lang/en_US.lang'
        language('minecraft-1.7.10', 'minecraft', jar.read(en_file), Path(chinese).read_bytes(),
                 en_file, 'minecraft/lang/zh_CN.lang')
    sources.append({'id': 'minecraft-1.7.10', **lock['minecraft']})

    with zipfile.ZipFile(pack) as archive:
        for jar_file in sorted(name for name in archive.namelist() if '/mods/' in name and name.endswith('.jar')):
            content = archive.read(jar_file)
            jar_name = Path(jar_file).name
            entry = {'id': jar_name, 'sha256': hashlib.sha256(content).hexdigest(), 'archivePath': jar_file,
                     'domains': [], 'embeddedNotices': [], 'metadata': None}
            with zipfile.ZipFile(io.BytesIO(content)) as jar:
                by_domain = {}
                for name in sorted(jar.namelist()):
                    match = re.fullmatch(r'(?:resourcepacks/[^/]+/)?assets/([^/]+)/lang/(en_us|zh_cn)\.(lang|json)', name, re.I)
                    if match:
                        domain, locale, extension = match.groups()
                        by_domain.setdefault((domain.lower(), extension.lower()), {}).setdefault(locale.lower(), name)
                    if re.search(r'(^|/)(licen[sc]e|copying|notice)([._-]|$)', name, re.I) and not name.endswith('/'):
                        notice = jar.read(name)
                        if len(notice) < 512 * 1024:
                            sha = hashlib.sha256(notice).hexdigest()
                            notices[sha] = notice
                            entry['embeddedNotices'].append({'path': name, 'file': f'notices/{sha}.txt'})
                    if name == 'mcmod.info':
                        try:
                            entry['metadata'] = json.loads(jar.read(name).decode('utf-8-sig'))
                        except (UnicodeError, ValueError):
                            pass
                for (domain, extension), files in sorted(by_domain.items()):
                    entry['domains'].append(domain)
                    if 'en_us' not in files:
                        continue
                    en_file, zh_file = files['en_us'], files.get('zh_cn')
                    language(jar_name, domain, jar.read(en_file), jar.read(zh_file) if zh_file else None,
                             en_file, zh_file)
            sources.append(entry)

    return {'schemaVersion': 1, 'datasetVersion': lock['datasetVersion'], 'lock': lock,
            'orePrefixes': ore_prefixes(Path(prefixes).read_text()),
            'languages': languages, 'sources': sources}, notices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modpack')
    parser.add_argument('minecraft_client')
    parser.add_argument('minecraft_chinese')
    parser.add_argument('output')
    parser.add_argument('--ore-prefixes', required=True, help='Pinned GregTech OrePrefixes.java source')
    parser.add_argument('--credits', help='Write source inventory and embedded license notices here')
    arguments = parser.parse_args()
    lock = json.loads(Path(__file__).with_name('game-sources.lock.json').read_text())
    result, notices = extract(arguments.modpack, arguments.minecraft_client, arguments.minecraft_chinese, arguments.ore_prefixes, lock)
    output = Path(arguments.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    if arguments.credits:
        credits = Path(arguments.credits)
        (credits / 'notices').mkdir(parents=True, exist_ok=True)
        for sha, content in notices.items():
            (credits / 'notices' / f'{sha}.txt').write_bytes(content)
        (credits / 'sources.json').write_text(json.dumps({
            'schemaVersion': 1, 'lock': lock, 'sources': result['sources'],
            'terms': 'Minecraft, individual mod authors and GTNH translation contributors retain their own rights. '
                     'These resources are not relicensed under the planner code license.'}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'jars': len(result['sources']) - 1, 'languageDomains': len(result['languages']),
                      'domainsWithChinese': sum(bool(language['zh']) for language in result['languages']),
                      'embeddedNotices': len(notices)}))


if __name__ == '__main__':
    main()
