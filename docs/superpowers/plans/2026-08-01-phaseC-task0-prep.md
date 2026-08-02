---
type: task0-prep
project: CreatorFlow
phase: C
date: 2026-08-02
---

# Phase C Task 0 — pre-Studio research prep

> **DECIDED 2026-08-02 — the `KeyframeSequenceProvider` shortcut is a NO-GO.** A second,
> deliberately adversarial 4-agent probe ruled it out on evidence before spending any
> Studio time on it. See "Decision: the provider shortcut is ruled out" at the bottom of
> this document. Consequences already applied here: **Script 6 and open questions 7 and 8
> are struck**, and **Script 5 (Position × Rotation composition order) is promoted** to
> first among the real-asset scripts, since it is now the only remaining unknown that can
> invalidate the design.

## What the research settled

All four agents independently sourced these from the same primaries (create.roblox.com engine reference + the `Roblox/creator-docs` YAML source of truth + robloxapi dumps). Treat these as safe to write code against.

**The sampling methods exist and are documented.** This is the single most important result, and it inverts the risk the spec assumed. Task 0 Step 2's core question — "can we read a value at an arbitrary time?" — is **answered yes, at high confidence, from official docs**, not guessed. Phase C's fixed-interval sampling design is buildable as specced.

**Class hierarchy**
- `CurveAnimation` → `AnimationClip` → `Instance` → `Object`. `CurveAnimation` defines **zero** members of its own. No `GetCurves()`, no `GetChannels()`, no clip-level `GetValueAtTime`. The only way in is walking `GetChildren()`/`GetDescendants()`.
- `AnimationClip` declares exactly three scriptable members, shared with `KeyframeSequence`: `Length` (float, ReadOnly, seconds), `Loop` (bool), `Priority` (`Enum.AnimationPriority`).

**Task 0 Step 3 is answered — no fallback needed.** `clip.Loop` and `clip.Priority.Name` work verbatim on a `CurveAnimation` because they live on `AnimationClip`, not on `KeyframeSequence`. `normalizeCurveAnimation` reads them exactly as `normalizeKeyframeSequence` does (`CreatorFlowAnimationBridge.lua:791-792`), and `probePlayability`'s `declaredLooped` gets a real value, not a guess. The Step 3 contingency in the design spec (lines 127-143) can be struck.

**Instance tree under a clip** (verbatim from `CurveAnimation.yaml`)
- `CurveAnimation` → nested `Folder`s named after joints, mirroring the `Motor6D`/`Bone` hierarchy.
- Under a joint folder: an instance **named** `Position` of type `Vector3Curve`, and/or an instance **named** `Rotation` of type **either** `EulerRotationCurve` **or** `RotationCurve`. Both optional. Branch on `:IsA()` — assuming one rotation type silently drops half the clips in the wild.
- Partial hierarchies are legal ("the first child `Folder` instance root can be `UpperTorso`"). The tree is **not** guaranteed to start at the rig root, and not all joints need be present.
- FaceControls/FACS live in the same clip: a `Folder` named after a `FaceControls` instance, containing **bare `FloatCurve`s** named after FaceControls properties. A naive joint walker will emit garbage joints for these. Must be classified and skipped.
- Joint resolution is by **hierarchy position**, same convention as `Pose` (parent name = `Part0`, node name = `Part1`) — staff-confirmed on devforum 2908039, where the engine's own duplicate-name resolution was a bug fixed ~April 2024. Resolve by full path, never by name lookup. This maps 1:1 onto `appendPose`'s existing `parentPath .. "/" .. segment` scheme (`CreatorFlowAnimationBridge.lua:700-712`).

**Exact evaluation signatures** (note the method name differs per class — this is the trap)
```
Vector3Curve:GetValueAtTime(time: number) -> {any}     -- ARRAY of 3 numbers; elements can be nil
Vector3Curve:X() / :Y() / :Z()            -> FloatCurve -- CREATES an empty child if absent (mutates!)

EulerRotationCurve:GetRotationAtTime(time: number) -> CFrame   -- NOT GetValueAtTime
EulerRotationCurve:GetAnglesAtTime(time: number)   -> {any}    -- 3 angles; nil per missing channel
EulerRotationCurve.RotationOrder                   -> Enum.RotationOrder
EulerRotationCurve:X() / :Y() / :Z()               -> FloatCurve (same create-if-absent)

RotationCurve:GetValueAtTime(time: number) -> CFrame?          -- NULLABLE
RotationCurve.Length -> int (KEY COUNT), :GetKeys(), :GetKeyAtIndex(i), :GetKeyIndicesAtTime(t)

FloatCurve:GetValueAtTime(time: number) -> number?             -- NULLABLE
FloatCurve.Length -> int (KEY COUNT), :GetKeys(), :GetKeyAtIndex(i), :GetKeyIndicesAtTime(t)
```
Use `GetRotationAtTime`, not `GetAnglesAtTime`: it returns a `CFrame` directly, applies `RotationOrder` for you, and treats missing channels as zero — which sidesteps the undocumented radians-vs-degrees question entirely.

**Two naming traps**
- `FloatCurve.Length` and `RotationCurve.Length` are **key counts (int)**. `AnimationClip.Length` is **seconds (float)**. Same word, different meaning, one letter apart in the code.
- `Vector3Curve` and `EulerRotationCurve` have **no `Length` property at all** — key counts only via their child `FloatCurve`s.
- For read-only inspection use `FindFirstChild("X")`, **not** `:X()`. `:X()` creates and parents an empty `FloatCurve` if none exists, mutating the fetched clip.

