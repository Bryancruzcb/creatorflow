--!nonstrict
-- CreatorFlow Animation Bridge v0.1
--
-- Reads two Roblox animation assets available to the current Studio session,
-- converts KeyframeSequence pose data into a deterministic local interchange
-- format, and submits it to the CreatorFlow desktop app on loopback only.

local HttpService = game:GetService("HttpService")
local AnimationClipProvider = game:GetService("AnimationClipProvider")

local SCHEMA = "creatorflow.roblox-motion/v0.1"
local HEALTH_PATH = "/plugin/v1/health"
local COMPARE_PATH = "/plugin/v1/motion-comparisons"
local MAX_REQUEST_BYTES = 2 * 1024 * 1024
local MAX_POSES = 20000
-- Mirrors MAX_MOTION_KEYFRAMES in LocalBridgeServer.java. Checked here so a clip that would be
-- refused by the desktop app fails while the person is still looking at Studio, with a sentence
-- naming the actual limit, instead of coming back as a bare 400 after a full sample-and-send.
local MAX_SAMPLED_KEYFRAMES = 2000
local ROUNDING_SCALE = 1000000

local SETTINGS = {
	endpoint = "CreatorFlow.AnimationBridge.Endpoint.v1",
	token = "CreatorFlow.AnimationBridge.Token.v1",
	sourceId = "CreatorFlow.AnimationBridge.SourceId.v1",
	candidateId = "CreatorFlow.AnimationBridge.CandidateId.v1",
}

local COLORS = {
	background = Color3.fromRGB(15, 18, 24),
	surface = Color3.fromRGB(23, 28, 37),
	surfaceRaised = Color3.fromRGB(30, 36, 47),
	border = Color3.fromRGB(53, 62, 78),
	text = Color3.fromRGB(239, 243, 249),
	muted = Color3.fromRGB(157, 168, 186),
	accent = Color3.fromRGB(246, 173, 62),
	accentText = Color3.fromRGB(27, 23, 17),
	success = Color3.fromRGB(77, 211, 145),
	warning = Color3.fromRGB(250, 191, 72),
	error = Color3.fromRGB(249, 104, 104),
}

local function create(className, properties, parent)
	local instance = Instance.new(className)
	for property, value in pairs(properties) do
		(instance :: any)[property] = value
	end
	instance.Parent = parent
	return instance
end

local function addCorner(parent, radius)
	create("UICorner", { CornerRadius = UDim.new(0, radius) }, parent)
end

local function addStroke(parent, color, transparency)
	return create("UIStroke", {
		Color = color,
		Transparency = transparency or 0,
		Thickness = 1,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	}, parent)
end

local function trim(value)
	return string.match(value or "", "^%s*(.-)%s*$") or ""
end

local function roundNumber(value, label)
	if value ~= value or value == math.huge or value == -math.huge then
		error(string.format("%s contains a non-finite number", label), 0)
	end

	if value >= 0 then
		return math.floor(value * ROUNDING_SCALE + 0.5) / ROUNDING_SCALE
	end
	return math.ceil(value * ROUNDING_SCALE - 0.5) / ROUNDING_SCALE
end

local function safeGetSetting(key, fallback)
	local ok, value = pcall(function()
		return plugin:GetSetting(key)
	end)
	if ok and type(value) == "string" then
		return value
	end
	return fallback
end

local function safeSetSetting(key, value)
	local ok, message = pcall(function()
		plugin:SetSetting(key, value)
	end)
	if not ok then
		warn("CreatorFlow could not save a plugin setting: " .. tostring(message))
	end
end

local function normalizeEndpoint(rawEndpoint)
	local endpoint = trim(rawEndpoint)
	while string.sub(endpoint, -1) == "/" do
		endpoint = string.sub(endpoint, 1, -2)
	end

	local host, port = string.match(endpoint, "^http://([^/:]+):(%d+)$")
	if not host or not port then
		error("Use the loopback URL shown by CreatorFlow, for example http://127.0.0.1:49152.", 0)
	end
	if host ~= "127.0.0.1" and host ~= "localhost" then
		error("CreatorFlow only accepts a loopback endpoint (127.0.0.1 or localhost).", 0)
	end

	local numericPort = tonumber(port)
	if not numericPort or numericPort < 1 or numericPort > 65535 then
		error("The CreatorFlow endpoint has an invalid port.", 0)
	end
	return endpoint
end

local function normalizeAssetId(rawId, label)
	local assetId = trim(rawId)
	if not string.match(assetId, "^%d+$") then
		error(label .. " must be a numeric Roblox animation asset ID.", 0)
	end
	return assetId
end

local function errorText(value)
	local text = tostring(value)
	text = string.gsub(text, "^.-:%d+:%s*", "")
	return text
end

local InsertService = game:GetService("InsertService")

local RIG_ASSET_IDS = {
	R6 = 0, -- TODO: insert a stock R6 dummy via Studio's Avatar tab -> Rig Builder, copy its asset ID here
	R15 = 0, -- TODO: same, for R15
}

local rigCache = {}

local function fetchStandardRig(rigType)
	if rigCache[rigType] then
		return rigCache[rigType]
	end
	local ok, model = pcall(function()
		return InsertService:LoadAsset(RIG_ASSET_IDS[rigType])
	end)
	if not ok or not model then
		return nil
	end
	local rig = model:FindFirstChildWhichIsA("Model")
	if rig then
		rig.Parent = nil
	end
	model:Destroy()
	rigCache[rigType] = rig
	return rig
end

--- First-occurrence-order dedup. normalizeKeyframeSequence collects one marker name per
--- occurrence across all keyframes; a marker authored on several keyframes (or repeated on
--- purpose) must only appear once in the declared list, or probePlayability's "did every
--- declared marker fire at least once" check would demand N fires for a marker that only
--- ever needs to fire once.
local function dedupeMarkerNames(names)
	local seen = {}
	local unique = {}
	for _, name in ipairs(names) do
		if not seen[name] then
			seen[name] = true
			table.insert(unique, name)
		end
	end
	return unique
end

