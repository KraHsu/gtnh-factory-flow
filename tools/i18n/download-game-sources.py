#!/usr/bin/env python3
"""Download the exact archives pinned in game-sources.lock.json, with resumable verified files."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request


def checksum(file, algorithm):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def download(url, target, algorithm, expected):
    if target.exists() and checksum(target, algorithm) == expected:
        print(f'Verified cached {target.name}', flush=True)
        return
    temporary = target.with_name(target.name + '.partial')
    for attempt in range(6):
        try:
            offset = temporary.stat().st_size if temporary.exists() else 0
            request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
            with urllib.request.urlopen(request, timeout=60) as response:
                append = offset and response.status == 206
                if append and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                    raise ValueError('Unexpected byte range')
                with temporary.open('ab' if append else 'wb') as output:
                    while data := response.read(1024 * 1024):
                        output.write(data)
            if checksum(temporary, algorithm) != expected:
                raise ValueError('Incomplete download or checksum mismatch')
            temporary.replace(target)
            print(f'Downloaded and verified {target.name}', flush=True)
            return
        except Exception:
            if attempt == 5:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    arguments = parser.parse_args()
    root = Path(arguments.directory)
    root.mkdir(parents=True, exist_ok=True)
    lock = json.loads(Path(__file__).with_name('game-sources.lock.json').read_text())
    for filename, source, algorithm, field in [
        ('gtnh-2.9.0-rc-2.zip', lock['modpack'], 'sha256', 'sha256'),
        ('minecraft-1.7.10.jar', lock['minecraft']['client'], 'sha1', 'sha1'),
        ('minecraft-zh_CN.lang', lock['minecraft']['chinese'], 'sha1', 'hash'),
        ('OrePrefixes.java', lock['gregtech']['orePrefixes'], 'sha256', 'sha256'),
    ]:
        download(source['url'], root / filename, algorithm, source[field])


if __name__ == '__main__':
    main()