**Easing and weight — the spec's defaults are correct and now sourced**
- The entire curve interpolation vocabulary is `Enum.KeyInterpolationMode`: `Constant=0`, `Linear=1`, `Cubic=2`, plus per-key `LeftTangent`/`RightTangent`. No `EasingStyle`, no `EasingDirection`, no Bounce/Elastic (deliberately replaced with generated curves). Emitting `"Linear"` per sampled pose is the honest choice; any mapping onto `PoseEasingStyle` would be inventing precision.
- **No weight channel exists anywhere in `CurveAnimation`.** Four independent searches found none. `weight = 1` is correct and must be documented as synthesized, not read.

**Markers have a home, but not a documented address.** The curve-side class is `MarkerCurve` (`Length` int, `GetMarkers()`, `GetMarkerAtIndex(i)`, `InsertMarkerAtTime(t, s)`, `RemoveMarkerAtIndex(i, n)`; 64 printable chars max). Its **location inside the clip tree is undocumented** — absent from a description that otherwise enumerates the hierarchy in detail. Discover with `IsA("MarkerCurve")` over descendants; never hardcode a path. The shape difference matters: `MarkerCurve` gives a flat `{time, value}` list, so marker times will not land on sample boundaries and must be carried as an independent timestamped list rather than snapped onto synthesized keyframes.

**`GetAnimationClipAsync` returns the concrete subtype.** It does not normalize — hence the current hard-reject at `CreatorFlowAnimationBridge.lua:809-818` is genuinely dropping legitimate assets. Also confirmed: `AnimationClipProvider:RegisterAnimationClip(clip) -> ContentId` generates a temporary in-Studio ID, which means test fixtures need no upload and no Robux.

**Two known engine defects that will bite regardless of curve support**
- `AnimationClip.Length` returns **0 until the clip is fully loaded**. A sampler that derives sample count from `clip.Length` can silently produce zero samples. This is a latent bug in the existing `KeyframeSequence` path too.
- `GetAnimationClipAsync` returns an **empty clip** if the same animation was loaded via `Animator:LoadAnimation` first (devforum 3092648). Fetch before loading, and retry once on empty. Phase B's `probePlayability` **plays the clip** — so ordering inside `compareButton.Activated` matters.

---

## What still needs live Studio confirmation

Phrased as questions a command-bar script answers. Numbers map to the scripts below.

1. **Does the fetched hierarchy actually look like the docs describe?** Folder-per-joint, `Position`/`Rotation` children, and where does a `MarkerCurve` sit? Zero official sources show a real explorer tree. → Script 1
2. **Are `CurveAnimation`/`Vector3Curve`/`EulerRotationCurve`/`FloatCurve` `Instance.new`-creatable?** Only a third-party API dump implies yes. If no, the synthetic-fixture plan dies and every test needs an authored upload. → Script 2
3. **What do `GetValueAtTime`/`GetRotationAtTime` return outside `[firstKey.Time, lastKey.Time]`?** Clamp, extrapolate, or `nil`? **Undocumented in every source checked.** The sampler hits `t=0` and `t=clip.Length` on every single clip, so this is not an edge case. → Script 3
4. **Is `GetRotationAtTime`'s returned CFrame rotation-only (zero `.Position`)?** Assumed, never stated. → Script 3
5. **Is sampling bit-identical run-to-run, and does 6-decimal rounding absorb any drift?** This is Task 0 Step 4, and it decides whether `CURVE_SAMPLED` sides get excluded from snapshot pinning. → Script 4
6. **How do `Position` and `Rotation` compose into the joint transform — `CFrame.new(p) * rot` or `rot * CFrame.new(p)`?** The docs say only that one "drives local translation" and the other "drives local rotation". Composition order is **stated nowhere**. Every sampled CFrame is wrong if this is backwards, and it will be wrong in a way that still produces plausible-looking numbers. → Script 5
7. ~~**Does `KeyframeSequenceProvider:GetKeyframeSequenceAsync` bake a `CurveAnimation` into a `KeyframeSequence` for you?**~~ **STRUCK 2026-08-02 — answered NO-GO on evidence without needing Studio.** The bake is real (the engine warning is verbatim-confirmed) but provably lossy at the schema level and undocumented in its sampling density, which for a comparison tool is disqualifying. See the decision section at the bottom.
8. ~~**Does `AnimationClipProvider:GetClipEvaluatorAsync` offer a cleaner sampling surface?**~~ **STRUCK 2026-08-02.** A code search across all of `Roblox/creator-docs` returns exactly one hit: a YAML entry with an empty summary and empty description. Both doc pages 404; the robloxapi page is a members-less stub. There are no published members to call.
9. **Is any public asset ID actually a `CurveAnimation`?** See below — none confirmed. → Script 7
10. **What sample rate fits under `MAX_POSES = 20000` for a real rig?** Task 0 Step 5. → Script 8
11. **Do animation event markers survive the Studio KeyframeSequence→CurveAnimation conversion at all?** Devforum reports of marker listeners silently failing post-conversion suggest historically lossy. → Script 1 + Script 6
12. **What does the rig's `AnimSaves` folder contain after a Curve Editor conversion** — still a `KeyframeSequence`, or a `CurveAnimation`? Undocumented, and it determines whether Script 1 has anything to select. → observe during authoring

---

## Getting a CurveAnimation to test with