local function Playability_selfTest()
	local passed = true
	local deduped = dedupeMarkerNames({ "a", "b", "a", "c", "b" })
	if #deduped ~= 3 or deduped[1] ~= "a" or deduped[2] ~= "b" or deduped[3] ~= "c" then
		warn("[CreatorFlow] Playability self-test FAILED: dedupeMarkerNames did not dedupe in first-occurrence order.")
		passed = false
	end
	local emptyResult = dedupeMarkerNames({})
	if type(emptyResult) ~= "table" or #emptyResult ~= 0 then
		warn("[CreatorFlow] Playability self-test FAILED: dedupeMarkerNames did not return an empty table for empty input.")
		passed = false
	end
	return passed
end

if not Playability_selfTest() then
	warn("[CreatorFlow] Playability self-test failed — marker/report logic may be broken; playability checks will still run but their results may be unreliable.")
end

-- Sample rate for CurveAnimation clips, chosen against the three hard limits below. The first two
-- are stated for an R15-shaped rig (16 joint paths) with BOTH sides of a comparison curve-sampled
-- in one body; the third counts keyframes, so it does not care how many joints a clip carries:
--   MAX_REQUEST_BYTES: 2 MiB / ~250 B per JSON-encoded pose = ~8300 poses per request
--     -> ~4150 per side / 16 joints = ~260 samples -> ~13 s per clip.
--   MAX_POSES: 20000 per clip / 16 joints = 1250 samples -> ~62 s per clip.
--   MAX_SAMPLED_KEYFRAMES: 2000 samples -> ~100 s per clip, whatever the channel count.
-- Which one binds first depends on how many channels the clip carries, because only the third
-- counts samples rather than poses. On a full rig the byte ceiling binds (~13 s at 16 joints); it
-- stays tighter than MAX_POSES throughout, so that limit never actually decides. On a sparse clip
-- -- a prop, a door, two joints -- 2000 samples arrive long before 2 MiB does, and below roughly
-- four sampled channels (fewer when both sides are sampled) the keyframe cap is the real ceiling
-- at ~100 s. That sparse case is why it is checked at all: it is the one shape of clip that clears
-- both of the other two limits and is still refused by the desktop app.
-- 13 s covers Roblox emote/attack/idle clips (1-5 s) several times over; 30/s would cut that
-- byte ceiling to ~8 s per clip, and 15/s buys ~17 s at 67 ms resolution. 50 ms per sample is
-- already far denser than the handful of keyframes an authored KeyframeSequence carries over
-- the same span, which is the fidelity bar a sampled clip has to clear to compare against one.
--
-- FROZEN once sampled snapshots exist, for the same reason ROUNDING_SCALE is. This number is part
-- of the fingerprint identity of every CURVE_SAMPLED clip: change it and every sampled clip
-- fingerprints differently, so each pinned sampled snapshot reports CHANGED on an asset nobody
-- touched — drift detection lying in the one direction that costs a person real time. Retuning it
-- is therefore not a tuning change: it needs an algorithmVersion bump and a re-pin of every
-- sampled snapshot, decided deliberately.
--
-- Be exact about what that bump buys: MotionSnapshots.classify compares fingerprints and never
-- reads algorithmVersion, so bumping it prevents nothing mechanically. After a retune the first
-- re-pin of each sampled snapshot reports CHANGED regardless — the bump is a record for whoever
-- reads the ledger, not a guard. Budget one false CHANGED per pinned sampled snapshot as the
-- price of the decision.
local CURVE_SAMPLES_PER_SECOND = 20

