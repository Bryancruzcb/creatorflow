# Adding animation rigs to the Motion Lab

The Animation-compare view loads a rigged, animated glTF (`.glb`) and lets you compare its clips.
It ships with one rig (the CC0 RobotExpressive) but is built to hold several — this doc covers
**where to get a new rig** (especially an anime one) and **how to plug it in**.

---

## Part 1 — What "VRoid + Mixamo" is, in plain terms

Your friend's anime game needs two things: an **anime character** (the model + its skeleton) and
**animations** (walk, run, attack…). Almost nobody hand-builds both. The standard, mostly-free
anime pipeline splits the job across three tools:

| Tool | What it does | Cost / license |
| --- | --- | --- |
| **VRoid Studio** | Point-and-click *anime character* creator. You sculpt the face, hair, outfit; it outputs a fully-rigged model as a `.vrm` file (which is just a `.glb` with extra anime metadata). | Free. Its license explicitly allows **selling games** made with characters you create. |
| **Mixamo** (Adobe) | A library of thousands of ready-made humanoid **animations**. You upload a character (or use theirs), pick animations, and it auto-rigs and retargets them. | Free, royalty-free **in a project**. ⚠️ You may **not** redistribute the raw animation files on their own. |
| **Blender** | Free 3D editor. Used to **retarget** Mixamo's animations onto your VRoid character and **export one `.glb`** with the model + all its clips baked in. | Free (GNU GPL). |

**The flow:** VRoid makes the anime body → Mixamo supplies the motions → Blender glues them
together and exports a single animated `.glb` → that file drops into a game engine (or into
CreatorFlow's Motion Lab).

### Step-by-step (what *you* would do to source an anime rig)

1. **Make the character** — Install [VRoid Studio](https://vroid.com/en/studio) (free). Build an
   anime character, then **Export → VRM**. You now have `character.vrm`.
2. **Get animations** — Go to [mixamo.com](https://www.mixamo.com) (free Adobe account). Because
   Mixamo wants an FBX, the easy path is to upload your character (or pick one of Mixamo's) and
   add several clips — e.g. *Idle*, *Walking*, *Running*, *Jump*, an *Attack*. Download each as
   **FBX for Unity (.fbx)**, "Without Skin" once you have the base.
3. **Combine in Blender** — In [Blender](https://www.blender.org/) (free), import the VRM (the
   [VRM add-on](https://vrm-addon-for-blender.info/en/) helps), import the Mixamo FBX animations,
   **retarget** them onto the VRoid skeleton, then **File → Export → glTF 2.0 (.glb)** with
   *Include → Animations* checked. You now have one `anime-character.glb` holding the model and
   every clip.

> Truthfully this is fiddly the first time (bone-name mismatches are the usual snag). Budget an
> afternoon. The [gamefromscratch VRoid+Blender walkthrough](https://gamefromscratch.com/easy-anime-character-creation-with-vroid-studio-and-blender/)
> and the [VRoid→Mixamo tutorial](https://elvneko.com/posts/vroid-blender-mixamo/) are good.

### The CC0 shortcut (no Blender)

If you don't want the whole pipeline, **[Mesh2Motion](https://mesh2motion.org/)** is **CC0**
(free for anything, no attribution) and exports a rig **with multiple animations straight to
`.glb`** in one step. Its characters are stylized rather than strictly anime, but it's the
fastest way to a legal, drop-in second rig.

---

## Part 2 — Licensing, so nobody gets burned

CreatorFlow is a **public** GitHub repo, so anything committed here is redistributed to everyone
who clones it. That draws a hard line:

- ✅ **CC0** (public domain) and **CC-BY** (free, needs a credit) assets can live in this repo.
  The existing RobotExpressive (CC0) and the Khronos sample models (CC-BY) are fine.
- ❌ **Mixamo** animations **cannot** be committed here — they're royalty-free *inside a project*
  but can't be redistributed as standalone files, and a `.glb` in a public repo counts as that.

So: a **VRoid + Mixamo** rig is perfect for **your friend's own game** (that's "in a project"),
but for **CreatorFlow's demo** use a **CC0** rig (Mesh2Motion, or a CC0 avatar), or a VRoid
character paired with **non-Mixamo** CC0 animations. When in doubt, CC0 is always safe.

---

## Part 3 — How a rig plugs into the Motion Lab

Rigs live in a registry (`frontend/src/motion/rigFixtures.ts`). Adding one is a data entry plus
dropping the `.glb` into `frontend/public/assets/`:

```ts
{
  id: 'anime-hero',
  name: 'Anime hero',
  glbUrl: '/assets/anime-hero.glb',
  license: 'CC0 1.0',                 // or 'CC-BY 4.0 — Creator Name'
  attribution: 'Made in VRoid Studio; animations from Mesh2Motion (CC0)',
  defaultPair: ['Idle', 'Walking'],
  clips: [                            // one entry per animation clip in the .glb
    { name: 'Idle', category: 'Locomotion', description: 'Looping neutral', priority: 'Idle', looped: true },
    { name: 'Walking', category: 'Locomotion', description: 'Walk cycle', priority: 'Movement', looped: true },
    // …
  ],
}
```

**The only thing that must match exactly** is each `clip.name` — it has to equal the animation
name inside the `.glb` (Blender/Mixamo set these). If you tell me the clip names when you drop the
file in, I'll wire the registry entry and pick similarity scenarios that span the range.

> Anime rigs are usually *heavier* — more bones (face, hair, skirt, twist bones) and denser
> keyframes — which the evidence panel happily shows as more tracks and joints. That's a feature
> to show off, not a problem.
