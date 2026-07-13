--!strict
-- Dock-widget UI. Same screening-room palette as the web gallery
-- (server/src/main/resources/static/css/site.css).

local Api = require(script.Parent.Api)

local COLORS = {
	bg = Color3.fromHex("#111217"),
	panel = Color3.fromHex("#1A1C22"),
	stroke = Color3.fromHex("#2A2D36"),
	text = Color3.fromHex("#E8EAF0"),
	dim = Color3.fromHex("#9AA1AD"),
	accent = Color3.fromHex("#5B8DEE"),
	clear = Color3.fromHex("#4CAF6E"),
	similar = Color3.fromHex("#E0A83C"),
	duplicate = Color3.fromHex("#E05C5C"),
}

local VERDICT_COLORS: { [string]: Color3 } = {
	CLEAR = COLORS.clear,
	SIMILAR = COLORS.similar,
	DUPLICATE = COLORS.duplicate,
}

export type Callbacks = {
	onConnect: (baseUrl: string, apiKey: string) -> (),
	onCreateAccount: (baseUrl: string, username: string) -> (),
	onVerify: () -> (),
	onRegister: () -> (),
	onRefreshAssets: () -> (),
	onPickAsset: (asset: Api.Asset) -> (),
	onAddMapping: (context: string, idText: string) -> (),
	onInsertId: (robloxAssetId: number) -> (),
}

export type Handle = {
	setStatus: (text: string, kind: string) -> (),
	setApiKey: (key: string) -> (),
	setSelection: (name: string?) -> (),
	setVerdict: (verdict: Api.Verdict?, errorText: string?) -> (),
	setAssets: (assets: { Api.Asset }) -> (),
	setMappings: (assetName: string?, mappings: { Api.Mapping }?, detectedContext: string?) -> (),
}

local function padding(parent: Instance, pixels: number)
	local pad = Instance.new("UIPadding")
	local px = UDim.new(0, pixels)
	pad.PaddingTop, pad.PaddingBottom, pad.PaddingLeft, pad.PaddingRight = px, px, px, px
	pad.Parent = parent
end

local function vlist(parent: Instance, gap: number): UIListLayout
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = Enum.FillDirection.Vertical
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, gap)
	layout.Parent = parent
	return layout
end

local function label(parent: Instance, text: string, order: number, color: Color3?, bold: boolean?): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham
	l.TextSize = if bold then 13 else 12
	l.TextColor3 = color or COLORS.text
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextWrapped = true
	l.AutomaticSize = Enum.AutomaticSize.Y
	l.Size = UDim2.new(1, 0, 0, 0)
	l.Text = text
	l.LayoutOrder = order
	l.Parent = parent
	return l
end

local function textBox(parent: Instance, placeholder: string, order: number): TextBox
	local box = Instance.new("TextBox")
	box.BackgroundColor3 = COLORS.bg
	box.BorderSizePixel = 0
	box.Font = Enum.Font.Code
	box.TextSize = 12
	box.TextColor3 = COLORS.text
	box.PlaceholderText = placeholder
	box.PlaceholderColor3 = COLORS.dim
	box.TextXAlignment = Enum.TextXAlignment.Left
	box.ClearTextOnFocus = false
	box.Text = ""
	box.Size = UDim2.new(1, 0, 0, 26)
	box.LayoutOrder = order
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = box
	padding(box, 6)
	box.Parent = parent
	return box
end

local function button(parent: Instance, text: string, order: number, primary: boolean?): TextButton
	local b = Instance.new("TextButton")
	b.BackgroundColor3 = if primary then COLORS.accent else COLORS.stroke
	b.BorderSizePixel = 0
	b.Font = Enum.Font.GothamBold
	b.TextSize = 12
	b.TextColor3 = if primary then Color3.fromHex("#0B0C10") else COLORS.text
	b.AutoButtonColor = true
	b.Size = UDim2.new(0, 0, 0, 26)
	b.AutomaticSize = Enum.AutomaticSize.X
	b.Text = "  " .. text .. "  "
	b.LayoutOrder = order
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = b
	b.Parent = parent
	return b
end

local function card(parent: Instance, title: string, order: number): Frame
	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = COLORS.panel
	frame.BorderSizePixel = 0
	frame.AutomaticSize = Enum.AutomaticSize.Y
	frame.Size = UDim2.new(1, 0, 0, 0)
	frame.LayoutOrder = order
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = frame
	padding(frame, 10)
	vlist(frame, 6)
	label(frame, title:upper(), 0, COLORS.dim, true)
	frame.Parent = parent
	return frame
