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
		weight = roundNumber(pose.MaskWeight, jointPath .. " weight"),
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
	end

	return {
		assetId = assetId,
		name = clip.Name,
		duration = roundNumber(duration, "duration"),
		looped = clip.Loop,
		priority = clip.Priority.Name,
		keyframes = normalizedKeyframes,
	}, counters
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
	if clip:IsA("CurveAnimation") then
		clip:Destroy()
		error(
			"Animation "
				.. assetId
				.. " is a CurveAnimation. CreatorFlow v0.1 compares KeyframeSequence assets only; curve-channel normalization is planned separately.",
			0
		)
	end
	if not clip:IsA("KeyframeSequence") then
		local className = clip.ClassName
		clip:Destroy()
		error("Animation " .. assetId .. " returned unsupported clip type " .. className .. ".", 0)
	end

	local normalizedOk, normalized, counters = pcall(normalizeKeyframeSequence, assetId, clip)
	clip:Destroy()
	if not normalizedOk then
		error(errorText(normalized), 0)
	end
	return normalized, counters
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

		local source, sourceCounts = readAnimation(sourceId)
		setStatus("working", "Source normalized", string.format("Read %d keyframes and %d poses. Reading candidate…", #source.keyframes, sourceCounts.poses))
		local candidate, candidateCounts = readAnimation(candidateId)

		local body = HttpService:JSONEncode({
			schema = SCHEMA,
			source = source,
			candidate = candidate,
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
			local exactText = comparison.exactCurveData and " Exact normalized data." or ""
			setStatus(
				"success",
				"Evidence saved · " .. formatScore(comparison.overallScore),
				string.format("%s · %s.%s Open CreatorFlow to inspect record %s.", sourceId .. " ↔ " .. candidateId, verdict, exactText, comparisonId)
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
