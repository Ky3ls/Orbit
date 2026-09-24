--[[ Orbit server — Auth + Playerlisten ]]

local RESOURCE = GetCurrentResourceName()
local PANEL = GetConvar('orbit_panelUrl', GetConvar('orbit_panel_url', 'http://127.0.0.1:40220'))
ORBIT_TOKEN = GetConvar('orbit_luaComToken', GetConvar('orbit_ingame_token', ''))

if ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed' then
  SetConvar('orbit_luaComToken', 'removed')
  SetConvar('orbit_ingame_token', 'removed')
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
    cb(code, ok and parsed or nil)
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

--- Panel-Sync: echte Identifier (players.json liefert oft Ghosts ohne IDs)
CreateThread(function()
  Wait(4000)
  while true do
    if ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed' then
      local list = OrbitPlayerList()
      OrbitHttp('POST', '/api/ingame/players-sync', {
        token = ORBIT_TOKEN,
        players = list,
      }, nil, function() end)
    end
    Wait(4000)
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

AddEventHandler('playerDropped', function()
  ADMINS[tostring(source)] = nil
end)

AddEventHandler('onResourceStart', function(res)
  if res ~= RESOURCE then return end
  print(('^2[orbit]^0 v3 · Panel %s · Token %s'):format(
    PANEL,
    (ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed') and 'ok' or 'fehlt'
  ))
end)

RegisterCommand('orbit', function(source)
  if source == 0 then
    print(('[orbit] Panel %s'):format(PANEL))
  end
end, false)