**No public asset ID was confirmed to be a `CurveAnimation`.** One agent downloaded and grepped the actual asset binaries for Roblox's defaults (507770239, 507766666, 891636393, 891627522), the R15 face animation 10714340543, and four first-party catalog emotes as recent as the Chappell Roan one — **every single one is a `KeyframeSequence`.** UGC emotes are 401-gated to unauthenticated requests and remain untested. Do not plan around finding one.

**A. Author one (canonical route, highest confidence, gives a real uploadable asset)**
1. Avatar tab → **Rig Builder** → insert an R15 dummy into Workspace.
2. Select the rig → Avatar tab → **Animation Editor** → name the animation.
3. Pose a limb at 2-3 keyframes so there is real data. Add one animation event/marker so you can test marker survival.
4. **Click the Curve Editor icon at the top-left of the timeline. Press Confirm.** That toggle *is* the conversion — there is no "export as CurveAnimation" menu item.
5. Look in `ServerStorage` → `AnimSaves` and record what class the saved object now is (open question 12).
6. `⋯` → **Publish to Roblox** → title → **Save** → copy the asset ID from the Asset Configuration window.

Know what this costs you: the conversion is **one-way**, Studio's own dialog warns it "may not work with third party Studio Plugins" (that is literally CreatorFlow today), quaternions are permanently converted to Euler angles, and **Studio adds extra keyframes**. A Phase C bake of a converted clip will not diff clean against its original `KeyframeSequence` — do not use that as a correctness test.

**B. Synthetic, zero-upload (60 seconds — run this first to unblock scripts 1/3/4)**
`Instance.new` the tree by hand, then `AnimationClipProvider:RegisterAnimationClip(clip)` for a temporary content ID that feeds straight into the existing `GetAnimationClipAsync` code path. Documented explicitly on the `CurveAnimation` page as the preview mechanism. Gated on open question 2 — Script 2 checks creatability and builds the fixture in one paste.

**C. UGC emote lottery (Script 7)** — free candidates pulled live from the catalog API: `111231750028642`, `135289014127213`, `87189246230399`, `97704244629766`, `114493689389624`. These are emote *wrapper* assets (AssetTypeId 61); if the direct fetch fails, `InsertService:LoadAsset` and read the inner `Animation.AnimationId`. Low odds — treat as a bonus.

**D. Reference implementation** — free plugin "Curve Animation To Keyframe Converter" by Kriosynic, asset `13376563175`, claims marker + facial support. Plugin source is inspectable after install. This is someone else's working curve→pose bake; read it before writing yours.

---

## Ready-to-paste Studio scripts

Every script is defensive: anything at medium/low confidence is `pcall`-probed and **printed**, never assumed. If a method name is wrong you get a line saying so instead of a stack trace.

**Run order (revised 2026-08-02):** `2 → 1 → 3 → 4 → 8` on a synthetic fixture to get
moving, then against a real uploaded asset run **5 first** (composition order — now the
only remaining unknown that can invalidate the design, so it should fail fast if it's
going to), then repeat `1 → 3 → 4 → 8`, then 7 as a bonus. If Script 2 says the classes
are not creatable, author first (section A) and start at 1.

**Script 6 is struck** — the `KeyframeSequenceProvider` shortcut it tested was ruled out
on evidence 2026-08-02 without needing Studio. It is left in place below, marked, purely
so the reasoning is visible; do not run it.

---

**1. What is actually in the tree, and which members really exist on each node.** Select a `CurveAnimation` in Explorer, or set `ASSET_ID`.

```lua
local ASSET_ID = 0 -- numeric asset id, or 0 to use the current Explorer selection
local ACP = game:GetService("AnimationClipProvider")
local clip
if ASSET_ID ~= 0 then
	local ok, res = pcall(function() return ACP:GetAnimationClipAsync("rbxassetid://" .. ASSET_ID) end)
	if not ok then warn("[CF] fetch failed: " .. tostring(res)) return end
	clip = res
else
	clip = game:GetService("Selection"):Get()[1]
end
if not clip then warn("[CF] No clip. Select one in Explorer or set ASSET_ID.") return end

local MEMBERS = {"Length","Loop","Priority","RotationOrder","Value","GetValueAtTime",
	"GetRotationAtTime","GetAnglesAtTime","GetKeys","GetKeyAtIndex","GetKeyIndicesAtTime",
	"GetMarkers","GetMarkerAtIndex","InsertKey","SetKeys","X","Y","Z"}

local function members(inst)
	local out = {}
	for _, n in ipairs(MEMBERS) do
		local ok, v = pcall(function() return inst[n] end)
		if ok and v ~= nil then out[#out + 1] = n .. ":" .. typeof(v) end
	end
	return table.concat(out, " ")
end

print("[CF] clip =", clip:GetFullName(), "| ClassName =", clip.ClassName,
	"| IsA AnimationClip =", clip:IsA("AnimationClip"),
	"| IsA CurveAnimation =", clip:IsA("CurveAnimation"),
	"| IsA KeyframeSequence =", clip:IsA("KeyframeSequence"))
for _, n in ipairs({"Length", "Loop", "Priority"}) do
	local ok, v = pcall(function() return clip[n] end)
	print(string.format("[CF] clip.%s -> ok=%s value=%s type=%s", n, tostring(ok), tostring(v), ok and typeof(v) or "-"))
end

local census = {}
local function dump(inst, depth)
	census[inst.ClassName] = (census[inst.ClassName] or 0) + 1
	print(string.rep("| ", depth) .. inst.Name .. "   [" .. inst.ClassName .. "]   " .. members(inst))
	for _, c in ipairs(inst:GetChildren()) do dump(c, depth + 1) end
end
dump(clip, 0)
print("[CF] descendants =", #clip:GetDescendants())
for cls, n in pairs(census) do print("[CF] census:", cls, n) end
for _, d in ipairs(clip:GetDescendants()) do
	if d:IsA("MarkerCurve") then
		print("[CF] MarkerCurve FOUND at:", d:GetFullName(), "Length =", tostring(d.Length))
		local ok, m = pcall(function() return d:GetMarkers() end)
		print("[CF]   GetMarkers ->", ok, ok and ("count=" .. tostring(#m)) or tostring(m))
		if ok and typeof(m) == "table" then
			for i, entry in ipairs(m) do
				if typeof(entry) == "table" then
					local ks = {}
					for k, v in pairs(entry) do ks[#ks + 1] = tostring(k) .. "=" .. tostring(v) end
					print("[CF]   marker[" .. i .. "] " .. table.concat(ks, " "))
				else
					print("[CF]   marker[" .. i .. "] " .. typeof(entry) .. " " .. tostring(entry))
				end
			end
		end
	end
end
```

