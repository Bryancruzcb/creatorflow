--!strict
-- Plugin settings, persisted by Studio across sessions via plugin:SetSetting.

local DEFAULT_BASE_URL = "http://localhost:8080"
local KEY_BASE_URL = "CreatorFlowBaseUrl"
local KEY_API_KEY = "CreatorFlowApiKey"

local Config = {}
Config.__index = Config

export type Config = typeof(setmetatable({} :: { plugin: Plugin }, Config))

function Config.new(plugin: Plugin): Config
	return setmetatable({ plugin = plugin }, Config)
end

function Config.baseUrl(self: Config): string
	local value = self.plugin:GetSetting(KEY_BASE_URL)
	if typeof(value) == "string" and value ~= "" then
		return value
	end
	return DEFAULT_BASE_URL
end

function Config.setBaseUrl(self: Config, url: string)
	url = url:gsub("/+$", "")
	self.plugin:SetSetting(KEY_BASE_URL, url ~= "" and url or DEFAULT_BASE_URL)
end

function Config.apiKey(self: Config): string?
	local value = self.plugin:GetSetting(KEY_API_KEY)
	if typeof(value) == "string" and value ~= "" then
		return value
	end
	return nil
end

function Config.setApiKey(self: Config, key: string?)
	self.plugin:SetSetting(KEY_API_KEY, key)
end

return Config