--- Sample grid for one clip: 0, a sample every 1/CURVE_SAMPLES_PER_SECOND, and the exact end.
--- The end sample REPLACES the last stepped one when the two sit closer together than
--- roundNumber's resolution: a 0.5 s clip's tenth accumulated step lands on 0.49999999999999994,
--- which rounds to the same 0.5 the appended end does, and the desktop bridge rejects an
--- animation carrying two keyframes at the same time.
local function sampleTimesFor(duration)
	if duration <= 0 then
		return { 0 }
	end
	local times = {}
	local step = 1 / CURVE_SAMPLES_PER_SECOND
	local t = 0
	while t < duration do
		table.insert(times, t)
		t += step
	end
	if duration - times[#times] < 1 / ROUNDING_SCALE then
		times[#times] = duration
	else
		table.insert(times, duration)
	end
	return times
end

--- How many samples sampleTimesFor(duration) would emit, WITHOUT building the grid.
--- Pure arithmetic on purpose: this answers the question before a table exists, so a clip whose
--- Length is minutes (or nonsense) is refused instead of allocating a multi-million entry table on
--- the way to the error. The stepped count is ceil(duration/step); the exact end sample is appended
--- unless it lands inside roundNumber's resolution of the last stepped one, in which case
--- sampleTimesFor replaces that one and the count does not grow. Pinned by the self-test below.
local function sampleCountFor(duration)
	if duration <= 0 then
		return 1
	end
	local step = 1 / CURVE_SAMPLES_PER_SECOND
	local stepped = math.ceil(duration / step)
	if duration - (stepped - 1) * step < 1 / ROUNDING_SCALE then
		return stepped
	end
	return stepped + 1
end

local function CurveSampling_selfTest()
	local passed = true
	local times = sampleTimesFor(0)
	if #times ~= 1 or times[1] ~= 0 then
		warn("[CreatorFlow] Curve sampling self-test FAILED: sampleTimesFor(0) must return a single 0 sample.")
		passed = false
	end
	local nonEmpty = sampleTimesFor(1)
	if #nonEmpty < 2 or nonEmpty[1] ~= 0 or nonEmpty[#nonEmpty] ~= 1 then
		warn("[CreatorFlow] Curve sampling self-test FAILED: sampleTimesFor(1) must start at 0 and end at the duration.")
		passed = false
	end
	-- 0.5 s is the duration that catches a missing end-sample guard, where an unguarded grid
	-- emits two samples that round onto the same keyframe time.
	local previous = nil
	for _, time in ipairs(sampleTimesFor(0.5)) do
		local rounded = roundNumber(time, "sample time")
		if previous ~= nil and rounded <= previous then
			warn("[CreatorFlow] Curve sampling self-test FAILED: sample times must stay distinct and increasing after rounding.")
			passed = false
			break
		end
		previous = rounded
	end
	-- The keyframe-cap pre-check trusts sampleCountFor to answer for a grid it never builds, so the
	-- two have to agree. Small durations only: the whole point of the formula is that the guard
	-- never materializes a long one, and materializing one here to prove it would defeat that.
	for _, duration in ipairs({ 0, 0.02, 0.1, 0.5, 1, 1.05, 2, 3.3 }) do
		if sampleCountFor(duration) ~= #sampleTimesFor(duration) then
			warn(string.format(
				"[CreatorFlow] Curve sampling self-test FAILED: sampleCountFor(%s) = %d but the grid has %d samples.",
				tostring(duration),
				sampleCountFor(duration),
				#sampleTimesFor(duration)
			))
			passed = false
			break
		end
	end
	return passed
end

if not CurveSampling_selfTest() then
	warn("[CreatorFlow] Curve sampling self-test failed — sampled CurveAnimation comparisons may be unreliable.")
end

local PLAYABILITY_MAX_WAIT_SECONDS = 10 -- from the Task 0 spike: enough for a non-looping clip to
                                          -- finish, and a safe cap for a looping one (IsPlaying
                                          -- never goes false on its own for those)

--- Loads `assetId` onto a scratch clone of the named stock rig and plays it in real time (not
--- scrubbed -- the Task 0 spike found TimePosition scrubbing does not reliably fire markers).
--- Returns nil when no probe could run at all (rig fetch failed) -- NOT_VERIFIED downstream,
--- distinct from a probe that ran and failed. Otherwise always returns { ok, error? }: pcall
--- succeeding is not proof the clip actually played (Task 0 found an invalid asset ID reports
--- ok:true from pcall, with the real failure surfacing ~130ms later as an uncatchable async
--- warning) so this also checks the track actually started and reports a sane Length.
local function probePlayability(assetId, rigType, declaredLooped, declaredMarkers)
	local rig = fetchStandardRig(rigType)
	if not rig then
		return nil
	end
	local scratchRig = rig:Clone()
	scratchRig.Parent = workspace
	local animation = Instance.new("Animation")
	animation.AnimationId = "rbxassetid://" .. assetId
	local fired = {}
	local result
	local ok, err = pcall(function()
		local humanoid = scratchRig:FindFirstChildOfClass("Humanoid")
		local track = humanoid:LoadAnimation(animation)
		-- Roblox initializes track.Looped from the loaded clip's own authored Loop metadata.
		-- Read it now, before anything else touches it, or the comparison below is comparing
		-- declaredLooped against a value we set ourselves -- a tautology, not a check.
		local engineLooped = track.Looped
		for _, name in ipairs(declaredMarkers) do
			track:GetMarkerReachedSignal(name):Connect(function()
				table.insert(fired, name)
			end)
		end

		track:Play()
		local everPlayed = false
		local waited = 0
		while waited < PLAYABILITY_MAX_WAIT_SECONDS do
			if track.IsPlaying then
				everPlayed = true
			end
			if everPlayed and not track.IsPlaying then
				break -- a non-looping clip finished on its own
			end
			task.wait(0.1)
			waited += 0.1
		end
		track:Stop()

		if not everPlayed then
			result = { ok = false, error = "Animation never started playing (load likely failed asynchronously)." }
		elseif not (track.Length > 0) then
			result = { ok = false, error = "Animation reported an invalid length." }
		else
			local loopHonored = engineLooped == declaredLooped
			local missingMarker = nil
			for _, name in ipairs(declaredMarkers) do
				if not table.find(fired, name) then
					missingMarker = name
					break
				end
			end

			if not loopHonored then
				result = { ok = false, error = "Loop setting was not honored during playback." }
			elseif missingMarker then
				result = { ok = false, error = "Marker '" .. missingMarker .. "' never fired." }
			else
				result = { ok = true }
			end
		end
	end)
	scratchRig:Destroy()
	if not ok then
		return { ok = false, error = errorText(err) }
	end
	return result
end

local toolbar = plugin:CreateToolbar("CreatorFlow")
local toolbarButton = toolbar:CreateButton(
	"CreatorFlowAnimationBridge",
	"Compare two animation assets in CreatorFlow",
	"rbxassetid://4458901886",
	"CreatorFlow"
)
toolbarButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,
	false,
	430,
	680,
	360,
	520
)
local widget = plugin:CreateDockWidgetPluginGui("CreatorFlowAnimationBridgeV1", widgetInfo)
widget.Title = "CreatorFlow Animation Bridge"
widget.Name = "CreatorFlowAnimationBridge"

local root = create("Frame", {
	Name = "Root",
	BackgroundColor3 = COLORS.background,
	BorderSizePixel = 0,
	Size = UDim2.fromScale(1, 1),
}, widget)

local scrolling = create("ScrollingFrame", {
	Name = "Content",
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	CanvasSize = UDim2.new(),
	ScrollBarImageColor3 = COLORS.border,
	ScrollBarThickness = 5,
	Size = UDim2.fromScale(1, 1),
}, root)

create("UIPadding", {
	PaddingBottom = UDim.new(0, 20),
	PaddingLeft = UDim.new(0, 18),
	PaddingRight = UDim.new(0, 18),
	PaddingTop = UDim.new(0, 18),
}, scrolling)

create("UIListLayout", {
	FillDirection = Enum.FillDirection.Vertical,
	HorizontalAlignment = Enum.HorizontalAlignment.Left,
	Padding = UDim.new(0, 14),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, scrolling)

local header = create("Frame", {
	Name = "Header",
	BackgroundTransparency = 1,
	LayoutOrder = 1,
	Size = UDim2.new(1, 0, 0, 58),
}, scrolling)

local mark = create("Frame", {
	BackgroundColor3 = COLORS.accent,
	BorderSizePixel = 0,
	Size = UDim2.fromOffset(44, 44),
}, header)
addCorner(mark, 12)
create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	Size = UDim2.fromScale(1, 1),
	Text = "CF",
	TextColor3 = COLORS.accentText,
	TextSize = 15,
}, mark)

create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	Position = UDim2.fromOffset(58, 1),
	Size = UDim2.new(1, -58, 0, 25),
	Text = "Animation evidence",
	TextColor3 = COLORS.text,
	TextSize = 18,
	TextXAlignment = Enum.TextXAlignment.Left,
}, header)