---

**2. Are the curve classes creatable, and does a hand-built clip survive `RegisterAnimationClip`?** Leaves a fixture in `ServerStorage` for scripts 1/3/4/8.

```lua
local ACP = game:GetService("AnimationClipProvider")
local SS = game:GetService("ServerStorage")
for _, cls in ipairs({"CurveAnimation","Vector3Curve","EulerRotationCurve","RotationCurve","FloatCurve","MarkerCurve"}) do
	local ok, inst = pcall(Instance.new, cls)
	print("[CF] Instance.new", cls, "->", ok, ok and inst.ClassName or tostring(inst))
	if ok then inst:Destroy() end
end

local okClip, clip = pcall(Instance.new, "CurveAnimation")
if not okClip then warn("[CF] CurveAnimation NOT creatable -- authoring route required. " .. tostring(clip)) return end
clip.Name = "CF_Fixture"
print("[CF] set Loop ->", pcall(function() clip.Loop = true end))
print("[CF] set Priority ->", pcall(function() clip.Priority = Enum.AnimationPriority.Action end))

local torso = Instance.new("Folder"); torso.Name = "UpperTorso"; torso.Parent = clip
local joint = Instance.new("Folder"); joint.Name = "RightUpperArm"; joint.Parent = torso
local pos = Instance.new("Vector3Curve"); pos.Name = "Position"; pos.Parent = joint
local rot = Instance.new("EulerRotationCurve"); rot.Name = "Rotation"; rot.Parent = joint

local LIN = Enum.KeyInterpolationMode.Linear
local function key(curve, axis, t, v)
	local ok, res = pcall(function() return curve[axis](curve):InsertKey(FloatCurveKey.new(t, v, LIN)) end)
	local shown = (typeof(res) == "table") and (tostring(res[1]) .. "/" .. tostring(res[2])) or tostring(res)
	print(string.format("[CF] InsertKey %s.%s t=%s v=%s -> ok=%s res=%s", curve.Name, axis, tostring(t), tostring(v), tostring(ok), shown))
end
key(pos, "X", 0, 0); key(pos, "X", 1, 4)
key(pos, "Y", 0, 0); key(pos, "Y", 1, 0)
key(rot, "Y", 0, 0); key(rot, "Y", 1, math.pi / 2)

clip.Parent = SS
print("[CF] fixture at", clip:GetFullName(), "| Length =", tostring(clip.Length))

local okReg, id = pcall(function() return ACP:RegisterAnimationClip(clip) end)
print("[CF] RegisterAnimationClip ->", okReg, tostring(id))
if okReg then
	local okGet, back = pcall(function() return ACP:GetAnimationClipAsync(id) end)
	print("[CF] refetch ->", okGet, okGet and back.ClassName or tostring(back))
	if okGet then
		back.Name = "CF_Fixture_Refetched"
		back.Parent = SS
		print("[CF] refetched: Length =", tostring(back.Length), "Loop =", tostring(back.Loop),
			"Priority =", tostring(back.Priority and back.Priority.Name), "descendants =", #back:GetDescendants())
		print("[CF] >>> now run script 1 on CF_Fixture_Refetched and diff it against CF_Fixture")
	end
end
```

---

**3. What the evaluation methods return in range, out of range, and whether angles are radians.**

