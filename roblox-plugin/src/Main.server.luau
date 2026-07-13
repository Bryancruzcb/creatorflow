-- CreatorFlow for Roblox Studio — plugin entry point.
-- Fingerprints the selected KeyframeSequence, checks it against the team
-- registry over HTTP, and registers clean versions. Files never leave Studio;
-- only SHA-256 digests travel, the same contract the desktop companion uses.

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

local Config = require(script.Parent.Config)
local Api = require(script.Parent.Api)
local Sha256 = require(script.Parent.Sha256)
local Serialize = require(script.Parent.Serialize)
local Ui = require(script.Parent.Ui)

if not Sha256.selfTest() then
	warn("[CreatorFlow] SHA-256 self-test failed — refusing to load, a wrong digest would poison the registry.")
	return
end

local DEFAULT_LICENSE = "Team-internal"

local toolbar = plugin:CreateToolbar("CreatorFlow")
local toggleButton = toolbar:CreateButton(
	"CreatorFlow",
	"Originality-checked animation registry for your team",
	"rbxassetid://0" -- TODO: upload an icon and drop the ID in
)
toggleButton.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGui(
	"CreatorFlowPanel",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 320, 480, 280, 360)
)
widget.Title = "CreatorFlow"

local config = Config.new(plugin)
local api = Api.new(config)
local ui -- forward declaration; callbacks below capture it
local pickedAsset: Api.Asset? = nil -- registry asset whose mappings are showing

local function findSelectedSequence(): KeyframeSequence?
	for _, instance in Selection:Get() do
		if instance:IsA("KeyframeSequence") then
			return instance
		end
		local descendant = instance:FindFirstChildWhichIsA("KeyframeSequence", true)
		if descendant then
			return descendant
		end
	end
	return nil
end

-- The ownership context this place's animations must be uploaded under —
-- the key the registry's ID mappings are looked up by.
local function currentContext(): string?
	if game.CreatorId == 0 then
		return nil -- unpublished local place
	end
	local kind = if game.CreatorType == Enum.CreatorType.Group then "group" else "user"
	return kind .. ":" .. game.CreatorId
end

local function insertAnimation(name: string, robloxAssetId: number)
	local recording = ChangeHistoryService:TryBeginRecording("CreatorFlow: insert animation")
	local animation = Instance.new("Animation")
	animation.Name = name
	animation.AnimationId = "rbxassetid://" .. robloxAssetId
	animation.Parent = Selection:Get()[1] or workspace
	Selection:Set({ animation })
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
end

local function fingerprintSelection(): (KeyframeSequence?, string?, number?)
	local sequence = findSelectedSequence()
	if not sequence then
		return nil, nil, nil
	end
	local canonical = Serialize.keyframeSequence(sequence)
	return sequence, Sha256.hex(canonical), #canonical
end

local callbacks = {
	onConnect = function(baseUrl: string, apiKey: string)
		config:setBaseUrl(baseUrl)
		if apiKey ~= "" then
			config:setApiKey(apiKey)
		end
		ui.setStatus("Connecting…", "info")
		task.spawn(function()
			local ok, result = api:health()
			if ok then
				ui.setStatus("Connected to " .. config:baseUrl(), "ok")
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onCreateAccount = function(baseUrl: string, username: string)
		config:setBaseUrl(baseUrl)
		ui.setStatus("Creating account…", "info")
		task.spawn(function()
			local ok, result = api:createAccount(username)
			if ok then
				config:setApiKey(result.apiKey)
				ui.setApiKey(result.apiKey)
				ui.setStatus("Account “" .. result.username .. "” created — key saved.", "ok")
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onVerify = function()
		local sequence, digest = fingerprintSelection()
		if not sequence or not digest then
			ui.setVerdict(nil, "Select a KeyframeSequence first.")
			return
		end
		ui.setVerdict(nil, nil)
		ui.setStatus("Checking “" .. sequence.Name .. "”…", "info")
		task.spawn(function()
			local ok, result = api:verify(sequence.Name, digest)
			if ok then
				ui.setStatus("Checked “" .. sequence.Name .. "”.", "ok")
				ui.setVerdict(result, nil)
			else
				ui.setStatus("Check failed.", "error")
				ui.setVerdict(nil, tostring(result))
			end
		end)
	end,

	onRegister = function()
		local sequence, digest, size = fingerprintSelection()
		if not sequence or not digest or not size then
			ui.setVerdict(nil, "Select a KeyframeSequence first.")
			return
		end
		ui.setStatus("Registering “" .. sequence.Name .. "”…", "info")
		task.spawn(function()
			local ok, result = api:register(sequence.Name, size, digest, DEFAULT_LICENSE)
			if ok then
				ui.setStatus("Registered “" .. result.fileName .. "” (#" .. result.id .. ").", "ok")
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onRefreshAssets = function()
		task.spawn(function()
			local ok, result = api:myAssets()
			if ok then
				ui.setAssets(result)
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onPickAsset = function(asset)
		pickedAsset = asset
		ui.setMappings(asset.fileName, nil, currentContext())
		task.spawn(function()
			local ok, result = api:mappings(asset.id)
			if ok then
				ui.setMappings(asset.fileName, result, currentContext())
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onAddMapping = function(context: string, idText: string)
		if not pickedAsset then
			return
		end
		local asset = pickedAsset
		local robloxAssetId = tonumber(idText:match("(%d+)") or "")
		if not robloxAssetId then
			ui.setStatus("Enter the Roblox asset id as a number (or rbxassetid:// url).", "error")
			return
		end
		task.spawn(function()
			local ok, result = api:addMapping(asset.id, context, robloxAssetId)
			if ok then
				ui.setStatus("Mapped “" .. asset.fileName .. "” to " .. robloxAssetId
					.. " for " .. result.context .. ".", "ok")
				local listOk, list = api:mappings(asset.id)
				if listOk then
					ui.setMappings(asset.fileName, list, currentContext())
				end
			else
				ui.setStatus(tostring(result), "error")
			end
		end)
	end,

	onInsertId = function(robloxAssetId: number)
		if not pickedAsset then
			return
		end
		insertAnimation(pickedAsset.fileName, robloxAssetId)
		ui.setStatus("Inserted Animation " .. robloxAssetId .. " (“" .. pickedAsset.fileName .. "”).", "ok")
	end,
}

ui = Ui.mount(widget, callbacks)
ui.setStatus("Base URL: " .. config:baseUrl() .. (config:apiKey() and " (key saved)" or ""), "info")
if config:apiKey() then
	ui.setApiKey(config:apiKey() :: string)
end

Selection.SelectionChanged:Connect(function()
	local sequence = findSelectedSequence()
	ui.setSelection(sequence and sequence.Name or nil)
	ui.setVerdict(nil, nil)
end)

toggleButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	toggleButton:SetActive(widget.Enabled)
end)