create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	Position = UDim2.fromOffset(58, 27),
	Size = UDim2.new(1, -58, 0, 28),
	Text = "Normalize two clips locally and compare them in CreatorFlow.",
	TextColor3 = COLORS.muted,
	TextSize = 12,
	TextWrapped = true,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
}, header)

local function section(title, description, layoutOrder, height)
	local card = create("Frame", {
		BackgroundColor3 = COLORS.surface,
		BorderSizePixel = 0,
		LayoutOrder = layoutOrder,
		Size = UDim2.new(1, 0, 0, height),
	}, scrolling)
	addCorner(card, 12)
	addStroke(card, COLORS.border, 0.35)
	create("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		Position = UDim2.fromOffset(15, 14),
		Size = UDim2.new(1, -30, 0, 19),
		Text = title,
		TextColor3 = COLORS.text,
		TextSize = 14,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, card)
	create("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		Position = UDim2.fromOffset(15, 35),
		Size = UDim2.new(1, -30, 0, 31),
		Text = description,
		TextColor3 = COLORS.muted,
		TextSize = 11,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
	}, card)
	return card
end

local function label(parent, textValue, position, width)
	return create("TextLabel", {
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamMedium,
		Position = position,
		Size = UDim2.new(width or 1, width and -7 or -30, 0, 18),
		Text = textValue,
		TextColor3 = COLORS.muted,
		TextSize = 11,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, parent)
end

local function textBox(parent, name, placeholder, position, size, initialValue)
	local box = create("TextBox", {
		Name = name,
		BackgroundColor3 = COLORS.surfaceRaised,
		BorderSizePixel = 0,
		ClearTextOnFocus = false,
		Font = Enum.Font.Code,
		PlaceholderColor3 = Color3.fromRGB(104, 115, 133),
		PlaceholderText = placeholder,
		Position = position,
		Size = size,
		Text = initialValue,
		TextColor3 = COLORS.text,
		TextSize = 12,
		TextTruncate = Enum.TextTruncate.AtEnd,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, parent)
	addCorner(box, 7)
	addStroke(box, COLORS.border, 0.25)
	create("UIPadding", {
		PaddingLeft = UDim.new(0, 10),
		PaddingRight = UDim.new(0, 10),
	}, box)
	return box
end

local function actionButton(parent, name, textValue, position, size, primary)
	local button = create("TextButton", {
		Name = name,
		AutoButtonColor = true,
		BackgroundColor3 = primary and COLORS.accent or COLORS.surfaceRaised,
		BorderSizePixel = 0,
		Font = Enum.Font.GothamBold,
		Position = position,
		Size = size,
		Text = textValue,
		TextColor3 = primary and COLORS.accentText or COLORS.text,
		TextSize = 12,
	}, parent)
	addCorner(button, 8)
	if not primary then
		addStroke(button, COLORS.border, 0.15)
	end
	return button
end

local connectionCard = section(
	"1 · Connect to the desktop app",
	"Paste the loopback URL and one-time pairing token shown in CreatorFlow.",
	2,
	222
)
label(connectionCard, "CREATORFLOW LOOPBACK URL", UDim2.fromOffset(15, 73))
local endpointBox = textBox(
	connectionCard,
	"Endpoint",
	"http://127.0.0.1:49152",
	UDim2.fromOffset(15, 94),
	UDim2.new(1, -30, 0, 36),
	safeGetSetting(SETTINGS.endpoint, "")
)
label(connectionCard, "PAIRING TOKEN", UDim2.fromOffset(15, 138))
local tokenBox = textBox(
	connectionCard,
	"PairingToken",
	"Paste the token from CreatorFlow",
	UDim2.fromOffset(15, 159),
	UDim2.new(0.67, -20, 0, 38),
	safeGetSetting(SETTINGS.token, "")
)
local connectButton = actionButton(
	connectionCard,
	"Connect",
	"Test connection",
	UDim2.new(0.67, 2, 0, 159),
	UDim2.new(0.33, -17, 0, 38),
	false
)

local comparisonCard = section(
	"2 · Choose two animation IDs",
	"Studio must already have permission to read both animation assets.",
	3,
	218
)
label(comparisonCard, "SOURCE ANIMATION ID", UDim2.fromOffset(15, 73), 0.5)
label(comparisonCard, "CANDIDATE ANIMATION ID", UDim2.new(0.5, 7, 0, 73), 0.5)
local sourceBox = textBox(
	comparisonCard,
	"SourceAnimationId",
	"1234567890",
	UDim2.fromOffset(15, 94),
	UDim2.new(0.5, -22, 0, 38),
	safeGetSetting(SETTINGS.sourceId, "")
)
local candidateBox = textBox(
	comparisonCard,
	"CandidateAnimationId",
	"9876543210",
	UDim2.new(0.5, 7, 0, 94),
	UDim2.new(0.5, -22, 0, 38),
	safeGetSetting(SETTINGS.candidateId, "")
)
local compareButton = actionButton(
	comparisonCard,
	"Compare",
	"Read, normalize & compare",
	UDim2.fromOffset(15, 149),
	UDim2.new(1, -30, 0, 46),
	true
)

local statusCard = create("Frame", {
	Name = "Status",
	BackgroundColor3 = COLORS.surface,
	BorderSizePixel = 0,
	LayoutOrder = 4,
	Size = UDim2.new(1, 0, 0, 112),
}, scrolling)
addCorner(statusCard, 12)
local statusStroke = addStroke(statusCard, COLORS.border, 0.35)
local statusDot = create("Frame", {
	BackgroundColor3 = COLORS.muted,
	BorderSizePixel = 0,
	Position = UDim2.fromOffset(15, 17),
	Size = UDim2.fromOffset(9, 9),
}, statusCard)
addCorner(statusDot, 5)
local statusTitle = create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	Position = UDim2.fromOffset(33, 12),
	Size = UDim2.new(1, -48, 0, 21),
	Text = "Ready",
	TextColor3 = COLORS.text,
	TextSize = 13,
	TextXAlignment = Enum.TextXAlignment.Left,
}, statusCard)
local statusDetail = create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	Position = UDim2.fromOffset(15, 39),
	Size = UDim2.new(1, -30, 0, 58),
	Text = "CreatorFlow stays local. No animation data is sent until you press Compare.",
	TextColor3 = COLORS.muted,
	TextSize = 11,
	TextWrapped = true,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
}, statusCard)