```lua
local ASSET_ID = 0
local ACP = game:GetService("AnimationClipProvider")
local clip
if ASSET_ID ~= 0 then
	local ok, res = pcall(function() return ACP:GetAnimationClipAsync("rbxassetid://" .. ASSET_ID) end)
	if not ok then warn("[CF] fetch failed: " .. tostring(res)) return end
	clip = res
else
	clip = game:GetService("Selection"):Get()[1]
end
if not clip then warn("[CF] select a clip or set ASSET_ID") return end

local function fmt3(a)
	if typeof(a) ~= "table" then return typeof(a) .. ":" .. tostring(a) end
	return "{" .. tostring(a[1]) .. ", " .. tostring(a[2]) .. ", " .. tostring(a[3]) .. "}"
end
local function rotClose(a, b)
	local ca, cb = {a:GetComponents()}, {b:GetComponents()}
	for i = 4, 12 do if math.abs(ca[i] - cb[i]) > 1e-4 then return false end end
	return true
end

local len = 0
pcall(function() len = clip.Length end)
local maxKey = 0
for _, d in ipairs(clip:GetDescendants()) do
	local ok, keys = pcall(function() return d:GetKeys() end)
	if ok and typeof(keys) == "table" then
		for _, k in ipairs(keys) do
			local okT, t = pcall(function() return k.Time end)
			if okT and typeof(t) == "number" and t > maxKey then maxKey = t end
		end
	end
end
print("[CF] clip.Length =", len, "| max key time across all curves =", maxKey)
local span = (len > 0) and len or maxKey
if span <= 0 then span = 1 end
local times = { -0.25, 0, span * 0.5, span, span + 0.25 }

for _, d in ipairs(clip:GetDescendants()) do
	if d.Name == "Position" or d.Name == "Rotation" or d:IsA("FloatCurve") then
		print("[CF] ---- " .. d:GetFullName() .. "  [" .. d.ClassName .. "]")
		for _, t in ipairs(times) do
			local okV, v = pcall(function() return d:GetValueAtTime(t) end)
			print(string.format("   t=%8.4f  GetValueAtTime   ok=%s  %s", t, tostring(okV), okV and fmt3(v) or tostring(v)))
			local okR, r = pcall(function() return d:GetRotationAtTime(t) end)
			if okR then
				print(string.format("   t=%8.4f  GetRotationAtTime %s   .Position=%s  (expect 0,0,0 if rotation-only)",
					t, tostring(r), tostring(typeof(r) == "CFrame" and r.Position or "n/a")))
			end
			local okA, a = pcall(function() return d:GetAnglesAtTime(t) end)
			if okA then print(string.format("   t=%8.4f  GetAnglesAtTime  %s", t, fmt3(a))) end
			if okR and okA and typeof(r) == "CFrame" and typeof(a) == "table" and a[1] and a[2] and a[3] then
				local order = "?"
				pcall(function() order = d.RotationOrder.Name end)
				local asRad = CFrame.fromEulerAnglesXYZ(a[1], a[2], a[3])
				local asDeg = CFrame.fromEulerAnglesXYZ(math.rad(a[1]), math.rad(a[2]), math.rad(a[3]))
				print(string.format("      RotationOrder=%s | radians-hypothesis=%s | degrees-hypothesis=%s  (only conclusive when order is XYZ)",
					order, tostring(rotClose(r, asRad)), tostring(rotClose(r, asDeg))))
			end
		end
	end
end
```

---

**4. Task 0 Step 4: is sampling deterministic — raw, and after the plugin's 1e-6 rounding?** Run twice in one session, then restart Studio and run again; compare the printed hashes.

```lua
local ASSET_ID = 0
local ACP = game:GetService("AnimationClipProvider")
local SCALE = 1000000
local function fetch()
	if ASSET_ID ~= 0 then
		local ok, res = pcall(function() return ACP:GetAnimationClipAsync("rbxassetid://" .. ASSET_ID) end)
		return ok and res or nil
	end
	return game:GetService("Selection"):Get()[1]
end
local clip = fetch()
if not clip then warn("[CF] select a clip or set ASSET_ID") return end

local function raw(x) if typeof(x) ~= "number" then return "nil" end return string.format("%.17g", x) end
local function rnd(x)
	if typeof(x) ~= "number" then return "nil" end
	if x ~= x or x == math.huge or x == -math.huge then return "NONFINITE" end
	local r = (x >= 0) and (math.floor(x * SCALE + 0.5) / SCALE) or (math.ceil(x * SCALE - 0.5) / SCALE)
	return string.format("%.17g", r)
end
local function snapshot(c, f)
	local len = 0
	pcall(function() len = c.Length end)
	if len <= 0 then len = 1 end
	local ds = c:GetDescendants()
	table.sort(ds, function(a, b) return a:GetFullName() < b:GetFullName() end)
	local parts = {}
	for _, d in ipairs(ds) do
		for i = 0, 30 do
			local t = (i / 30) * len
			local okV, v = pcall(function() return d:GetValueAtTime(t) end)
			if okV then
				local s
				if typeof(v) == "table" then s = f(v[1]) .. "," .. f(v[2]) .. "," .. f(v[3]) else s = f(v) end
				parts[#parts + 1] = d:GetFullName() .. "|V|" .. i .. "|" .. s
			end
			local okR, r = pcall(function() return d:GetRotationAtTime(t) end)
			if okR and typeof(r) == "CFrame" then
				local comp = {r:GetComponents()}
				local s = {}
				for j = 1, 12 do s[j] = f(comp[j]) end
				parts[#parts + 1] = d:GetFullName() .. "|R|" .. i .. "|" .. table.concat(s, ",")
			end
		end
	end
	return table.concat(parts, ";")
end
local function hash(s)
	local h = 2166136261
	for i = 1, #s do h = (bit32.bxor(h, string.byte(s, i)) * 16777619) % 4294967296 end
	return string.format("%08x/%d", h, #s)
end

local a_raw, a_rnd = snapshot(clip, raw), snapshot(clip, rnd)
local b_raw, b_rnd = snapshot(clip, raw), snapshot(clip, rnd)
print("[CF] same object, RAW identical    :", a_raw == b_raw)
print("[CF] same object, ROUNDED identical:", a_rnd == b_rnd)
local fresh = fetch()
if fresh and fresh ~= clip then
	local c_raw, c_rnd = snapshot(fresh, raw), snapshot(fresh, rnd)
	print("[CF] re-fetched clip, RAW identical    :", a_raw == c_raw)
	print("[CF] re-fetched clip, ROUNDED identical:", a_rnd == c_rnd)
end
print("[CF] RAW HASH     :", hash(a_raw))
print("[CF] ROUNDED HASH :", hash(a_rnd))
print("[CF] >>> record both hashes, restart Studio, run again. Rounded hash must match for snapshot pinning to be allowed.")
```

