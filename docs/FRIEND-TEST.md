# Friend test — Roblox animation preflight, first real run

The single highest-value next step (see `ROBLOX_WORKFLOW_RESEARCH.md`, "Product
boundary for the friend test"): one animator pairs Roblox Studio to a local
CreatorFlow project, reads two animations they can actually access, compares
them, and saves the evidence. Fix only blockers found here before building more.

## The one constraint people miss

The bridge is **loopback-only by design**: Roblox Studio and the CreatorFlow
desktop app must run on the **same machine**. So either install both on the
friend's machine, or run the session on yours with the friend signed into
Studio (the plugin can only read animations the signed-in Studio user has
access to — that's the point of the test).

## Setup (one time, ~10 minutes)

Requires JDK 21+, Maven, Node 20+.

```bash
git clone https://github.com/Bryancruzcb/creatorflow.git && cd creatorflow
npm --prefix frontend ci && npm --prefix frontend run build
mvn install -DskipTests
```

(`-DskipTests` only because core's symlink test needs elevated privileges on
Windows; CI runs the full suite.)

## Run the desktop workspace

```bash
mvn -pl desktop javafx:run -Djavafx.options="-Dcreatorflow.web.root=<ABSOLUTE-PATH>/frontend/dist -Dcreatorflow.web.open=true"
```

The browser workspace opens on a `http://127.0.0.1:<port>` URL. Pick or create
a local project, then create a **plugin pairing** — you'll get the endpoint URL
and an 8-hour token.

## Install the Studio plugin

Follow `roblox-plugin/desktop-bridge/README.md` (paste
`CreatorFlowAnimationBridge.lua` into a Script, right-click → **Save as Local
Plugin**). Enable *Plugin Debugging Enabled* — the README's update flow depends
on it even though it says optional.

In the plugin panel: paste the endpoint (either `127.0.0.1` or `localhost`
spelling works as of commit `1f138d1`) and the token, press **Test
connection**, and allow the HTTP-permission prompt Studio raises.

## The actual test

1. Enter two Animation IDs the signed-in user can access. Compare. Confirm the
   comparison lands in the desktop workspace's evidence history.
2. Now deliberately break things and **write down the exact error copy** — this
   is the data the next build step needs:
   - an animation ID the user does NOT own (wrong owner / private)
   - a deleted or moderated ID
   - deny the HTTP permission prompt, then recover
   - restart the desktop app mid-session (old token must fail, fresh one works)
   - a very dense baked clip (the server caps at 2,000 keyframes — the plugin
     does not pre-check this; note what the failure looks like)
3. Run the full manual checklist at the bottom of the plugin README.

## What "success" means

The friend can pair, compare, and understand every failure message without
help. Anything they stumble on is the next work item — resist adding features
until this loop is smooth.
