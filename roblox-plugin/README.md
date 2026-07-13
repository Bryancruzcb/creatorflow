# CreatorFlow for Roblox Studio

A Studio plugin that connects an animation team to a CreatorFlow registry over
HTTP. Select a `KeyframeSequence`, and the plugin:

1. serializes it to a canonical text form (`src/Serialize.luau`) — pose tree,
   CFrames, easing, markers — so identical content always fingerprints the same,
2. hashes that with pure-Luau SHA-256 (`src/Sha256.luau`),
3. sends **only the digest** to the server's existing registry API
   (`POST /api/v1/verify`) and shows the verdict: **DUPLICATE**, **SIMILAR**,
   or **CLEAR**, with the cross-account match evidence,
4. can register clean versions (`POST /api/v1/assets`) so the rest of the team
   checks against them from Studio, the desktop app, or the website.

It also solves the animation-ownership problem: the same animation gets a
**different Roblox id per uploader** (personal account vs. group), and only the
owner-matching id plays in a game. Pick an asset in the panel's registry list
and the plugin shows its recorded ids per ownership context (`group:12345 →
222`), detects which context the open place publishes under
(`game.CreatorType`/`CreatorId`), highlights the id that will actually work
here, and inserts it as an `Animation` instance in one click. Re-uploaded the
animation somewhere new? Save the fresh id under that context and the whole
team gets it.

The animation itself never leaves Studio — the same fingerprints-only contract
the desktop companion uses.

## Install

### With Rojo (recommended)

```bash
# from the repo root — writes the plugin straight into Studio's local plugins folder
rojo build roblox-plugin --plugin CreatorFlow.rbxm
```

Or build to a file and copy it yourself:

```bash
rojo build roblox-plugin --output CreatorFlow.rbxm
# then move CreatorFlow.rbxm into %LOCALAPPDATA%\Roblox\Plugins
```

### Without Rojo

In Studio: create a `Folder`, add a `Script` named `Main` plus `ModuleScript`s
named `Config`, `Api`, `Sha256`, `Serialize`, `Ui`; paste in the matching files
from `src/`; right-click the folder → **Save as Local Plugin**.

## First run

1. Start the server: `java -jar server/target/creatorflow-server-*.jar`
   (see the repo README; add `--creatorflow.demo-seed=true` for demo data).
2. Click the **CreatorFlow** toolbar button to open the panel.
3. Enter the base URL (default `http://localhost:8080`) and either paste the
   API key from the website's `/me` page or create a fresh account from the
   panel. Press **Connect** — Studio will ask you to grant this plugin HTTP
   permission for that domain the first time; allow it.
4. Select a `KeyframeSequence` (e.g. under `AnimSaves`, or export one from
   your animation editor) and press **Check originality**.

Notes on Studio HTTP: per-plugin HTTP permissions mean the game's
`HttpService.HttpEnabled` setting does not need to change. `localhost` works
in Studio only; a deployed/hosted registry needs a real domain.

## What's scaffold vs. done

Working now: connect/health, account creation, canonical fingerprinting of
KeyframeSequences, verify with match evidence, register, list your assets,
per-context Roblox id mappings with one-click insert of the id that plays in
the open place.

Deliberate next steps (server work included):

- **Team registries**: the API is per-account today; a shared team account
  works for a demo, real teams need memberships.
- **Version stacks from Studio**: register into an existing stack instead of
  always creating a new asset, so the website's compare/review flow applies.
- Toolbar icon (`rbxassetid://0` placeholder in `Main.server.luau`).
- Fingerprints for other asset types (meshes, audio) from Studio.
