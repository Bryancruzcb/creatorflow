# Friend-test invite — copy-paste kit

Everything you need to schedule the live session. Written for you to send, not to hand over as-is.

## What you're asking for

**~45 minutes, screen-share or in person, with Roblox Studio open.** Ideally they bring their own
animations, because the test is only meaningful against assets Roblox actually lets *them* read.

**The one constraint people miss:** the bridge is loopback-only by design, so Studio and CreatorFlow
must run on the **same machine**. Two options:

- **They install it** (~10 min: JDK 24+, Maven, Node 20+ — [`FRIEND-TEST.md`](FRIEND-TEST.md) setup).
  Best fidelity: their machine, their Studio account, their assets.
- **They sign into Studio on your machine.** Zero setup, and the plugin still only reads what their
  account can access — which is the part being tested. Easier to schedule; pick this if installing
  is friction.

## The short ask (text / DM)

> hey — remember that Roblox tool I've been building? it's finally at the point where it needs
> someone who isn't me to try it. it checks whether an animation is safe to ship: what changed since
> your last good version, who actually owns it, and what to roll back to if an update breaks.
>
> could I borrow ~45 min sometime this week? you'd just open Studio, plug in a couple of your
> animation IDs, and tell me where it confuses you. honestly the confusing parts are the useful
> part — I want to find them before anyone else sees it. I can come to you or you can just sign into
> Studio on my laptop, whichever's easier.

## The longer version (Discord / email, if they want detail first)

> **What it is:** a preflight check for Roblox updates. Before you publish, it compares your changed
> assets against a snapshot of the last version that worked, flags anything missing evidence, and
> gives you a PASS/BLOCKED record naming exactly which version to roll back to. It runs entirely on
> the machine — nothing uploads, and it never publishes anything itself. Studio still does that.
>
> **What I need:** ~45 minutes with you and Studio. You'd pair it to a project, run a couple of your
> own animations through it, and try to produce a release. I'll mostly stay quiet and take notes.
>
> **What I need from you specifically:**
> - two animation asset IDs you can access (any KeyframeSequence animations you own)
> - if possible, one you *don't* own and one that's deleted or moderated — I need to see what the
>   error messages look like when things legitimately go wrong
> - a place you can publish, just so I can see the version number it hands back
>
> **What you get:** first look, and every complaint gets fixed. If it's useless I'd genuinely rather
> find that out now.

## Before they arrive (your 10 minutes)

1. `git pull` and build: `npm --prefix frontend ci && npm --prefix frontend run build` then
   `mvn install -DskipTests`.
2. Launch it once yourself and confirm the workspace opens:
   `mvn -pl desktop javafx:run -Dcreatorflow.web.root=<ABS>/frontend/dist -Dcreatorflow.web.open=true`
   (the URL is also printed to the console if no browser opens).
3. Have [`FRIEND-TEST.md`](FRIEND-TEST.md) open in another window — Part 1, then Part 2.
4. Open a blank text file for notes. **Write down their exact words when they get stuck**, not your
   interpretation of what they meant.
5. Optional but useful: paste an Open Cloud API key into Settings → Roblox Open Cloud beforehand, so
   the ownership step works during the session rather than eating time on setup.

## During: the only rule

**Do not help them.** When they hesitate, that hesitation *is* the result. Count to five before
saying anything. The single most valuable output of this session is the list of moments where a
person who didn't build it couldn't tell what to do next.

Capture results in the template at the bottom of [`FRIEND-TEST.md`](FRIEND-TEST.md).

## Afterwards

Fix only what the session surfaced, then the milestone is closed. Resist adding features because
they mentioned something cool — write those down separately and decide later.
