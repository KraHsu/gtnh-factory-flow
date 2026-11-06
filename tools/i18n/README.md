# Game language packs

This pipeline adds a display overlay to the published GTNH dataset. Recipe IDs,
resource IDs, accepted ingredients, amounts and calculation data are unchanged.
The server search index returns canonical English objects and searches a separate
Chinese label field.

## Sources

- GTNH-Translations: the revision in the generated `provenance.json`. Chinese
  community translations override built-in translations by language key.
- Minecraft 1.7.10: the official client English language file and the Chinese
  asset pinned by the official asset index.
- GTNH 2.9.0-RC-2: language resources from every mod JAR in the official client
  pack, including nested built-in resource packs such as Et Futurum's vanilla
  names. No game code is run by the extractor.
- GregTech 5.09.54.205: the ore-prefix registry from the matching source tag.
  Only literal prefix/suffix declarations are extracted; Java code is not run.

`game-sources.lock.json` pins the archive and source hashes. The generated source
inventory records each JAR hash, metadata and any embedded license notices.
Minecraft, each mod and GTNH community translations retain their respective
terms; neither the application license nor the community translation license is
applied to third-party built-in game translations.

## Rebuild

Use Python 3.11+ and the project's Node environment. Downloads are verified,
resumable and cached; the client pack is about 700 MiB and stays outside git.

```sh
python3 tools/i18n/download-game-sources.py scratch/game-sources
python3 tools/i18n/extract-game-languages.py \
  scratch/game-sources/gtnh-2.9.0-rc-2.zip \
  scratch/game-sources/minecraft-1.7.10.jar \
  scratch/game-sources/minecraft-zh_CN.lang \
  scratch/game-sources/game-assets.json \
  --ore-prefixes scratch/game-sources/OrePrefixes.java \
  --credits public/i18n/gtnh/game-sources

node tools/i18n/build-gtnh-zh.mjs <pinned-GTNH-Translations-checkout> \
  <resource-index.json.gz> <recipe-lookup-index.json.gz> <datasets.manifest.json> \
  public/i18n/gtnh scratch/game-sources/game-assets.json
```

The dataset manifest and both indexes must come from the current published
dataset, not a fresh game export that could reorder recipes. A changed game
archive fails checksum validation before extraction. Updating source versions
requires reviewing the lock file and checking names against the dataset again.

## Matching rules

- Pair English and Chinese by language key. Scope names by mod domain before
  considering an unambiguous global match. Conflicting names remain English.
- Share a language key across domains only when its Chinese value is unique,
  following the legacy game's shared language registry.
- Expand official material/ore-prefix templates, TGregworks material placeholders,
  potion prefixes and spawn-egg names. Flavor text is not a material name.
- For ore dictionary placeholders, verify the planner's canonical generated
  label, then resolve its prefix/material through the pinned registry and check it
  against a concrete accepted item. Otherwise
  require all alternatives to agree on a translated name. Tool categories also
  require a corresponding accepted tool. Unknown categories remain English.
- Translate only the planner's exact generated ore-tooltip format, retaining
  original ore dictionary keys and all accepted item identities.
- Consume the known `remove_crystal` marker as the pinned game's formatter does
  when no Chinese inflection rule is supplied. Unsupported markers stay out of
  generated item names.

The coverage report separates translated game-tooltip lines from the planner's
generated ore-tooltip lines. Coverage counts resource entries, not distinct
English words. Proper names and identifiers such as TNT may correctly remain
unchanged. Some mods construct labels from code or data rather than language
files; complete coverage still needs a matching Chinese runtime export.

Run `npx vitest run tools/i18n` for parser, archive, override, ambiguity and
template checks. Before publishing, compare the canonical search index to the
previous release and verify a byte-identical rebuild of generated files.
