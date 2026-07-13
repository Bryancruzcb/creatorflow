--!strict
-- Pure-Luau SHA-256 (FIPS 180-4). The animation itself never leaves Studio:
-- the plugin sends this digest to the CreatorFlow registry, the same way the
-- desktop app sends fingerprints instead of files.

local K = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}

local MOD = 0x100000000

local Sha256 = {}

function Sha256.hex(message: string): string
	local length = #message
	local padded = message
		.. "\128"
		.. string.rep("\0", (55 - length) % 64)
		.. string.pack(">I4I4", math.floor(length / 0x20000000), (length * 8) % MOD)

	local h0, h1, h2, h3, h4, h5, h6, h7 =
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
		0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19

	local w = table.create(64, 0)
	for chunk = 1, #padded, 64 do
		for i = 1, 16 do
			w[i] = string.unpack(">I4", padded, chunk + (i - 1) * 4)
		end
		for i = 17, 64 do
			local x, y = w[i - 15], w[i - 2]
			local s0 = bit32.bxor(bit32.rrotate(x, 7), bit32.rrotate(x, 18), bit32.rshift(x, 3))
			local s1 = bit32.bxor(bit32.rrotate(y, 17), bit32.rrotate(y, 19), bit32.rshift(y, 10))
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) % MOD
		end

		local a, b, c, d, e, f, g, h = h0, h1, h2, h3, h4, h5, h6, h7
		for i = 1, 64 do
			local s1 = bit32.bxor(bit32.rrotate(e, 6), bit32.rrotate(e, 11), bit32.rrotate(e, 25))
			local ch = bit32.bxor(bit32.band(e, f), bit32.band(bit32.bnot(e), g))
			local temp1 = (h + s1 + ch + K[i] + w[i]) % MOD
			local s0 = bit32.bxor(bit32.rrotate(a, 2), bit32.rrotate(a, 13), bit32.rrotate(a, 22))
			local maj = bit32.bxor(bit32.band(a, b), bit32.band(a, c), bit32.band(b, c))
			local temp2 = (s0 + maj) % MOD
			h, g, f, e, d, c, b, a =
				g, f, e, (d + temp1) % MOD, c, b, a, (temp1 + temp2) % MOD
		end

		h0 = (h0 + a) % MOD
		h1 = (h1 + b) % MOD
		h2 = (h2 + c) % MOD
		h3 = (h3 + d) % MOD
		h4 = (h4 + e) % MOD
		h5 = (h5 + f) % MOD
		h6 = (h6 + g) % MOD
		h7 = (h7 + h) % MOD
	end

	return string.format("%08x%08x%08x%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4, h5, h6, h7)
end

--- Known-answer check; the plugin refuses to load if this fails, because a
--- wrong digest would silently poison the registry.
function Sha256.selfTest(): boolean
	return Sha256.hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
		and Sha256.hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
end

return Sha256
