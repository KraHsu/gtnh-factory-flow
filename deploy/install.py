#!/usr/bin/env python3
"""Publish a verified standalone release on rain. Run with sudo; no secrets in the bundle."""
import datetime
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/mnt/storage/gtnh-flow')
CONF = Path('/opt/1panel/www/conf.d/gtnh.krahsu.top.conf')
UNIT = Path('/etc/systemd/system/gtnh-flow.service')
CATALOG = Path('/mnt/storage/iam/app/deploy/services.json')
ENTRY = {
    'id': 'gtnh', 'name': '工厂蓝图', 'subtitle': 'GTNH 生产链规划器',
    'glyph': '工', 'category': '工具', 'url': 'https://gtnh.krahsu.top/',
    'launch': 'https://gtnh.krahsu.top/', 'mode': 'public', 'protocol': '公开工具 · 本地保存',
    'description': '搜索真实 GTNH 配方，连接生产链，计算机器数量与功耗。支持中英文。',
    'healthPath': '/api/version',
}

def run(*args):
    subprocess.run(args, check=True)

def nginx(action):
    run('docker', 'exec', '1Panel-openresty-NTPC', 'nginx', *action)

def link(target):
    temp = ROOT / 'current.next'
    if temp.is_symlink(): temp.unlink()
    temp.symlink_to(target)
    os.replace(temp, ROOT / 'current')

def write_atomic(path, data):
    temp = path.with_name(path.name + '.gtnh-next')
    if path.exists(): shutil.copy2(path, temp)
    temp.write_text(data)
    os.replace(temp, path)

if __name__ == '__main__':
    release = Path(sys.argv[1]).resolve()
    assert os.geteuid() == 0 and os.path.ismount('/mnt/storage')
    assert release.is_relative_to(ROOT / 'releases')
    assert (release / 'server.js').is_file() and (release / '.next/BUILD_ID').is_file()
    assert Path('/mnt/storage/iam/runtime/node').is_file()
    first = not UNIT.exists()
    if first:
        with socket.socket() as test: test.bind(('127.0.0.1', 8792))
    previous = os.readlink(ROOT / 'current') if (ROOT / 'current').is_symlink() else None
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = ROOT / 'backups' / stamp
    backup.mkdir(parents=True, mode=0o700)
    for path in (CONF, UNIT, CATALOG):
        if path.exists(): shutil.copy2(path, backup / path.name)
    (backup / 'previous.json').write_text(json.dumps({'current': previous, 'first': first}))
    env = Path('/etc/gtnh-flow.env')
    if not env.exists():
        fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out: out.write('COMMUNITY_HASH_SALT=' + secrets.token_hex(32) + '\n')
    try:
        shutil.copy2(release / 'deploy/gtnh-flow.service', UNIT)
        link(release)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', 'gtnh-flow')
        run('systemctl', 'restart', 'gtnh-flow')
        expected = json.loads((release / 'release.json').read_text())['version']
        deadline = time.monotonic() + 90
        while True:
            try:
                with urllib.request.urlopen('http://127.0.0.1:8792/api/version', timeout=3) as response:
                    assert json.load(response)['version'] == expected
                with urllib.request.urlopen('http://127.0.0.1:8792/', timeout=5) as response:
                    assert b'GTNH' in response.read()
                break
            except Exception:
                if time.monotonic() >= deadline: raise
                time.sleep(.5)
        write_atomic(CONF, (release / 'deploy/gtnh.krahsu.top.conf').read_text())
        nginx(['-t'])
        nginx(['-s', 'reload'])
        entries = json.loads(CATALOG.read_text())
        matches = [row for row in entries if row['id'] == 'gtnh']
        assert not matches or matches[0]['url'] == ENTRY['url'], 'Conflicting IAM entry'
        if matches: entries = [ENTRY if row['id'] == 'gtnh' else row for row in entries]
        else: entries.insert(next((i for i, row in enumerate(entries) if row['id'] == 'mj'), len(entries)), ENTRY)
        write_atomic(CATALOG, json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    except Exception:
        # Stop a first installation before removing its unit file. There may
        # be no unit yet if the failure happened while preparing it.
        if first:
            subprocess.run(['systemctl', 'disable', '--now', 'gtnh-flow'], check=False)
        for path in (CONF, UNIT, CATALOG):
            saved = backup / path.name
            if saved.exists(): shutil.copy2(saved, path)
            elif path in (CONF, UNIT) and path.exists(): path.unlink()
        if previous: link(previous)
        run('systemctl', 'daemon-reload')
        if not first: run('systemctl', 'restart', 'gtnh-flow')
        nginx(['-t'])
        nginx(['-s', 'reload'])
        raise
    print(json.dumps({'release': str(release), 'backup': str(backup), 'version': expected}))
