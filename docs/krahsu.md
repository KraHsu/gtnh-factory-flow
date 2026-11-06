# KraHsu public deployment

This fork runs at https://gtnh.krahsu.top on **rain**. The IAM portal lists it as a
public tool. Neither the planner nor its assets require a session. Local plans stay
in the browser; JSON files and plan codes provide portable backups. Collaboration
rooms are a separate choice: IAM authenticates room owners, and guests join using
an eight-digit room number, password and nickname. Room plans persist on rain.
The community account, community database and account-wide cloud sync remain off.

## Project map and execution flow

- `src/app/page.tsx` mounts `FactoryPlannerApp`. The App Router also serves recipe
  APIs and optional community/library APIs.
- `FactoryPlannerApp` loads the manifest and dataset catalog through
  `src/lib/datasets/browser-loader.ts`; `ResourceIndexPane` queries resources and
  `RecipeBrowser` / `RecipeSearchOverlay` query recipes by item, machine and tier.
- A picked recipe enters `factory-store.ts`. Its project updates go through the
  store's history and `solveBooks`, then `calculateThroughput` or the solver worker.
  Plan mode uses HiGHS linear/integer optimization in WebAssembly. The resulting
  throughput, counts, power and constraints repaint the cards and overview rail.
- `FactoryFlow` owns React Flow nodes, camera, virtualization and routed wires.
  The UI does not derive recipe truth from labels or translations.
- `design-store.ts:saveActiveProject` persists the current canvas through the
  design library/storage modules. Imported plans open as new designs.
- `tools/dataset-pipeline` normalizes exports from an actual GTNH JVM. Its generated
  datasets are separate from the source repository and this release bundle.

## Languages and themes

The header switches between English and Simplified Chinese. The initial language
follows the browser; a saved choice takes precedence. `src/lib/i18n/index.ts` owns
language selection, cross-tab updates, English fallback and named interpolation.
`zh-CN.json` uses the English UI text as its keys. Use `useT()` in presentation
components; translate model labels where they are displayed, never where they are
used as identifiers. Missing strings fall back to English. Developer diagnostics and
older release notes retain the upstream language.

Game names and tooltips use a separate, versioned display pack under
`public/i18n/gtnh`. The default 2.9.0-RC-2 pack matches the published dataset hash.
It reuses the pinned GTNH-Translations English/Chinese language keys and official
material/ore-prefix templates. Ambiguous names and unrecognized text stay English.
The current pack resolves 48,733 of 67,718 resource names (72.0%) and 725 tooltip
lines on 179 resources; this is partial coverage, not a complete Chinese dataset.
The source revision, method, coverage and upstream terms accompany the pack, and
Help links to its attribution notice. Translations have their upstream terms;
they are not relicensed under this application's code license.

`game-catalog.ts` loads a matching pack lazily for Chinese, shares concurrent
requests and ignores stale loads after a dataset change. UI components opt into
`useDisplayT`; projects, history, calculations and exported recipes retain their
canonical values. A missing or mismatched pack falls back to English. Pure
explanation builders accept a translator and default to their English output.

Chinese item queries use `/api/i18n/<version>/resources`, backed by the local
resource index. The index retains original IDs, names and texture paths, and
supports kind, mod, crop/bee filters, pagination and production/use counts from
the matching recipe lookup index. English item queries still use the upstream
API. Recipe-book name filters translate confirmed Chinese aliases back to the
canonical English query. Unknown or ambiguous aliases are left unchanged.
Chinese search currently supports the default RC-2 dataset; older datasets use
English names and queries.

To rebuild, check out the GTNH-Translations revision recorded in `provenance.json`
and obtain the matching published resource and lookup indexes plus manifest:

```sh
node tools/i18n/build-gtnh-zh.mjs <translation-checkout> \
  <resource-index.json.gz> <recipe-lookup-index.json.gz> <datasets.manifest.json>
```

The builder writes a display pack, a compressed canonical search index, coverage,
source hashes and attribution. It does not regenerate recipes or recipe IDs.
For names that language-key matching cannot confirm, the next source is a
localized runtime export from the matching game instance. Do not guess labels by
resource IDs or replace a complete recipe export just to translate text.

The guided tour translates its notes, markup, controls and generated sample text.
Tour targets resolve translated labels or stable control identifiers rather than
English-only selectors. Public mode omits the unavailable community shelf and
explains browser saving and GitHub feedback. `tour/localization.test.tsx` checks
all conditional note variants, markup preservation, live language switching and
translated controls, alongside controls-list and board-help copy.

Language and theme preferences use separate localStorage keys, not the project
schema, history or solve settings. Switching either does not reload the page.
The Catppuccin palette, green accents and locally served Noto Serif SC font match
other KraHsu sites. Font alternatives remain available in Settings. The default
canvas follows the site theme; explicitly chosen board papers remain available.
The font distribution includes its OFL license, provenance and shard hashes.

## Build and publish