---

**5. The undocumented one: how do Position and Rotation compose into the joint transform?** Insert an R15 Rig Builder dummy into Workspace, press **Run (F5)**, then paste this into the Run-mode command bar.

```lua
local ACP = game:GetService("AnimationClipProvider")
local rig
for _, m in ipairs(workspace:GetChildren()) do
	if m:IsA("Model") and m:FindFirstChildWhichIsA("Humanoid", true) then rig = m break end
end
if not rig then warn("[CF] no rig with a Humanoid in Workspace") return end
local hum = rig:FindFirstChildWhichIsA("Humanoid", true)
local animator = hum:FindFirstChildWhichIsA("Animator") or Instance.new("Animator", hum)

local TARGET_PART1 = "RightUpperArm"   -- R15; use "Right Arm" for R6
local PARENT_NAME  = "UpperTorso"      -- R15; use "Torso" for R6
local motor
for _, d in ipairs(rig:GetDescendants()) do
	if d:IsA("Motor6D") and d.Part1 and d.Part1.Name == TARGET_PART1 then motor = d break end
end
if not motor then warn("[CF] no Motor6D whose Part1 is " .. TARGET_PART1) return end
print("[CF] motor:", motor:GetFullName(), "Part0 =", motor.Part0.Name, "Part1 =", motor.Part1.Name)

local P, ANG = 4, math.pi / 2
local clip = Instance.new("CurveAnimation")
clip.Name = "CF_ComposeProbe"
local a = Instance.new("Folder"); a.Name = PARENT_NAME; a.Parent = clip
local b = Instance.new("Folder"); b.Name = TARGET_PART1; b.Parent = a
local pos = Instance.new("Vector3Curve"); pos.Name = "Position"; pos.Parent = b
local rot = Instance.new("EulerRotationCurve"); rot.Name = "Rotation"; rot.Parent = b
local LIN = Enum.KeyInterpolationMode.Linear
for _, t in ipairs({0, 1}) do
	pcall(function() pos:X():InsertKey(FloatCurveKey.new(t, P, LIN)) end)
	pcall(function() rot:Y():InsertKey(FloatCurveKey.new(t, ANG, LIN)) end)
end

local okReg, id = pcall(function() return ACP:RegisterAnimationClip(clip) end)
if not okReg then warn("[CF] RegisterAnimationClip failed: " .. tostring(id)) return end
local anim = Instance.new("Animation"); anim.AnimationId = id
local okT, track = pcall(function() return animator:LoadAnimation(anim) end)
if not okT then warn("[CF] LoadAnimation failed: " .. tostring(track)) return end
track:Play()
task.wait(0.4)

local function close(x, y)
	local cx, cy = {x:GetComponents()}, {y:GetComponents()}
	for i = 1, 12 do if math.abs(cx[i] - cy[i]) > 1e-3 then return false end end
	return true
end
local p = CFrame.new(P, 0, 0)
local r = CFrame.fromEulerAnglesXYZ(0, ANG, 0)
local observed = motor.Transform
print("[CF] Motor6D.Transform observed =", tostring(observed))
print("[CF] candidate A  CFrame.new(pos)*rot =", tostring(p * r), " MATCH =", close(observed, p * r))
print("[CF] candidate B  rot*CFrame.new(pos) =", tostring(r * p), " MATCH =", close(observed, r * p))
print("[CF] track.Looped =", track.Looped, "| track.Priority =", tostring(track.Priority), "| clip.Length =", tostring(clip.Length))
track:Stop()
```

If neither candidate matches, print `observed` and reconstruct by hand — do **not** ship a bake until one of them matches exactly.

---

**6. ~~Could the engine do the whole bake for us, and does a ClipEvaluator exist?~~ — STRUCK 2026-08-02, DO NOT RUN.** Ruled out on evidence without Studio (see the decision section at the bottom). Kept only so the reasoning stays visible.

