--[[ Orbit server actions — Menü-Aktionen ]]

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

RegisterNetEvent('orbit:adminHealAll', function()
  local src = source
  if not OrbitCan(src, 'healAll') then return end
  TriggerClientEvent('orbit:heal', -1)
  TriggerEvent('orbit:events:playerHealed', { target = -1, author = (ADMINS[tostring(src)] or {}).name })
end)

RegisterNetEvent('orbit:healPlayer', function(targetId)
  local src = source
  if not OrbitCan(src, 'healSelf') then return end
  targetId = tonumber(targetId)
  if not targetId or GetPlayerName(targetId) == nil then return end
  TriggerClientEvent('orbit:heal', targetId)
  TriggerEvent('orbit:events:playerHealed', {
    target = targetId,
    author = (ADMINS[tostring(src)] or {}).name,
  })
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

RegisterNetEvent('orbit:adminClearArea', function(radius)
  local src = source
  if not OrbitCan(src, 'clearArea') then return end
  TriggerClientEvent('orbit:clearArea', src, tonumber(radius) or 50.0)
end)

RegisterNetEvent('orbit:tpToPlayer', function(targetId)
  local src = source
  if not OrbitCan(src, 'goto') then return end
  targetId = tonumber(targetId)
  if not targetId or GetPlayerName(targetId) == nil then return end
  local ped = GetPlayerPed(targetId)
  local c = GetEntityCoords(ped)
  TriggerClientEvent('orbit:tpCoords', src, c.x, c.y, c.z + 0.5)
end)

RegisterNetEvent('orbit:bringPlayer', function(targetId)
  local src = source
  if not OrbitCan(src, 'bring') then return end
  targetId = tonumber(targetId)
  if not targetId or GetPlayerName(targetId) == nil then return end
  local ped = GetPlayerPed(src)
  local c = GetEntityCoords(ped)
  TriggerClientEvent('orbit:tpCoords', targetId, c.x, c.y, c.z + 0.5)
end)

RegisterNetEvent('orbit:freezePlayer', function(targetId)
  local src = source
  if not OrbitCan(src, 'freeze') then return end
  targetId = tonumber(targetId)
  if not targetId or GetPlayerName(targetId) == nil then return end
  -- toggle via client state is simplistic: always freeze then unfreeze via second call
  -- store toggle
  FREEZE = FREEZE or {}
  local key = tostring(targetId)
  FREEZE[key] = not FREEZE[key]
  TriggerClientEvent('orbit:freeze', targetId, FREEZE[key])
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

RegisterNetEvent('orbit:warnPlayer', function(targetId, reason)
  local src = source
  if not OrbitCan(src, 'warn') then return end
  targetId = tonumber(targetId)
  if not targetId then return end
  reason = tostring(reason or 'Warnung')
  local author = (ADMINS[tostring(src)] or {}).name or 'Admin'
  panelAction(src, 'warn', { playerId = targetId, reason = reason }, function()
    TriggerClientEvent('orbit:showWarning', targetId, { author = author, reason = reason })
  end)
end)

RegisterNetEvent('orbit:messagePlayer', function(targetId, message)
  local src = source
  if not OrbitCan(src, 'message') then return end
  targetId = tonumber(targetId)
  if not targetId then return end
  message = tostring(message or '')
  if message == '' then return end
  local author = (ADMINS[tostring(src)] or {}).name or 'Admin'
  panelAction(src, 'message', { playerId = targetId, message = message }, function()
    TriggerClientEvent('orbit:dm', targetId, author, message)
  end)
end)

RegisterNetEvent('orbit:banPlayer', function(targetId, reason, durationId)
  local src = source
  if not OrbitCan(src, 'ban') then return end
  targetId = tonumber(targetId)
  if not targetId then return end
  reason = tostring(reason or 'Orbit Ban')
  local hours = 48
  if durationId == '2h' then hours = 2
  elseif durationId == '8h' then hours = 8
  elseif durationId == '1d' then hours = 24
  elseif durationId == '7d' then hours = 168
  elseif durationId == 'perm' then hours = 0
  end
  panelAction(src, 'ban', {
    playerId = targetId,
    reason = reason,
    hours = hours,
  }, function(ok)
    if ok then DropPlayer(targetId, reason) end
  end)
end)

RegisterNetEvent('orbit:trollPlayer', function(targetId, kind)
  local src = source
  if not OrbitCan(src, 'players') then return end
  targetId = tonumber(targetId)
  if not targetId or GetPlayerName(targetId) == nil then return end
  if kind == 'drunk' then
    TriggerClientEvent('orbit:drunk', targetId)
  elseif kind == 'fire' then
    TriggerClientEvent('orbit:setOnFire', targetId)
  end
end)

-- NoClip Ptfx-Sync an Nearby (Client spielt lokal selbst)
RegisterNetEvent('orbit:reqPtfx', function(nearbyPlayers)
  local src = source
  if not OrbitIsAdmin(src) then return end
  if not OrbitCan(src, 'noclip') then return end
  if GetConvarBool('orbit_menuPtfxDisable', false) or GetConvarBool('orbit-menuPtfxDisable', false) then
    return
  end
  if type(nearbyPlayers) ~= 'table' then return end
  local n = 0
  for _, v in ipairs(nearbyPlayers) do
    local tid = tonumber(v)
    if tid and tid ~= src and GetPlayerName(tid) then
      TriggerClientEvent('orbit:showPtfx', tid, src)
      n = n + 1
      if n >= 32 then break end -- Bound für Spam-Schutz
    end
  end
end)
