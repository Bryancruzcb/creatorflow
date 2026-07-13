--!strict
-- Canonical text form of a KeyframeSequence, so identical animation content
-- always produces the same fingerprint no matter who exports it or what the
-- sequence is called. Pose names participate (they bind poses to rig parts);
-- the sequence's own display name does not.

local Serialize = {}

local FORMAT_VERSION = "creatorflow-anim/v1"

local function fmt(n: number): string
	-- fixed precision keeps the digest stable across float formatting noise
	local s = string.format("%.5f", n)
	return s == "-0.00000" and "0.00000" or s
end

local function cframeText(cf: CFrame): string
	local parts = { cf:GetComponents() }
	local out = table.create(#parts)
	for i, component in parts do
		out[i] = fmt(component)
	end
	return table.concat(out, ",")
end

local function byName(a: Instance, b: Instance): boolean
	return a.Name < b.Name
end

local function writePose(pose: Pose, path: string, lines: { string })
	table.insert(lines, table.concat({
		"pose", path, fmt(pose.Weight),
		pose.EasingStyle.Name, pose.EasingDirection.Name,
		cframeText(pose.CFrame),
	}, "|"))
	local subPoses = pose:GetSubPoses()
	table.sort(subPoses, byName)
	for _, sub in subPoses do
		if sub:IsA("Pose") then
			writePose(sub, path .. "/" .. sub.Name, lines)
		end
	end
end

function Serialize.keyframeSequence(sequence: KeyframeSequence): string
	local lines = { FORMAT_VERSION }
	table.insert(lines, "loop|" .. tostring(sequence.Loop))
	table.insert(lines, "priority|" .. sequence.Priority.Name)

	local keyframes = sequence:GetKeyframes()
	table.sort(keyframes, function(a, b)
		local ka = a :: Keyframe
		local kb = b :: Keyframe
		if ka.Time == kb.Time then
			return ka.Name < kb.Name
		end
		return ka.Time < kb.Time
	end)

	for _, instance in keyframes do
		local keyframe = instance :: Keyframe
		table.insert(lines, "keyframe|" .. fmt(keyframe.Time))

		local markers = keyframe:GetMarkers()
		table.sort(markers, byName)
		for _, marker in markers do
			local m = marker :: KeyframeMarker
			table.insert(lines, "marker|" .. m.Name .. "|" .. m.Value)
		end

		local poses = keyframe:GetPoses()
		table.sort(poses, byName)
		for _, pose in poses do
			if pose:IsA("Pose") then
				writePose(pose, pose.Name, lines)
			end
		end
	end

	return table.concat(lines, "\n")
end

return Serialize