```lua
local ASSET_ID = 0 -- real uploaded CurveAnimation id
if ASSET_ID == 0 then warn("[CF] set ASSET_ID to a real uploaded CurveAnimation") return end
local KSP = game:GetService("KeyframeSequenceProvider")
local ACP = game:GetService("AnimationClipProvider")

local ok, ks = pcall(function() return KSP:GetKeyframeSequenceAsync("rbxassetid://" .. ASSET_ID) end)
print("[CF] GetKeyframeSequenceAsync ->", ok, ok and ks.ClassName or tostring(ks))
if ok and ks:IsA("KeyframeSequence") then
	local kfs = ks:GetKeyframes()
	table.sort(kfs, function(x, y) return x.Time < y.Time end)
	print("[CF] ENGINE BAKE WORKS. keyframes =", #kfs, "| Loop =", tostring(ks.Loop), "| Priority =", ks.Priority.Name)
	if #kfs > 0 then
		print("[CF] time range:", kfs[1].Time, "->", kfs[#kfs].Time)
		local gaps = {}
		for i = 2, math.min(#kfs, 6) do gaps[#gaps + 1] = string.format("%.6f", kfs[i].Time - kfs[i-1].Time) end
		print("[CF] first gaps (bake density):", table.concat(gaps, ", "))
		local total, markers = 0, 0
		local function count(p) total = total + 1 for _, s in ipairs(p:GetSubPoses()) do count(s) end end
		for _, p in ipairs(kfs[1]:GetPoses()) do count(p) end
		for _, k in ipairs(kfs) do markers = markers + #k:GetMarkers() end
		print("[CF] poses on first keyframe (recursive) =", total, "| markers surviving bake =", markers)
		for _, p in ipairs(kfs[1]:GetPoses()) do
			print("   pose", p.Name, "Weight =", p.Weight, "Easing =", p.EasingStyle.Name, p.EasingDirection.Name, "CFrame =", tostring(p.CFrame))
		end
	end
end

local okE, ev = pcall(function() return ACP:GetClipEvaluatorAsync("rbxassetid://" .. ASSET_ID) end)
print("[CF] GetClipEvaluatorAsync ->", okE, okE and typeof(ev) or tostring(ev))
if okE then
	print("[CF] evaluator =", tostring(ev), typeof(ev) == "Instance" and ev.ClassName or "")
	for _, n in ipairs({"Evaluate","GetValueAtTime","GetPoseAtTime","SetTime","Update","Length","Reset"}) do
		local okM, v = pcall(function() return ev[n] end)
		print("   member", n, "->", okM, okM and typeof(v) or "-")
	end
end
```

---

**7. Is any public asset ID actually a CurveAnimation?**

```lua
local IDS = {111231750028642, 135289014127213, 87189246230399, 97704244629766, 114493689389624,
	118775787227492, 96797913078430, 98130875587194, 121070246722198}
local ACP = game:GetService("AnimationClipProvider")
local IS = game:GetService("InsertService")
for _, id in ipairs(IDS) do
	local ok, clip = pcall(function() return ACP:GetAnimationClipAsync("rbxassetid://" .. id) end)
	if ok then
		print("[CF]", id, "direct ->", clip.ClassName, "| Length =", tostring(clip.Length),
			clip:IsA("CurveAnimation") and "  <<<<< CURVE ANIMATION" or "")
	else
		print("[CF]", id, "direct FAILED:", tostring(clip))
		local okL, model = pcall(function() return IS:LoadAsset(id) end)
		if okL then
			for _, d in ipairs(model:GetDescendants()) do
				if d:IsA("Animation") then
					local inner = d.AnimationId
					local ok2, c2 = pcall(function() return ACP:GetAnimationClipAsync(inner) end)
					print("[CF]", id, "wrapper -> inner", inner, "->", ok2, ok2 and c2.ClassName or tostring(c2),
						(ok2 and c2:IsA("CurveAnimation")) and "  <<<<< CURVE ANIMATION" or "")
				end
			end
			model:Destroy()
		else
			print("[CF]", id, "LoadAsset failed:", tostring(model))
		end
	end
end
```

---

**8. Task 0 Step 5: what sample rate fits under `MAX_POSES = 20000`, and which folders are FaceControls traps?**

```lua
local ASSET_ID = 0
local MAX_POSES = 20000
local ACP = game:GetService("AnimationClipProvider")
local clip
if ASSET_ID ~= 0 then
	local ok, res = pcall(function() return ACP:GetAnimationClipAsync("rbxassetid://" .. ASSET_ID) end)
	if not ok then warn("[CF] fetch failed: " .. tostring(res)) return end
	clip = res
else
	clip = game:GetService("Selection"):Get()[1]
end
if not clip then warn("[CF] select a clip or set ASSET_ID") return end

local joints, face, other = 0, 0, {}
for _, d in ipairs(clip:GetDescendants()) do
	if d:IsA("Folder") then
		local hasPR = d:FindFirstChild("Position") or d:FindFirstChild("Rotation")
		if hasPR then
			joints = joints + 1
			for _, c in ipairs(d:GetChildren()) do
				if c.Name ~= "Position" and c.Name ~= "Rotation" and not c:IsA("Folder") then
					other[#other + 1] = d:GetFullName() .. "/" .. c.Name .. " [" .. c.ClassName .. "]"
				end
			end
		else
			local bareFloats = 0
			for _, c in ipairs(d:GetChildren()) do if c:IsA("FloatCurve") then bareFloats = bareFloats + 1 end end
			if bareFloats > 0 then
				face = face + 1
				print("[CF] SUSPECTED FaceControls folder (skip in walker):", d:GetFullName(), bareFloats, "FloatCurves")
			end
		end
	end
end
local len = 0
pcall(function() len = clip.Length end)
print(string.format("[CF] joint folders = %d | facecontrols folders = %d | clip.Length = %s", joints, face, tostring(len)))
for _, s in ipairs(other) do print("[CF] UNEXPECTED child under a joint folder:", s) end
if joints == 0 then warn("[CF] zero joint folders -- walker assumptions are wrong, re-read script 1 output") return end
for _, hz in ipairs({15, 24, 30, 60}) do
	local samples = math.floor((len > 0 and len or 1) * hz) + 1
	print(string.format("[CF] %2d Hz -> %d samples x %d joints = %d poses (limit %d) %s | max clip length at this rate: %.1f s",
		hz, samples, joints, samples * joints, MAX_POSES,
		(samples * joints) <= MAX_POSES and "OK" or "OVER LIMIT", MAX_POSES / joints / hz))
end
```

