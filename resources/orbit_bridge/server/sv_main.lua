--[[ Orbit server — Auth + Live-Playerlist (wie txAdmin: playerJoining/Dropped, nicht players.json) ]]

local RESOURCE = GetCurrentResourceName()
local PANEL = GetConvar('orbit_panelUrl', GetConvar('orbit_panel_url', 'http://127.0.0.1:40220'))
-- Token aus Convar ODER GlobalState (überlebt ensure orbit — Convar wird nach Read geleert wie txAdmin)
ORBIT_TOKEN = GetConvar('orbit_luaComToken', GetConvar('orbit_ingame_token', ''))
if ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed' then
  GlobalState['orbit_luaComToken'] = ORBIT_TOKEN
  SetConvar('orbit_luaComToken', 'removed')
  SetConvar('orbit_ingame_token', 'removed')
elseif type(GlobalState['orbit_luaComToken']) == 'string' and GlobalState['orbit_luaComToken'] ~= '' then
  ORBIT_TOKEN = GlobalState['orbit_luaComToken']
end

ADMINS = ADMINS or {}

local function idsOf(src)
  return table.concat(GetPlayerIdentifiers(src) or {}, ',')
end

function OrbitHttp(method, path, body, extraHeaders, cb)
  local url = (PANEL:gsub('/$', '')) .. path
  local hdrs = extraHeaders or {}
  hdrs['Content-Type'] = 'application/json'
  if ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed' then
    hdrs['X-Orbit-Token'] = ORBIT_TOKEN
  end
  PerformHttpRequest(url, function(code, data)
    local ok, parsed = pcall(json.decode, data or '')
    if cb then cb(code, ok and parsed or nil) end
  end, method, body and json.encode(body) or '', hdrs)
end

function OrbitAuth(src, cb)
  if ORBIT_TOKEN == '' or ORBIT_TOKEN == 'removed' then
    cb(false, 'Panel nicht verbunden')
    return
  end
  OrbitHttp('GET', '/api/ingame/auth/self', nil, {
    ['X-Orbit-Identifiers'] = idsOf(src),
  }, function(code, resp)
    if code ~= 200 or type(resp) ~= 'table' or resp.logout or type(resp.name) ~= 'string' then
      ADMINS[tostring(src)] = nil
      cb(false, (resp and resp.reason) or 'Kein Panel-Admin')
      return
    end
    ADMINS[tostring(src)] = { name = resp.name, menu = resp.permissions or {}, role = resp.role }
    cb(true, resp.name, resp.permissions)
  end)
end

function OrbitIsAdmin(src)
  return ADMINS[tostring(src)] ~= nil
end

function OrbitCan(src, perm)
  local a = ADMINS[tostring(src)]
  if not a then return false end
  if not perm then return true end
  if a.menu[perm] == nil then return true end
  return a.menu[perm] == true
end

--- Echte FX-Playerlist via GetPlayers() — players.json liefert oft Ghosts ohne Identifier
function OrbitPlayerList()
  local list = {}
  for _, id in ipairs(GetPlayers()) do
    local src = tonumber(id)
    local ids = GetPlayerIdentifiers(id) or {}
    list[#list + 1] = {
      id = src,
      name = GetPlayerName(id) or ('#' .. id),
      ping = GetPlayerPing(id) or 0,
      identifiers = ids,
    }
  end
  return list
end

local function tokenReady()
  return ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed'
end

local function pushPlayers(payload)
  if not tokenReady() then return end
  payload.token = ORBIT_TOKEN
  OrbitHttp('POST', '/api/ingame/players-sync', payload, nil, function(code)
    if code ~= 200 then
      print(('^1[orbit]^0 players-sync HTTP %s'):format(tostring(code)))
    elseif payload.event == 'playerJoining' then
      local p = payload.player or {}
      print(('^2[orbit]^0 Spieler online: %s (#%s)'):format(tostring(p.name or '?'), tostring(p.id or '?')))
    elseif payload.event == 'playerDropped' then
      print(('^3[orbit]^0 Spieler offline: #%s'):format(tostring(payload.id or '?')))
    end
  end)
end

local function syncFull()
  pushPlayers({ event = 'full', players = OrbitPlayerList() })
end

local function syncJoin(src)
  src = tonumber(src)
  if not src then return end
  -- Identifier sind oft erst nach 1 Tick verfügbar
  for _ = 1, 8 do
    local ids = GetPlayerIdentifiers(src) or {}
    if #ids > 0 or GetPlayerName(src) == nil then break end
    Wait(50)
  end
  if GetPlayerName(src) == nil then return end
  pushPlayers({
    event = 'playerJoining',
    player = {
      id = src,
      name = GetPlayerName(src) or ('#' .. src),
      ping = GetPlayerPing(src) or 0,
      identifiers = GetPlayerIdentifiers(src) or {},
    },
  })
end

local function syncDrop(src, reason)
  src = tonumber(src)
  if not src then return end
  pushPlayers({
    event = 'playerDropped',
    id = src,
    reason = reason and tostring(reason) or '',
  })
end

--- txAdmin-Style: sofort bei Join/Leave melden
AddEventHandler('playerJoining', function()
  local src = source
  CreateThread(function()
    syncJoin(src)
  end)
end)

AddEventHandler('playerDropped', function(reason)
  local src = source
  ADMINS[tostring(src)] = nil
  syncDrop(src, reason)
end)

--- Backup-Vollsync (falls Event verpasst / Panel neu gestartet)
CreateThread(function()
  Wait(2500)
  while true do
    syncFull()
    Wait(3000)
  end
end)

RegisterNetEvent('orbit:checkAdmin', function()
  local src = source
  OrbitAuth(src, function(ok, info)
    TriggerClientEvent('orbit:setAdmin', src, ok, info)
  end)
end)

RegisterNetEvent('orbit:requestMenu', function()
  local src = source
  OrbitAuth(src, function(ok, info, perms)
    if not ok then
      TriggerClientEvent('chat:addMessage', src, { args = { 'Orbit', tostring(info) } })
      return
    end
    TriggerClientEvent('orbit:openMenu', src, {
      name = info,
      perms = perms or {},
      players = OrbitPlayerList(),
    })
  end)
end)

RegisterNetEvent('orbit:requestPlayerList', function()
  local src = source
  if not OrbitIsAdmin(src) then return end
  TriggerClientEvent('orbit:playerList', src, OrbitPlayerList())
end)

AddEventHandler('onResourceStart', function(res)
  if res ~= RESOURCE then return end
  print(('^2[orbit]^0 v4 · Panel %s · Token %s · Live-Playerlist'):format(
    PANEL,
    tokenReady() and 'ok' or 'fehlt'
  ))
  CreateThread(function()
    Wait(1500)
    syncFull()
  end)
end)

RegisterCommand('orbit', function(source)
  if source == 0 then
    print(('[orbit] Panel %s · online %d'):format(PANEL, #GetPlayers()))
    syncFull()
  end
end, false)
