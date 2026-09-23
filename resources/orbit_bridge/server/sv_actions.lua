--[[ Orbit server actions — Kick / Announce / Heal ]]

local function panelAction(src, action, extra, cb)
  if not OrbitIsAdmin(src) then if cb then cb(false) end return end
  local admin = ADMINS[tostring(src)]
  local payload = {
    token = ORBIT_TOKEN,
    action = action,
    author = admin and admin.name or 'ingame',
    identifiers = GetPlayerIdentifiers(src),
  }
  for k, v in pairs(extra or {}) do payload[k] = v end
  OrbitHttp('POST', '/api/ingame/action', payload, nil, function(code)
    if cb then cb(code == 200) end
  end)
end

RegisterNetEvent('orbit:adminHeal', function()
  local src = source
  if not OrbitCan(src, 'healSelf') then return end
  TriggerClientEvent('orbit:heal', src)
end)

RegisterNetEvent('orbit:adminAnnounce', function(msg)
  local src = source
  if not OrbitCan(src, 'announce') then return end
  msg = tostring(msg or '')
  if msg == '' then return end
  panelAction(src, 'announce', { message = msg }, function()
    TriggerClientEvent('orbit:announce', -1, msg)
  end)
end)

RegisterNetEvent('orbit:kickPlayer', function(targetId, reason)
  local src = source
  if not OrbitCan(src, 'kick') then return end
  targetId = tonumber(targetId)
  if not targetId then return end
  reason = tostring(reason or 'Orbit')
  panelAction(src, 'kick', { playerId = targetId, reason = reason }, function(ok)
    if not ok then DropPlayer(targetId, reason) end
  end)
end)