end

local function buttonRow(parent: Instance, order: number): Frame
	local row = Instance.new("Frame")
	row.BackgroundTransparency = 1
	row.AutomaticSize = Enum.AutomaticSize.Y
	row.Size = UDim2.new(1, 0, 0, 0)
	row.LayoutOrder = order
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = Enum.FillDirection.Horizontal
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.Parent = row
	row.Parent = parent
	return row
end

local function clearChildren(frame: Instance)
	for _, child in frame:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
end

local Ui = {}

function Ui.mount(widget: DockWidgetPluginGui, callbacks: Callbacks): Handle
	local root = Instance.new("ScrollingFrame")
	root.BackgroundColor3 = COLORS.bg
	root.BorderSizePixel = 0
	root.Size = UDim2.new(1, 0, 1, 0)
	root.CanvasSize = UDim2.new(0, 0, 0, 0)
	root.AutomaticCanvasSize = Enum.AutomaticSize.Y
	root.ScrollBarThickness = 6
	root.ScrollBarImageColor3 = COLORS.stroke
	root.Parent = widget
	padding(root, 10)
	vlist(root, 8)

	-- Server card ---------------------------------------------------------
	local server = card(root, "Server", 1)
	local baseUrlBox = textBox(server, "Base URL (http://localhost:8080)", 1)
	local apiKeyBox = textBox(server, "API key (from /me on the website)", 2)
	local serverRow = buttonRow(server, 3)
	local connectBtn = button(serverRow, "Connect", 1, true)
	local statusLabel = label(server, "Not connected.", 4, COLORS.dim)

	local usernameBox = textBox(server, "…or a new username (3-40 chars)", 5)
	local accountRow = buttonRow(server, 6)
	local createBtn = button(accountRow, "Create account", 1)

	-- Selection card ------------------------------------------------------
	local selection = card(root, "Selected animation", 2)
	local selectionLabel = label(selection, "Select a KeyframeSequence in the Explorer.", 1, COLORS.dim)
	local actionRow = buttonRow(selection, 2)
	local verifyBtn = button(actionRow, "Check originality", 1, true)
	local registerBtn = button(actionRow, "Register version", 2)
	local verdictLabel = label(selection, "", 3)
	verdictLabel.Visible = false
	local matchesFrame = Instance.new("Frame")
	matchesFrame.BackgroundTransparency = 1
	matchesFrame.AutomaticSize = Enum.AutomaticSize.Y
	matchesFrame.Size = UDim2.new(1, 0, 0, 0)
	matchesFrame.LayoutOrder = 4
	vlist(matchesFrame, 4)
	matchesFrame.Parent = selection

	-- Registry card -------------------------------------------------------
	local registry = card(root, "My registry", 3)
	local registryRow = buttonRow(registry, 1)
	local refreshBtn = button(registryRow, "Refresh", 1)
	local assetsFrame = Instance.new("Frame")
	assetsFrame.BackgroundTransparency = 1
	assetsFrame.AutomaticSize = Enum.AutomaticSize.Y
	assetsFrame.Size = UDim2.new(1, 0, 0, 0)
	assetsFrame.LayoutOrder = 2
	vlist(assetsFrame, 4)
	assetsFrame.Parent = registry

	-- Mappings card -------------------------------------------------------
	local mappingsCard = card(root, "Roblox asset IDs", 4)
	mappingsCard.Visible = false
	local mappingsTitle = label(mappingsCard, "", 1)
	local contextLabel = label(mappingsCard, "", 2, COLORS.dim)
	local mappingsFrame = Instance.new("Frame")
	mappingsFrame.BackgroundTransparency = 1
	mappingsFrame.AutomaticSize = Enum.AutomaticSize.Y
	mappingsFrame.Size = UDim2.new(1, 0, 0, 0)
	mappingsFrame.LayoutOrder = 3
	vlist(mappingsFrame, 4)
	mappingsFrame.Parent = mappingsCard
	local contextBox = textBox(mappingsCard, "context (group:12345 / user:98765)", 4)
	local mappingIdBox = textBox(mappingsCard, "Roblox asset id (or rbxassetid:// url)", 5)
	local mappingRow = buttonRow(mappingsCard, 6)
	local saveMappingBtn = button(mappingRow, "Save mapping", 1, true)

	-- Wiring ---------------------------------------------------------------
	connectBtn.Activated:Connect(function()
		callbacks.onConnect(baseUrlBox.Text, apiKeyBox.Text)
	end)
	createBtn.Activated:Connect(function()
		callbacks.onCreateAccount(baseUrlBox.Text, usernameBox.Text)
	end)
	verifyBtn.Activated:Connect(callbacks.onVerify)
	registerBtn.Activated:Connect(callbacks.onRegister)
	refreshBtn.Activated:Connect(callbacks.onRefreshAssets)
	saveMappingBtn.Activated:Connect(function()
		callbacks.onAddMapping(contextBox.Text, mappingIdBox.Text)
	end)

	local handle: Handle = {
		setStatus = function(text: string, kind: string)
			statusLabel.Text = text
			statusLabel.TextColor3 = if kind == "ok" then COLORS.clear
				elseif kind == "error" then COLORS.duplicate
				else COLORS.dim
		end,
		setApiKey = function(key: string)
			apiKeyBox.Text = key
		end,
		setSelection = function(name: string?)
			if name then
				selectionLabel.Text = name
				selectionLabel.TextColor3 = COLORS.text
			else
				selectionLabel.Text = "Select a KeyframeSequence in the Explorer."
				selectionLabel.TextColor3 = COLORS.dim
			end
		end,
		setVerdict = function(verdict: Api.Verdict?, errorText: string?)
			clearChildren(matchesFrame)
			if errorText then
				verdictLabel.Visible = true
				verdictLabel.Text = errorText
				verdictLabel.TextColor3 = COLORS.duplicate
				return
			end
			if not verdict then
				verdictLabel.Visible = false
				return
			end
			verdictLabel.Visible = true
			verdictLabel.Text = verdict.verdict
			verdictLabel.TextColor3 = VERDICT_COLORS[verdict.verdict] or COLORS.text
			for i, match in verdict.matches do
				label(matchesFrame, match.note, i, COLORS.dim)
			end
		end,
		setAssets = function(assets: { Api.Asset })
			clearChildren(assetsFrame)
			if #assets == 0 then
				label(assetsFrame, "Nothing registered yet.", 1, COLORS.dim)
				return
			end
			for i, asset in assets do
				local entry = button(assetsFrame, string.format("%s · %s", asset.fileName,
					string.sub(asset.sha256, 1, 12)), i)
				entry.Size = UDim2.new(1, 0, 0, 26)
				entry.AutomaticSize = Enum.AutomaticSize.None
				entry.TextXAlignment = Enum.TextXAlignment.Left
				entry.Font = Enum.Font.Gotham
				entry.Activated:Connect(function()
					callbacks.onPickAsset(asset)
				end)
			end
		end,
		setMappings = function(assetName: string?, mappings: { Api.Mapping }?, detectedContext: string?)
			clearChildren(mappingsFrame)
			if not assetName then
				mappingsCard.Visible = false
				return
			end
			mappingsCard.Visible = true
			mappingsTitle.Text = assetName
			contextLabel.Text = if detectedContext
				then "This place publishes as " .. detectedContext .. "."
				else "Unpublished place — no ownership context to match."
			if detectedContext and contextBox.Text == "" then
				contextBox.Text = detectedContext
			end
			if not mappings then
				label(mappingsFrame, "Loading…", 1, COLORS.dim)
				return
			end
			if #mappings == 0 then
				label(mappingsFrame, "No Roblox ids recorded yet — save the id this was uploaded as.", 1, COLORS.dim)
				return
			end
			for i, mapping in mappings do
				local row = buttonRow(mappingsFrame, i)
				local matchesHere = detectedContext ~= nil and mapping.context == detectedContext
				local insert = button(row,
					if matchesHere then "Insert (this game)" else "Insert",
					1, matchesHere)
				insert.Activated:Connect(function()
					callbacks.onInsertId(mapping.robloxAssetId)
				end)
				local text = label(row, mapping.context .. " → " .. mapping.robloxAssetId, 2,
					if matchesHere then COLORS.text else COLORS.dim)
				text.AutomaticSize = Enum.AutomaticSize.XY
				text.Size = UDim2.new(0, 0, 0, 26)
				text.TextYAlignment = Enum.TextYAlignment.Center
			end
		end,
	}
	return handle
end

return Ui