create("TextLabel", {
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	LayoutOrder = 5,
	Size = UDim2.new(1, 0, 0, 52),
	Text = "LOCAL-FIRST · This v0.1 sends normalized joint transforms only to the loopback CreatorFlow process. It does not upload source files or bypass Roblox permissions.",
	TextColor3 = COLORS.muted,
	TextSize = 10,
	TextWrapped = true,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
}, scrolling)

local function setStatus(kind, titleText, detailText)
	local color = COLORS.muted
	if kind == "success" then
		color = COLORS.success
	elseif kind == "warning" then
		color = COLORS.warning
	elseif kind == "error" then
		color = COLORS.error
	elseif kind == "working" then
		color = COLORS.accent
	end
	statusDot.BackgroundColor3 = color
	statusStroke.Color = color
	statusStroke.Transparency = kind == "idle" and 0.35 or 0.05
	statusTitle.Text = titleText
	statusDetail.Text = detailText
end

local busy = false
local function setBusy(value, activeButton)
	busy = value
	connectButton.Active = not value
	compareButton.Active = not value
	connectButton.AutoButtonColor = not value
	compareButton.AutoButtonColor = not value
	connectButton.TextTransparency = value and 0.45 or 0
	compareButton.TextTransparency = value and 0.45 or 0
	if value and activeButton == connectButton then
		connectButton.Text = "Connecting…"
	else
		connectButton.Text = "Test connection"
	end
	if value and activeButton == compareButton then
		compareButton.Text = "Reading animations…"
	else
		compareButton.Text = "Read, normalize & compare"
	end
end

local function connectionValues()
	local endpoint = normalizeEndpoint(endpointBox.Text)
	local token = trim(tokenBox.Text)
	if token == "" then
		error("Paste the pairing token shown by CreatorFlow.", 0)
	end
	safeSetSetting(SETTINGS.endpoint, endpoint)
	safeSetSetting(SETTINGS.token, token)
	return endpoint, token
end

local function request(endpoint, path, token, method, body)
	local options = {
		Url = endpoint .. path,
		Method = method,
		Timeout = 15,
		Headers = {
			["Accept"] = "application/json",
			["Authorization"] = "Bearer " .. token,
			["X-CreatorFlow-Client"] = "roblox-studio-plugin/0.1",
		},
	}
	if body then
		options.Headers["Content-Type"] = "application/json"
		options.Body = body
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		error(
			"Studio could not reach CreatorFlow. Keep the desktop app open, allow this plugin's network prompt (Manage Plugins), and enable Game Settings → Security → Allow HTTP Requests if needed. Roblox said: "
				.. errorText(response),
			0
		)
	end
	if not response.Success then
		local serverMessage = ""
		local decodedOk, decoded = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)
		if decodedOk and type(decoded) == "table" then
			serverMessage = tostring(decoded.message or decoded.error or "")
		end
		if serverMessage == "" then
			serverMessage = response.StatusMessage or "Request rejected"
		end
		error(string.format("CreatorFlow returned HTTP %d: %s", response.StatusCode, serverMessage), 0)
	end

	local decodedOk, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedOk or type(decoded) ~= "table" then
		error("CreatorFlow returned an unreadable response.", 0)
	end
	return decoded
end

local function sortedPoses(instances)
	local poses = {}
	for _, instance in ipairs(instances) do
		if instance:IsA("Pose") then
			table.insert(poses, instance)
		end
	end
	table.sort(poses, function(a, b)
		if a.Name == b.Name then
			return a.ClassName < b.ClassName
		end
		return a.Name < b.Name
	end)
	return poses
end

local function appendPose(pose, parentPath, output, seenPaths, counters)
	local segment = trim(pose.Name)
	if segment == "" then
		segment = "(unnamed)"
	end
	local jointPath = parentPath == "" and segment or (parentPath .. "/" .. segment)
	if seenPaths[jointPath] then
		error("Animation has duplicate joint path '" .. jointPath .. "'. v0.1 cannot normalize it unambiguously.", 0)
	end
	seenPaths[jointPath] = true

	local components = { pose.CFrame:GetComponents() }
	if #components ~= 12 then
		error("Joint '" .. jointPath .. "' did not return a 12-component CFrame.", 0)
	end
	for index, value in ipairs(components) do
		components[index] = roundNumber(value, jointPath)
	end

	table.insert(output, {
		jointPath = jointPath,
		transform = components,
		-- Pose.Weight is the authored blend weight; MaskWeight is deprecated and
		-- always default, which would blind the engine's weight comparison.
		weight = roundNumber(pose.Weight, jointPath .. " weight"),
		easingStyle = pose.EasingStyle.Name,
		easingDirection = pose.EasingDirection.Name,
	})
	counters.poses += 1
	if counters.poses > MAX_POSES then
		error(string.format("Animation exceeds the v0.1 safety limit of %d poses.", MAX_POSES), 0)
	end

	for _, child in ipairs(sortedPoses(pose:GetSubPoses())) do
		appendPose(child, jointPath, output, seenPaths, counters)
	end
end

