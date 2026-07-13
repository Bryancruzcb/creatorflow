--!strict
-- HTTP client for the CreatorFlow registry API (server module, /api/v1).
-- Mirrors the desktop HttpRegistryClient contract: fingerprints only, never
-- files, authenticated per account with the X-Api-Key header from /me.

local HttpService = game:GetService("HttpService")

local Config = require(script.Parent.Config)

export type Match = {
	assetId: number,
	fileName: string,
	owner: string,
	layer: string,
	distance: number,
	note: string,
}

export type Verdict = {
	verdict: string, -- "DUPLICATE" | "SIMILAR" | "CLEAR"
	matches: { Match },
}

export type Mapping = {
	id: number,
	assetId: number,
	context: string, -- ownership context the id plays in, e.g. "group:12345"
	robloxAssetId: number,
	updatedAt: string,
}

export type Asset = {
	id: number,
	fileName: string,
	fileType: string,
	sizeBytes: number,
	sha256: string,
	license: string,
	ownershipDeclared: boolean,
	createdAt: string,
}

local FILE_TYPE = "roblox-animation"

local Api = {}
Api.__index = Api

export type Api = typeof(setmetatable({} :: { config: Config.Config }, Api))

function Api.new(config: Config.Config): Api
	return setmetatable({ config = config }, Api)
end

local function decode(body: string): any
	local ok, data = pcall(HttpService.JSONDecode, HttpService, body)
	return ok and data or nil
end

function Api.request(self: Api, method: string, path: string, body: any?): (boolean, any)
	local headers: { [string]: string } = { ["Content-Type"] = "application/json" }
	local apiKey = self.config:apiKey()
	if apiKey then
		headers["X-Api-Key"] = apiKey
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = self.config:baseUrl() .. path,
			Method = method,
			Headers = headers,
			Body = if body ~= nil then HttpService:JSONEncode(body) else nil,
		})
	end)
	if not ok then
		return false, "Request failed: " .. tostring(response)
			.. " — is the CreatorFlow server running, and does this plugin have HTTP permission for that domain?"
	end

	local data = decode(response.Body)
	if not response.Success then
		local message = if typeof(data) == "table" and typeof(data.error) == "string"
			then data.error
			else string.format("HTTP %d %s", response.StatusCode, response.StatusMessage)
		return false, message
	end
	return true, data
end

function Api.health(self: Api): (boolean, any)
	return self:request("GET", "/api/v1/health")
end

--- Open endpoint: registers a username and returns { username, apiKey }.
function Api.createAccount(self: Api, username: string): (boolean, any)
	return self:request("POST", "/api/v1/accounts", { username = username })
end

--- Fingerprints in, verdict + cross-account matches out. The animation stays local.
function Api.verify(self: Api, fileName: string, sha256: string): (boolean, Verdict | string)
	return self:request("POST", "/api/v1/verify", { fileName = fileName, sha256 = sha256 })
end

function Api.register(self: Api, fileName: string, sizeBytes: number, sha256: string, license: string): (boolean, Asset | string)
	return self:request("POST", "/api/v1/assets", {
		fileName = fileName,
		fileType = FILE_TYPE,
		sizeBytes = sizeBytes,
		sha256 = sha256,
		license = license,
		ownershipDeclared = true,
	})
end

function Api.myAssets(self: Api): (boolean, { Asset } | string)
	return self:request("GET", "/api/v1/assets/mine")
end

function Api.mappings(self: Api, assetId: number): (boolean, { Mapping } | string)
	return self:request("GET", "/api/v1/assets/" .. assetId .. "/mappings")
end

--- Upsert: registering a re-upload in the same context replaces that context's id.
function Api.addMapping(self: Api, assetId: number, context: string, robloxAssetId: number): (boolean, Mapping | string)
	return self:request("POST", "/api/v1/assets/" .. assetId .. "/mappings", {
		context = context,
		robloxAssetId = robloxAssetId,
	})
end

return Api