Arithmetic to expect (not research — check it against the script's output): R15 has ~15-16 animatable joints, so 30 Hz allows ~41 s of clip and 60 Hz allows ~20 s before `MAX_POSES` trips; R6's 6 joints allow ~111 s at 30 Hz. Most Roblox clips are under 10 s, so 30 Hz is comfortable with a client-side pre-check, exactly as the design spec's error-handling section requires.

---

## Confidence assessment

This de-risked Task 0 substantially more than expected. Steps 2 and 3 — the two the spec called the gate — are effectively answered from documentation: the read API is real, the method names are confirmed from the YAML source of truth by four independent agents, and `Loop`/`Priority` live on the shared `AnimationClip` base so the spec's elaborate Step 3 contingency is dead weight. What survives is a short list of genuinely undocumented things, and only one of them can invalidate the design: **the Position × Rotation composition order** (Script 5), which is unstated everywhere and will produce plausible-but-wrong CFrames if guessed. Realistic worst case in Studio is not "the API doesn't exist" — it's a slow start: `Instance.new` on the curve classes turns out to be blocked, so every test needs an authored-and-published asset, and the Curve Editor conversion is fiddly enough that Step 1 eats an hour before any of scripts 3-6 can run. Second-worst is Script 4 finding sampling non-deterministic even after 1e-6 rounding, which doesn't kill the phase but does force the snapshot-pinning lockout in both the frontend and `LocalBridgeServer`. The genuine upside case is Script 6: if `KeyframeSequenceProvider` really does bake curves faithfully, most of the Phase C implementation plan can be deleted in favor of a provider swap — run Script 6 early, because it is the cheapest test with the largest possible payoff.
---

## Decision: the provider shortcut is ruled out (2026-08-02)

A second, deliberately adversarial 4-agent probe investigated one question: could Phase C
skip the hand-written sampler by relying on `KeyframeSequenceProvider`'s auto-conversion?
**Verdict: no-go, decided on evidence, without spending Studio time.**

The premise was not imaginary — the engine warning is real and verbatim-confirmed:
*"Using deprecated KeyframeSequenceProvider to load the CurveAnimation \"<name>\".
Automatically converting it to a KeyframeSequence, but this will be slow."* A bake exists.
It is still the wrong thing to build on:

1. **Lossy at the schema level, provably.** Curve keys carry `Enum.KeyInterpolationMode`
   (Constant/Linear/Cubic) plus independent `LeftTangent`/`RightTangent` floats, *per
   channel* — a `Vector3Curve` is three `FloatCurve`s that may disagree. The target
   `PoseBase` declares only one `EasingStyle`/`EasingDirection` for the pose's single
   CFrame. Two tangent floats per key per channel have nowhere to land, and X cannot ease
   differently from Y. (`PoseEasingStyle.Cubic` is itself deprecated with a known
   editor-vs-runtime direction bug.)
2. **The bake's sample density and time grid are undocumented everywhere** — four agents
   searched the docs site, the creator-docs YAML, robloxapi, and the DevForum search API.
   For a comparison tool the time grid *is* the contract: an opaque grid on one side means
   a native-KeyframeSequence side and a baked-curve side are scored on different grids
   with different interpolation semantics, and the similarity number silently absorbs that
   pipeline difference as if it were motion difference. There is no field in the output to
   disclose it.
3. **Documented silent-empty failure on this exact API family.** A staff-acknowledged,
   still-unfixed caching bug returns an empty `KeyframeSequence` on a repeat fetch of the
   same asset ID. CreatorFlow fetches two assets per comparison, and
   `roblox-plugin/desktop-bridge/README.md:129` specifically requires that a
   `CurveAnimation` never be *"treated as empty data."*
4. **Official language points away, twice.** `KeyframeSequenceProvider` is deprecated with
   *"does not support the newer `Class.AnimationClip`"*; Studio's own conversion dialog
   warns curve clips *"may not work with third party Studio Plugins"* — which is exactly
   what CreatorFlow is.
5. **It wouldn't save the work it appears to.** Roblox staff explicitly recommend
   `Vector3Curve:GetValueAtTime` / `EulerRotationCurve:GetRotationAtTime`, which do the
   tangent math internally. The "hand-written sampler" is a loop over a grid *we choose* —
   not a Hermite implementation.

**Counter-evidence, recorded honestly:** one accepted DevForum answer (Feb–Mar 2026) shows
a developer successfully using `KeyframeSequenceProvider` on a curve animation and reading
keyframes *and their markers*. So the path probably does return populated data. That
raises the odds the bake "works" and changes nothing about points 1–4 — it was used to
recover marker *times*, not pose CFrames for scoring.

**Net effect on the plan:** it stands as written and gets slightly smaller. Task 0 Steps
2/4/5 remain the gate; Step 3 stays dead weight (`Loop`/`Priority` live on the shared
`AnimationClip` base); Task 1 Step 3's `normalizeCurveAnimation` is confirmed as the right
approach by staff recommendation; Task 2 Step 16's snapshot-pinning guard is unaffected
(still gated on Script 4's determinism finding); and
`CreatorFlowAnimationBridge.lua:797` keeps using `AnimationClipProvider:GetAnimationClipAsync`,
which is documented to handle a clip *"regardless of the underlying type"* — only line
810's hard-reject becomes the dispatch, exactly as Task 1 Step 1 already specified.