local function normalizeKeyframeSequence(assetId, clip)
	local keyframes = clip:GetKeyframes()
	table.sort(keyframes, function(a, b)
		if a.Time == b.Time then
			return a.Name < b.Name
		end
		return a.Time < b.Time
	end)
	if #keyframes == 0 then
		error("Animation " .. assetId .. " has no keyframes.", 0)
	end

	local normalizedKeyframes = {}
	local duration = 0
	local counters = { poses = 0 }
	local priorTime = nil
	local rawMarkerNames = {}
	for _, keyframe in ipairs(keyframes) do
		local time = roundNumber(keyframe.Time, "keyframe time")
		if priorTime ~= nil and time == priorTime then
			error("Animation " .. assetId .. " has multiple keyframes at the same rounded time. v0.1 cannot order them reliably.", 0)
		end
		priorTime = time
		duration = math.max(duration, time)

		local poses = {}
		local seenPaths = {}
		for _, pose in ipairs(sortedPoses(keyframe:GetPoses())) do
			appendPose(pose, "", poses, seenPaths, counters)
		end
		table.sort(poses, function(a, b)
			return a.jointPath < b.jointPath
		end)
		table.insert(normalizedKeyframes, {
			time = time,
			poses = poses,
		})

		-- Collected for the playability probe's marker-fired check (probePlayability), not sent
		-- over the wire: adding a field here would ride inside the JSON-encoded `source`/
		-- `candidate` objects the server parses straight into NormalizedAnimation, whose Jackson
		-- ObjectMapper rejects unknown properties. Kept as a separate return value instead.
		for _, marker in ipairs(keyframe:GetMarkers()) do
			table.insert(rawMarkerNames, marker.Name)
		end
	end

	return {
		assetId = assetId,
		name = clip.Name,
		duration = roundNumber(duration, "duration"),
		looped = clip.Loop,
		priority = clip.Priority.Name,
		keyframes = normalizedKeyframes,
	}, counters, dedupeMarkerNames(rawMarkerNames)
end

--- Builds the joint path exactly as appendPose builds it for a KeyframeSequence's Pose tree --
--- trimmed segment names, "(unnamed)" for a blank one, joined with "/", no leading separator --
--- so a CURVE_SAMPLED clip's joint keys byte-match a KEYFRAME clip's for the same rig. A
--- CurveAnimation nests one Folder per joint under the clip and hangs that joint's
--- "Position"/"Rotation" curves off the innermost Folder, so the path is that Folder ancestry.
--- Returns nil for a curve that is not under any joint Folder, which has no joint identity.
local function curveJointPath(curve, clip)
	local segments = {}
	local node = curve.Parent
	while node ~= nil and node ~= clip do
		local segment = trim(node.Name)
		if segment == "" then
			segment = "(unnamed)"
		end
		table.insert(segments, 1, segment)
		node = node.Parent
	end
	if node ~= clip or #segments == 0 then
		return nil
	end
	return table.concat(segments, "/")
end

--- Groups every position/rotation curve in the clip under its joint path. v0.1 reads position
--- and rotation only: a FloatCurve is either an axis child of one of those two (already read
--- through its parent) or an authored custom channel with no pose equivalent, and a MarkerCurve
--- carries no transform at all.
---
--- A channel named exactly Position/Rotation WINS over one merely of the right class. Class alone
--- meant a joint folder holding two Vector3Curves sampled whichever GetDescendants returned last:
--- deterministic, but possibly the wrong channel, and wrong poses with no error is the worst thing
--- this file can do quietly.
---
--- Name is a preference and not a requirement, deliberately. The Task 0 spike confirmed the
--- Position/Rotation naming against a clip the spike script built itself; a real Studio-AUTHORED
--- curve tree has never been observed — it is the one empirical unknown left on this phase's
--- Studio checklist, and the same note records MarkerCurve placement as unobserved for the same
--- reason. Requiring the name would trade a rare wrong-channel guess for reading nothing at all
--- from every real clip if Studio names them differently, which is the worse failure. So: take the
--- named one when it exists, otherwise fall back to the first of the right class and say so once.
local function collectCurveChannels(clip)
	local channelsByPath = {}
	local namedByPath = {}
	local usedUnnamedFallback = false
	for _, descendant in ipairs(clip:GetDescendants()) do
		local name = trim(descendant.Name)
		local isPosition = descendant:IsA("Vector3Curve")
		local isRotation = descendant:IsA("EulerRotationCurve") or descendant:IsA("RotationCurve")
		if isPosition or isRotation then
			local jointPath = curveJointPath(descendant, clip)
			if jointPath then
				local channel = channelsByPath[jointPath]
				if not channel then
					channel = {}
					channelsByPath[jointPath] = channel
					namedByPath[jointPath] = {}
				end
				local named = namedByPath[jointPath]
				local slot = isPosition and "position" or "rotation"
				local expected = isPosition and "Position" or "Rotation"
				if name == expected then
					-- Two identically-named channels on one joint is malformed either way; keep the
					-- first so the read stays stable across runs of the same clip.
					if not named[slot] then
						channel[slot] = descendant
						named[slot] = true
					end
				elseif not channel[slot] then
					channel[slot] = descendant
					usedUnnamedFallback = true
				end
			end
		end
	end
	if usedUnnamedFallback then
		warn("[CreatorFlow] This clip has a curve channel not named Position/Rotation; read it by "
			.. "class instead. If the comparison looks wrong, that guess is the first thing to "
			.. "check.")
	end
	return channelsByPath
end

--- Says once per session that the untested RotationCurve path actually ran. Sampling calls this
--- per joint per sample, so it has to fire once, not thousands of times; warn rather than
--- setStatus because the status line belongs to the comparison the person asked for.
local announcedUntestedRotationCurve = false
local function announceUntestedRotationCurve()
	if announcedUntestedRotationCurve then
		return
	end
	announcedUntestedRotationCurve = true
	warn("[CreatorFlow] This clip uses RotationCurve rather than EulerRotationCurve. That path has "
		.. "never been exercised against a real asset, so treat this comparison as unconfirmed and "
		.. "say so if you report the result.")
end

--- Evaluates one joint's channels at `time` into the CFrame Roblox's own animator produces.
--- The Task 0 spike read Motor6D.Transform out of a real playtest and confirmed the composition
--- is CFrame.new(position) * rotation, not the reverse: rotating the translation instead
--- produces a plausible-looking but silently wrong transform. A joint with only one of the two
--- curves gets the identity for the other. Sampling outside the keyed range clamps to the first
--- or last key, so the t=0 and t=duration samples are safe.
local function sampleChannelCFrame(channel, time)
	local x, y, z = 0, 0, 0
	if channel.position then
		-- A per-axis nil means that axis was never keyed, which is no authored motion, so 0.
		local values = channel.position:GetValueAtTime(time)
		if values then
			x = values[1] or 0
			y = values[2] or 0
			z = values[3] or 0
		end
	end

	local rotation = CFrame.identity
	if channel.rotation then
		if channel.rotation:IsA("EulerRotationCurve") then
			rotation = channel.rotation:GetRotationAtTime(time)
		else
			-- RotationCurve branch: UNTESTED against a real asset -- the Task 0 spike only
			-- exercised EulerRotationCurve, and the docs say a joint's Rotation child may be
			-- either class. This one exposes GetValueAtTime rather than GetRotationAtTime, and
			-- it returns a nullable CFrame: nil means the curve holds no keys, so no rotation.
			-- Announced once per session the first time it actually runs, so the first real
			-- RotationCurve asset gets noticed rather than quietly half-trusted: if this class
			-- does not clamp out of range the way its Euler sibling was measured to, endpoint
			-- samples flatten to identity silently.
			announceUntestedRotationCurve()
			rotation = channel.rotation:GetValueAtTime(time) or CFrame.identity
		end
	end

	return CFrame.new(x, y, z) * rotation