The room service requires Node 24 (rain uses its existing Node 24 runtime). Build on a workstation:

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=4
npm run test:icons:browsers
npm run build:rooms
NEXT_PUBLIC_SITE_URL=https://gtnh.krahsu.top \
NEXT_PUBLIC_PUBLIC_TOOL=1 \
NEXT_PUBLIC_ROOMS=1 \
GTNH_DATASET_BACKEND_URL=https://gtnhplanner.com npm run build
```

`NEXT_PUBLIC_PUBLIC_TOOL=1` hides unconfigured community/account actions, keeps the
local library and portable sharing, and sends feedback to this fork's issue tracker.
Build-time dataset rewrites proxy both `/api/datasets/*` and `/datasets/gtnh/*`
through the same origin. This deployment **depends on gtnhplanner.com for recipe
queries and textures**. A self-contained dataset may instead be installed under
`public/datasets/gtnh`, then rebuilt without `GTNH_DATASET_BACKEND_URL`.

Package `.next/standalone/` plus `public/`, `.next/static/`, `dist-live/rooms.mjs`, `deploy/`, `LICENSE`,
this document and `release.json` containing `version` and the source revision.
Upload to `/mnt/storage/gtnh-flow/releases/<release>/` and run:

```sh
sudo python3 <release>/deploy/install.py <release>
```

The installer backs up the old current link, nginx configuration, unit and IAM
catalog under `/mnt/storage/gtnh-flow/backups/`. It starts the candidate on
127.0.0.1:8792, verifies `/api/version` and `/`, validates nginx, then publishes
HTTPS and registers the public IAM entry without replacing other services. On
failure it restores those files and the prior service. It creates a private
session-signing salt on rain; secrets are never packaged or committed.

The service is `gtnh-flow.service`; HTTPS uses the existing automatically renewed
wildcard certificate. The existing wildcard DNS resolves this hostname to rain.
No authentication policy or other site's gateway is changed.
The public gateway strips Cookie and Authorization headers before the planner,
so the shared IAM session cookie is never forwarded to the dataset provider.
Only `/api/rooms` goes to the room process with the browser cookie. `/live` goes
to that process with WebSocket upgrade support and no cookie or Authorization.

## Persistent rooms

The header's Rooms key opens Join room, Create room and My rooms. Creation copies
the current plan into a separate design; it never turns the original local plan
into a shared plan. All participants, including the IAM owner, choose a nickname.
Guests need no account. The owner can list and explicitly close their rooms after
IAM authentication. Closing a browser or leaving a room never closes the room.

`gtnh-rooms.service` runs `dist-live/rooms.mjs` on loopback port 8793 with Node 24.
Its SQLite database and operation journals live under `/mnt/storage/gtnh-flow/rooms`
outside release directories. This directory is private to the service user and is
never included in an application release. SQLite uses WAL and FULL synchronization;
the existing live engine journals operations before acknowledging them, flushes
plans at most every eight seconds, and replays journals on startup. Idle rooms
leave memory but remain in SQLite, without an automatic expiration date.

`src/live/rooms` provides the room store, HTTP admission and IAM verification. It
adapts the existing `PlanStore` and `LiveService`; the operations and wire protocol
used by the upstream game remain unchanged. IAM owner requests validate only the
`__Secure-krahsu-iam` cookie against the loopback Authelia endpoint and its protected
IAM portal policy. Client identity headers and application community cookies never
grant ownership. No IAM credentials reach the game dataset service.

Passwords use salted scrypt; neither room listings nor admission responses include
the password or its hash. Creation requires 8–128 password characters. Nicknames
accept 1–24 characters and reject control characters. A successful admission issues
a random room-scoped credential stored as a hash on the server. The browser keeps
the credential in sessionStorage, sends it as a WebSocket subprotocol rather than
in a URL, and restores it on reload. Credentials last 24 hours; participants then
join again with their password and nickname. The room itself does not expire.

The UI uses the existing live client, pending-operation recovery, inverse-based
undo and cursor layer. Each participant sees other nicknamed cursors in board
coordinates without moving anyone else's camera. Moving a cursor only updates the
presence layer, never the project or solve. Concurrent changes to different fields
merge; changes to the same field use server arrival order. This is not character-by-
character collaborative text editing.

Room creation and joining are rate limited, room credentials cannot access another
room, and closing a room immediately disconnects its participants. The initial
service admits up to 20 rooms in memory, 100 stored rooms per owner, and 100 unexpired
participant credentials per room. It uses a 384 MiB Node heap and a 512 MiB systemd
memory cap. The web process retains its separate cap.

For local development, start the room process with an absolute `GTNH_ROOMS_DIR`,
`GTNH_ROOMS_PORT` and `LIVE_ALLOWED_ORIGINS`. Set `NEXT_PUBLIC_ROOMS=1`,
`NEXT_PUBLIC_LIVE_URL=ws://127.0.0.1:<room-port>/live`, and
`GTNH_ROOMS_BACKEND_URL=http://127.0.0.1:<room-port>` for Next.js. Production uses the
nginx routes and needs neither development URL. Production has no mock IAM path.

`src/live/rooms/rooms.test.ts` drives real sockets and an on-disk database through
owner disconnects, guest editing, cursor presence, crash recovery, duplicate batch
replays, room isolation, expired credentials, leaving, closing, origin checks and
IAM verification. `src/store/live-session.test.ts` also covers anonymous room clients.

## Operations and rollback

```sh
ssh rain 'sudo systemctl status gtnh-flow --no-pager'
ssh rain 'sudo systemctl status gtnh-rooms --no-pager'
ssh rain 'sudo journalctl -u gtnh-flow -n 50 --no-pager'
curl -fsS https://gtnh.krahsu.top/api/version
```

To return to an earlier release, pass its directory to the current installer,
including when the earlier release predates rooms. The installer stops the room
service for such a release and preserves its data for a later upgrade. For
first-install removal, stop/disable `gtnh-flow`, remove only its dedicated nginx
file and IAM catalog entry, run nginx validation and reload. Keep the backups and
browser plan data. IAM loads its catalog for each request, so adding this public
entry requires no restart of the identity service.
