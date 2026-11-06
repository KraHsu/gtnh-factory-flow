import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('game_languages', Path(__file__).with_name('extract-game-languages.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LanguageExtractionTests(unittest.TestCase):
    def test_pinned_archives_nested_resourcepacks_and_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            minecraft, pack, chinese, prefixes = [root / name for name in ['mc.jar', 'pack.zip', 'zh.lang', 'OrePrefixes.java']]
            with zipfile.ZipFile(minecraft, 'w') as archive:
                archive.writestr('assets/minecraft/lang/en_US.lang', 'item.bottle.name=Glass Bottle')
            chinese.write_text('item.bottle.name=玻璃瓶')
            prefixes.write_text('new OrePrefixBuilder("plate").withSuffix(" Plate").build()')
            jar = io.BytesIO()
            with zipfile.ZipFile(jar, 'w') as archive:
                archive.writestr('resourcepacks/vanilla_overrides/assets/minecraft/lang/en_US.lang', 'tile.wood.name=Oak Planks')
                archive.writestr('resourcepacks/vanilla_overrides/assets/minecraft/lang/zh_CN.lang', 'tile.wood.name=橡木木板')
                archive.writestr('META-INF/LICENSE', 'fixture license')
                archive.writestr('../../escape.lang', 'never extracted')
                archive.writestr('Example.class', 'this is not executed')
            with zipfile.ZipFile(pack, 'w') as archive:
                archive.writestr('instance/.minecraft/mods/example.jar', jar.getvalue())
            lock = {'datasetVersion': '2.9.0-RC-2',
                    'modpack': {'sha256': module.checksum(pack, 'sha256')},
                    'minecraft': {'client': {'sha1': module.checksum(minecraft, 'sha1')},
                                  'chinese': {'hash': module.checksum(chinese, 'sha1')}},
                    'gregtech': {'orePrefixes': {'sha256': module.checksum(prefixes, 'sha256')}}}
            result, notices = module.extract(pack, minecraft, chinese, prefixes, lock)
            self.assertEqual(len(result['languages']), 2)
            self.assertEqual(result['languages'][1]['domain'], 'minecraft')
            self.assertIn('橡木木板', result['languages'][1]['zh'])
            self.assertEqual(result['orePrefixes'][0]['suffix'], ' Plate')
            self.assertEqual(list(notices.values()), [b'fixture license'])
            self.assertFalse((root.parent / 'escape.lang').exists())
            lock['modpack']['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                module.extract(pack, minecraft, chinese, prefixes, lock)


if __name__ == '__main__':
    unittest.main()