end

--- Samples a CurveAnimation into the same {time, poses} shape normalizeKeyframeSequence returns,
--- so everything downstream of readAnimation treats a sampled clip exactly like an authored one.
local function normalizeCurveAnimation(assetId, clip)
	local channelsByPath = collectCurveChannels(clip)

	-- Rounded up front so a non-finite Length errors through roundNumber's own message instead of
	-- slipping past the check below into the sample loop; rounding twice is a no-op, so the
	-- payload's duration is the same value either way.
	local duration = roundNumber(clip.Length, "duration")
	if duration <= 0 then
		error("Animation " .. assetId .. " has no duration to sample.", 0)
	end

	-- Counted, not sampled: the desktop app refuses more than MAX_SAMPLED_KEYFRAMES keyframes per
	-- side, and a sparse-channel clip can pass the pose and byte limits and still blow through that
	-- one. Answering it here also means a nonsense clip.Length never allocates its grid.
	local sampleCount = sampleCountFor(duration)
	if sampleCount > MAX_SAMPLED_KEYFRAMES then
		error(string.format(
			"Animation %s is too long to sample at %d/s: %d keyframes exceeds the limit of %d. Curve clips up to ~%d s are supported.",
			assetId,
			CURVE_SAMPLES_PER_SECOND,
			sampleCount,
			MAX_SAMPLED_KEYFRAMES,
			math.floor(MAX_SAMPLED_KEYFRAMES / CURVE_SAMPLES_PER_SECOND)
		), 0)
	end

	local hasAnyChannel = false
	for _ in pairs(channelsByPath) do
		hasAnyChannel = true
		break
	end
	if not hasAnyChannel then
		error("Animation " .. assetId .. " has no position/rotation curve channels CreatorFlow can compare.", 0)
	end

	local normalizedKeyframes = {}
	local counters = { poses = 0 }
	for _, time in ipairs(sampleTimesFor(duration)) do
		local poses = {}
		-- No seenPaths/duplicate-path guard here, unlike appendPose's version of this loop:
		-- channelsByPath is a Lua table keyed by joint path, so duplicate keys are structurally
		-- impossible. That guard exists there because appendPose walks a recursive Pose tree that
		-- COULD contain a repeated path; this loop cannot.
		for jointPath, channel in pairs(channelsByPath) do
			local components = { sampleChannelCFrame(channel, time):GetComponents() }
			for index, value in ipairs(components) do
				components[index] = roundNumber(value, jointPath)
			end
			table.insert(poses, {
				jointPath = jointPath,
				transform = components,
				-- weight/easingStyle/easingDirection are fixed defaults, not sampled values: a
				-- curve channel carries no authored per-channel blend weight the way Pose.Weight
				-- does, and "interpolation between authored keyframes" says nothing about a value
				-- read straight off a continuous curve.
				weight = 1,
				easingStyle = "Linear",
				easingDirection = "InOut",
			})
			counters.poses += 1
			if counters.poses > MAX_POSES then
				error(string.format("Animation exceeds the v0.1 safety limit of %d poses.", MAX_POSES), 0)
			end
		end
		table.sort(poses, function(a, b)
			return a.jointPath < b.jointPath
		end)
		table.insert(normalizedKeyframes, {
			time = roundNumber(time, "keyframe time"),
			poses = poses,
		})
	end

	return {
		assetId = assetId,
		name = clip.Name,
		duration = duration,
		looped = clip.Loop,
		priority = clip.Priority.Name,
		keyframes = normalizedKeyframes,
	}, counters, {} -- markers: a CurveAnimation has no per-keyframe marker concept to declare
end

local function readAnimation(assetId)
	local ok, clipOrError = pcall(function()
		return AnimationClipProvider:GetAnimationClipAsync("rbxassetid://" .. assetId)
	end)
	if not ok then
		error(
			"Could not read animation "
				.. assetId
				.. ". Confirm the ID and that this Studio account or experience may access it. The plugin does not bypass Roblox permissions. Roblox said: "
				.. errorText(clipOrError),
			0
		)
	end

	local clip = clipOrError
	local isCurve = clip:IsA("CurveAnimation")
	if not isCurve and not clip:IsA("KeyframeSequence") then
		local className = clip.ClassName
		clip:Destroy()
		error("Animation " .. assetId .. " returned unsupported clip type " .. className .. ".", 0)
	end

	local normalizeFn = isCurve and normalizeCurveAnimation or normalizeKeyframeSequence
	local normalizedOk, normalized, counters, markers = pcall(normalizeFn, assetId, clip)
	clip:Destroy()
	if not normalizedOk then
		error(errorText(normalized), 0)
	end
	return normalized, counters, markers, (isCurve and "CURVE_SAMPLED" or "KEYFRAME")
end

local function formatScore(value)
	local numeric = tonumber(value)
	if not numeric then
		return "—"
	end
	if numeric >= 0 and numeric <= 1 then
		numeric *= 100
	end
	return string.format("%.0f%%", numeric)
end

local function runAction(activeButton, workingTitle, workingDetail, callback)
	if busy then
		return
	end
	task.spawn(function()
		setBusy(true, activeButton)
		setStatus("working", workingTitle, workingDetail)
		local ok, result = pcall(callback)
		setBusy(false, nil)
		if not ok then
			setStatus("error", "Could not complete the request", errorText(result))
		else
			result()
		end
	end)
end

connectButton.Activated:Connect(function()
	runAction(connectButton, "Testing local connection…", "Calling the authenticated CreatorFlow health endpoint.", function()
		local endpoint, token = connectionValues()
		local health = request(endpoint, HEALTH_PATH, token, "GET", nil)
		if health.status ~= "ok" then
			error("CreatorFlow is reachable but did not report a healthy bridge.", 0)
		end
		if health.schema and health.schema ~= SCHEMA then
			error("CreatorFlow expects schema " .. tostring(health.schema) .. ", but this plugin sends " .. SCHEMA .. ".", 0)
		end
		return function()
			local projectText = health.projectId and (" Active project: " .. tostring(health.projectId) .. ".") or ""
			setStatus("success", "Connected to CreatorFlow", "The pairing token is valid." .. projectText)
		end
	end)
end)

compareButton.Activated:Connect(function()
	runAction(compareButton, "Reading animations…", "Studio is resolving both asset IDs with your current Roblox permissions.", function()
		local endpoint, token = connectionValues()
		local sourceId = normalizeAssetId(sourceBox.Text, "Source animation ID")
		local candidateId = normalizeAssetId(candidateBox.Text, "Candidate animation ID")
		safeSetSetting(SETTINGS.sourceId, sourceId)
		safeSetSetting(SETTINGS.candidateId, candidateId)

		local source, sourceCounts, sourceMarkers, sourceKind = readAnimation(sourceId)
		setStatus("working", "Source normalized", string.format("Read %d keyframes and %d poses. Reading candidate…", #source.keyframes, sourceCounts.poses))
		local candidate, candidateCounts, candidateMarkers, candidateKind = readAnimation(candidateId)

		setStatus("working", "Checking playability…", "Playing both clips on stock R6/R15 dummies in Studio.")
		local playability = {
			source = {
				r6 = probePlayability(sourceId, "R6", source.looped, sourceMarkers),
				r15 = probePlayability(sourceId, "R15", source.looped, sourceMarkers),
			},
			candidate = {
				r6 = probePlayability(candidateId, "R6", candidate.looped, candidateMarkers),
				r15 = probePlayability(candidateId, "R15", candidate.looped, candidateMarkers),
			},
		}

		local body = HttpService:JSONEncode({
			schema = SCHEMA,
			source = source,
			candidate = candidate,
			playability = playability,
			-- Top level, not nested inside source/candidate: those two objects are parsed
			-- straight into NormalizedAnimation, whose ObjectMapper rejects unknown properties.
			sourceKind = sourceKind,
			candidateKind = candidateKind,
		})
		if #body > MAX_REQUEST_BYTES then
			error(
				string.format(
					"The normalized request is %.2f MB, above the v0.1 local bridge limit of %.2f MB.",
					#body / (1024 * 1024),
					MAX_REQUEST_BYTES / (1024 * 1024)
				),
				0
			)
		end

		setStatus(
			"working",
			"Sending normalized joint data…",
			string.format(
				"%d + %d keyframes · %d + %d poses · %.1f KB over loopback",
				#source.keyframes,
				#candidate.keyframes,
				sourceCounts.poses,
				candidateCounts.poses,
				#body / 1024
			)
		)
		local comparison = request(endpoint, COMPARE_PATH, token, "POST", body)

		return function()
			local comparisonId = tostring(comparison.id or "saved")
			local verdict = tostring(comparison.verdict or "comparison complete")
			-- "Exact" on a sampled side is exactness about the sampled reconstruction, not about the
			-- authored keyframes a reader hears in it: two sampled re-uploads of one asset match
			-- exactly because sampling is deterministic. The web evidence card says the same thing.
			local sampledSide = sourceKind == "CURVE_SAMPLED" or candidateKind == "CURVE_SAMPLED"
			local exactText = ""
			if comparison.exactCurveData then
				exactText = sampledSide and string.format(" Exact match of curve-sampled data (%d/s), not an authored-keyframe read.", CURVE_SAMPLES_PER_SECOND) or " Exact normalized data."
			end
			-- A score found by mirroring one clip is a different claim from a score found as
			-- submitted, so it is stated rather than folded into the percentage. The web surface
			-- says this too; saying it in only one place is how the two routes start disagreeing.
			local mirroredText = comparison.mirrored and " Matched MIRRORED, not as submitted." or ""
			-- Looped and AnimationPriority are not curve data, so they are outside the fingerprint
			-- on purpose: two clips that differ only in those genuinely do have identical curves,
			-- and an exact verdict with 100s across the board is the honest reading. It is also the
			-- reading that hides a looping idle next to a one-shot pose, so the difference is stated
			-- here rather than left for someone to notice back in Studio. The web evidence card says
			-- the same thing; a claim carried by only one surface is how the two start disagreeing.
			local playbackDifferences = {}
			if source.looped ~= candidate.looped then
				table.insert(playbackDifferences, string.format("Looped: %s vs %s", source.looped and "yes" or "no", candidate.looped and "yes" or "no"))
			end
			if source.priority ~= candidate.priority then
				table.insert(playbackDifferences, string.format("Priority: %s vs %s", tostring(source.priority), tostring(candidate.priority)))
			end
			local playbackText = #playbackDifferences > 0
				and string.format(" Playback settings differ (%s), source first — this does not change the scores.", table.concat(playbackDifferences, ", "))
				or ""
			setStatus(
				"success",
				"Evidence saved · " .. formatScore(comparison.overallScore),
				string.format("%s · %s.%s%s%s Open CreatorFlow to inspect record %s.", sourceId .. " ↔ " .. candidateId, verdict, exactText, mirroredText, playbackText, comparisonId)
			)
		end
	end)
end)

endpointBox.FocusLost:Connect(function()
	safeSetSetting(SETTINGS.endpoint, trim(endpointBox.Text))
end)
tokenBox.FocusLost:Connect(function()
	safeSetSetting(SETTINGS.token, trim(tokenBox.Text))
end)
sourceBox.FocusLost:Connect(function()
	safeSetSetting(SETTINGS.sourceId, trim(sourceBox.Text))
end)
candidateBox.FocusLost:Connect(function()
	safeSetSetting(SETTINGS.candidateId, trim(candidateBox.Text))
end)

toolbarButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
	toolbarButton:SetActive(widget.Enabled)
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	toolbarButton:SetActive(widget.Enabled)
end)
