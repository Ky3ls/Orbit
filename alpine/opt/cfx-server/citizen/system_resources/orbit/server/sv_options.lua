--[[ Orbit Optionen — Money, Giveaway, NPC, WorldClear, Bans, Console, Wetter ]]

local NPC_ENABLED = true
local GIVEAWAY = nil -- { prize, endsAt, entrants = { [src]=true }, timer }

local WEATHER = {
  mode = 'manual', -- manual | realtime
  weather = 'EXTRASUNNY',
  hour = 12,
  minute = 0,
  freeze = false,
  lon = 13.405,
  lat = 52.52,
  climate = 'med', -- med | rain | snow
  seasonal = true,
  blackout = false,
  interval = 60,
  city = 'berlin',
}

local CLIMATE_POOL = {
  med = { 'EXTRASUNNY', 'CLEAR', 'CLOUDS', 'OVERCAST', 'CLEARING' },
  rain = { 'CLOUDS', 'OVERCAST', 'RAIN', 'THUNDER', 'FOGGY', 'CLEARING' },
  snow = { 'SNOWLIGHT', 'SNOW', 'BLIZZARD', 'FOGGY', 'CLOUDS' },
}

local function toast(src, kind, title, msg)
  TriggerClientEvent('orbit:toast', src, kind or 'info', title or 'Orbit', msg or '')
end

local function addMoney(target, amount)
  amount = math.floor(tonumber(amount) or 0)
  if amount <= 0 or not target or GetPlayerName(target) == nil then return false end

  if GetResourceState('es_extended') == 'started' then
    local ok, ESX = pcall(function()
      return exports['es_extended']:getSharedObject()
    end)
    if not ok or not ESX then
      TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
    end
    if ESX and ESX.GetPlayerFromId then
      local xPlayer = ESX.GetPlayerFromId(target)
      if xPlayer then
        if xPlayer.addAccountMoney then
          xPlayer.addAccountMoney('money', amount)
          return true
        end
        if xPlayer.addMoney then
          xPlayer.addMoney(amount)
          return true
        end
      end
    end
  end

  if GetResourceState('qb-core') == 'started' then
    local ok, QBCore = pcall(function()
      return exports['qb-core']:GetCoreObject()
    end)
    if ok and QBCore and QBCore.Functions then
      local Player = QBCore.Functions.GetPlayer(target)
      if Player and Player.Functions and Player.Functions.AddMoney then
        Player.Functions.AddMoney('cash', amount, 'orbit-give')
        return true
      end
    end
  end

  if GetResourceState('ox_core') == 'started' then
    local ok = pcall(function()
      local player = exports.ox_core:GetPlayer(target)
      if player and player.addAccount then
        player:addAccount('money', amount)
        return true
      end
    end)
    if ok then return true end
  end

  -- Fallback: Client-Notify only — kein Framework
  return false
end

local function weatherSnapshot()
  return {
    mode = WEATHER.mode,
    weather = WEATHER.weather,
    hour = WEATHER.hour,
    minute = WEATHER.minute,
    freeze = WEATHER.freeze,
    lon = WEATHER.lon,
    lat = WEATHER.lat,
    climate = WEATHER.climate,
    seasonal = WEATHER.seasonal,
    blackout = WEATHER.blackout,
    interval = WEATHER.interval,
    city = WEATHER.city,
  }
end

local function applyWeatherToClients()
  TriggerClientEvent('orbit:weatherSync', -1, weatherSnapshot())
end

local function hashDay(seed)
  local n = 0
  local s = tostring(seed)
  for i = 1, #s do
    n = (n * 31 + s:byte(i)) % 2147483647
  end
  return n
end

local function computeRealtime()
  local now = os.time()
  local utc = os.date('!*t', now)
  -- grobe lokale Stunde aus Longitude (15° ≈ 1h)
  local offsetH = (tonumber(WEATHER.lon) or 0) / 15.0
  local localSec = now + math.floor(offsetH * 3600)
  local loc = os.date('!*t', localSec)
  local hour = loc.hour
  local minute = loc.min

  local pool = CLIMATE_POOL[WEATHER.climate] or CLIMATE_POOL.med
  local dayKey = ('%d-%d-%d-%.2f-%.2f-%s'):format(loc.year, loc.yday, loc.hour, WEATHER.lon, WEATHER.lat, WEATHER.climate)
  local idx = (hashDay(dayKey) % #pool) + 1
  local weather = pool[idx]

  if WEATHER.seasonal then
    local month = loc.month
    if WEATHER.climate == 'snow' or (month >= 12 or month <= 2) then
      if WEATHER.climate == 'snow' or month <= 2 or month == 12 then
        local winter = { 'SNOWLIGHT', 'SNOW', 'CLOUDS', 'FOGGY' }
        weather = winter[(hashDay(dayKey .. 'w') % #winter) + 1]
      end
    elseif month >= 6 and month <= 8 and WEATHER.climate == 'med' then
      local summer = { 'EXTRASUNNY', 'CLEAR', 'CLOUDS' }
      weather = summer[(hashDay(dayKey .. 's') % #summer) + 1]
    end
  end

  -- Nacht: etwas bewölkter
  if hour >= 22 or hour < 5 then
    if weather == 'EXTRASUNNY' then weather = 'CLEAR' end
  end

  WEATHER.weather = weather
  WEATHER.hour = hour
  WEATHER.minute = minute
  WEATHER.freeze = true -- PauseClock mit Serverzeit
  return weatherSnapshot()
end

-- —— Money ——
RegisterNetEvent('orbit:optGiveMoney', function(targetId, amount, all)
  local src = source
  if all then
    if not OrbitCan(src, 'moneyAll') then return end
    amount = math.floor(tonumber(amount) or 0)
    if amount <= 0 or amount > 50000000 then
      toast(src, 'warn', 'Geld', 'Betrag ungültig')
      return
    end
    local n = 0
    for _, id in ipairs(GetPlayers()) do
      local tid = tonumber(id)
      if tid and addMoney(tid, amount) then
        n = n + 1
        TriggerClientEvent('orbit:toast', tid, 'ok', 'Geld', ('+%s $'):format(amount))
      end
    end
    toast(src, 'ok', 'Geld', ('%d Spieler · +%s $'):format(n, amount))
    return
  end
  if not OrbitCan(src, 'money') then return end
  targetId = tonumber(targetId)
  amount = math.floor(tonumber(amount) or 0)
  if not targetId or GetPlayerName(targetId) == nil then
    toast(src, 'warn', 'Geld', 'Spieler offline')
    return
  end
  if amount <= 0 or amount > 50000000 then
    toast(src, 'warn', 'Geld', 'Betrag ungültig')
    return
  end
  if addMoney(targetId, amount) then
    toast(src, 'ok', 'Geld', ('#%d · +%s $'):format(targetId, amount))
    TriggerClientEvent('orbit:toast', targetId, 'ok', 'Geld', ('+%s $'):format(amount))
  else
    toast(src, 'warn', 'Geld', 'Kein Framework (ESX/QB/ox) gefunden')
  end
end)

-- —— Giveaway ——
local function stopGiveaway(reason)
  if not GIVEAWAY then return end
  if GIVEAWAY.timer then
    GIVEAWAY.timer = nil
  end
  GIVEAWAY = nil
  TriggerClientEvent('orbit:giveawayStatus', -1, { active = false, reason = reason })
end

local function finishGiveaway()
  if not GIVEAWAY then return end
  local list = {}
  for sid in pairs(GIVEAWAY.entrants or {}) do
    local id = tonumber(sid)
    if id and GetPlayerName(id) then list[#list + 1] = id end
  end
  local prize = GIVEAWAY.prize
  stopGiveaway('ended')
  if #list == 0 then
    TriggerClientEvent('orbit:announce', -1, 'Gewinnspiel beendet — keine Teilnehmer.', { author = 'Orbit' })
    return
  end
  local winner = list[math.random(1, #list)]
  local name = GetPlayerName(winner) or ('#' .. winner)
  addMoney(winner, prize)
  TriggerClientEvent('orbit:announce', -1,
    ('Gewinnspiel: %s gewinnt %s $!'):format(name, prize),
    { author = 'Orbit' })
  TriggerClientEvent('orbit:toast', winner, 'ok', 'Gewinnspiel', ('Du hast %s $ gewonnen!'):format(prize))
end

RegisterNetEvent('orbit:optGiveawayStart', function(prize, seconds)
  local src = source
  if not OrbitCan(src, 'giveaway') then return end
  prize = math.floor(tonumber(prize) or 0)
  seconds = math.floor(tonumber(seconds) or 60)
  if prize <= 0 or prize > 50000000 then
    toast(src, 'warn', 'Gewinnspiel', 'Preis ungültig')
    return
  end
  if seconds < 10 then seconds = 10 end
  if seconds > 600 then seconds = 600 end
  if GIVEAWAY then stopGiveaway('restart') end
  GIVEAWAY = {
    prize = prize,
    endsAt = os.time() + seconds,
    entrants = {},
    author = (ADMINS[tostring(src)] or {}).name or 'Admin',
  }
  TriggerClientEvent('orbit:announce', -1,
    ('Gewinnspiel gestartet! Preis: %s $ · Joinen mit /gv (%ds)'):format(prize, seconds),
    { author = GIVEAWAY.author })
  TriggerClientEvent('orbit:giveawayStatus', -1, {
    active = true, prize = prize, endsAt = GIVEAWAY.endsAt, count = 0,
  })
  local ends = GIVEAWAY.endsAt
  SetTimeout(seconds * 1000, function()
    if GIVEAWAY and GIVEAWAY.endsAt == ends then finishGiveaway() end
  end)
  toast(src, 'ok', 'Gewinnspiel', ('Läuft %ds · /gv'):format(seconds))
end)

RegisterNetEvent('orbit:optGiveawayStop', function()
  local src = source
  if not OrbitCan(src, 'giveaway') then return end
  if not GIVEAWAY then
    toast(src, 'warn', 'Gewinnspiel', 'Keins aktiv')
    return
  end
  stopGiveaway('stopped')
  TriggerClientEvent('orbit:announce', -1, 'Gewinnspiel abgebrochen.', { author = 'Orbit' })
  toast(src, 'ok', 'Gewinnspiel', 'Gestoppt')
end)

RegisterCommand('gv', function(src)
  if src == 0 then return end
  if not GIVEAWAY then
    toast(src, 'warn', 'Gewinnspiel', 'Kein aktives Gewinnspiel')
    return
  end
  local key = tostring(src)
  if GIVEAWAY.entrants[key] then
    toast(src, 'info', 'Gewinnspiel', 'Bereits beigetreten')
    return
  end
  GIVEAWAY.entrants[key] = true
  local n = 0
  for _ in pairs(GIVEAWAY.entrants) do n = n + 1 end
  toast(src, 'ok', 'Gewinnspiel', 'Du bist dabei!')
  TriggerClientEvent('orbit:giveawayStatus', -1, {
    active = true, prize = GIVEAWAY.prize, endsAt = GIVEAWAY.endsAt, count = n,
  })
end, false)

-- —— NPC ——
RegisterNetEvent('orbit:optNpc', function(enabled)
  local src = source
  if not OrbitCan(src, 'npc') then return end
  NPC_ENABLED = enabled and true or false
  TriggerClientEvent('orbit:npcToggle', -1, NPC_ENABLED)
  toast(src, 'ok', 'NPCs', NPC_ENABLED and 'An' or 'Aus')
end)

AddEventHandler('playerJoining', function()
  local src = source
  SetTimeout(2500, function()
    if GetPlayerName(src) then
      TriggerClientEvent('orbit:npcToggle', src, NPC_ENABLED)
      TriggerClientEvent('orbit:weatherSync', src, weatherSnapshot())
      if GIVEAWAY then
        local n = 0
        for _ in pairs(GIVEAWAY.entrants) do n = n + 1 end
        TriggerClientEvent('orbit:giveawayStatus', src, {
          active = true, prize = GIVEAWAY.prize, endsAt = GIVEAWAY.endsAt, count = n,
        })
      end
    end
  end)
end)

-- —— World clear ——
RegisterNetEvent('orbit:optWorldClear', function(radius)
  local src = source
  if not OrbitCan(src, 'clearArea') then return end
  radius = tonumber(radius) or 120.0
  if radius < 20 then radius = 20.0 end
  if radius > 500 then radius = 500.0 end
  TriggerClientEvent('orbit:clearArea', -1, radius)
  toast(src, 'ok', 'World Clear', ('Alle Clients · %.0fm'):format(radius))
end)

-- —— Bans / Console via Panel ——
RegisterNetEvent('orbit:optBansList', function()
  local src = source
  if not OrbitCan(src, 'banList') then return end
  OrbitHttp('GET', '/api/ingame/bans', nil, {
    ['X-Orbit-Identifiers'] = table.concat(GetPlayerIdentifiers(src) or {}, ','),
  }, function(code, resp)
    if code == 200 and type(resp) == 'table' then
      TriggerClientEvent('orbit:optBans', src, resp.bans or {})
    else
      toast(src, 'warn', 'Bans', 'Liste nicht ladbar')
      TriggerClientEvent('orbit:optBans', src, {})
    end
  end)
end)

RegisterNetEvent('orbit:optBanRevoke', function(banId)
  local src = source
  if not OrbitCan(src, 'banRevoke') then return end
  banId = tonumber(banId)
  if not banId then return end
  local admin = ADMINS[tostring(src)]
  OrbitHttp('POST', '/api/ingame/bans/revoke', {
    token = ORBIT_TOKEN,
    banId = banId,
    author = admin and admin.name or 'ingame',
    identifiers = GetPlayerIdentifiers(src),
  }, nil, function(code)
    if code == 200 then
      toast(src, 'ok', 'Ban', ('#%d aufgehoben'):format(banId))
      OrbitHttp('GET', '/api/ingame/bans', nil, {
        ['X-Orbit-Identifiers'] = table.concat(GetPlayerIdentifiers(src) or {}, ','),
      }, function(c2, resp)
        if c2 == 200 and type(resp) == 'table' then
          TriggerClientEvent('orbit:optBans', src, resp.bans or {})
        end
      end)
    else
      toast(src, 'warn', 'Ban', 'Aufheben fehlgeschlagen')
    end
  end)
end)

RegisterNetEvent('orbit:optConsoleCmd', function(command)
  local src = source
  if not OrbitCan(src, 'consoleWrite') then return end
  command = tostring(command or ''):gsub('^%s+', ''):gsub('%s+$', '')
  if command == '' or #command > 180 then
    toast(src, 'warn', 'Konsole', 'Befehl ungültig')
    return
  end
  local admin = ADMINS[tostring(src)]
  OrbitHttp('POST', '/api/ingame/console', {
    token = ORBIT_TOKEN,
    command = command,
    author = admin and admin.name or 'ingame',
    identifiers = GetPlayerIdentifiers(src),
  }, nil, function(code, resp)
    if code == 200 then
      toast(src, 'ok', 'Konsole', 'Befehl gesendet')
      TriggerClientEvent('orbit:optConsoleLine', src, ('> %s'):format(command))
    else
      toast(src, 'warn', 'Konsole', (resp and resp.error) or 'Fehlgeschlagen')
    end
  end)
end)

RegisterNetEvent('orbit:optConsoleTail', function()
  local src = source
  if not OrbitCan(src, 'console') then return end
  OrbitHttp('GET', '/api/ingame/console/tail', nil, {
    ['X-Orbit-Identifiers'] = table.concat(GetPlayerIdentifiers(src) or {}, ','),
  }, function(code, resp)
    if code == 200 and type(resp) == 'table' then
      TriggerClientEvent('orbit:optConsoleTail', src, resp.lines or {})
    end
  end)
end)

-- —— Wetter ——
RegisterNetEvent('orbit:optWeatherGet', function()
  local src = source
  if not OrbitCan(src, 'weather') then return end
  if WEATHER.mode == 'realtime' then computeRealtime() end
  TriggerClientEvent('orbit:weatherState', src, weatherSnapshot())
end)

RegisterNetEvent('orbit:optWeatherSet', function(data)
  local src = source
  if not OrbitCan(src, 'weather') then return end
  if type(data) ~= 'table' then return end
  if data.mode == 'manual' or data.mode == 'realtime' then WEATHER.mode = data.mode end
  if type(data.weather) == 'string' and data.weather ~= '' then
    WEATHER.weather = data.weather:upper():sub(1, 32)
  end
  if data.hour ~= nil then WEATHER.hour = math.max(0, math.min(23, math.floor(tonumber(data.hour) or 12))) end
  if data.minute ~= nil then WEATHER.minute = math.max(0, math.min(59, math.floor(tonumber(data.minute) or 0))) end
  if data.freeze ~= nil then WEATHER.freeze = data.freeze and true or false end
  if data.lon ~= nil then WEATHER.lon = tonumber(data.lon) or WEATHER.lon end
  if data.lat ~= nil then WEATHER.lat = tonumber(data.lat) or WEATHER.lat end
  if data.climate == 'med' or data.climate == 'rain' or data.climate == 'snow' then
    WEATHER.climate = data.climate
  end
  if data.seasonal ~= nil then WEATHER.seasonal = data.seasonal and true or false end
  if data.blackout ~= nil then WEATHER.blackout = data.blackout and true or false end
  if data.interval ~= nil then
    WEATHER.interval = math.max(15, math.min(600, math.floor(tonumber(data.interval) or 60)))
  end
  if type(data.city) == 'string' then WEATHER.city = data.city:sub(1, 32) end

  if WEATHER.mode == 'realtime' then
    computeRealtime()
  end
  applyWeatherToClients()
  toast(src, 'ok', 'Wetter', WEATHER.mode == 'realtime' and 'Echtzeit aktiv' or 'Manuell gesetzt')
  TriggerClientEvent('orbit:weatherState', src, weatherSnapshot())
end)

CreateThread(function()
  while true do
    local waitMs = math.max(15, tonumber(WEATHER.interval) or 60) * 1000
    Wait(waitMs)
    if WEATHER.mode == 'realtime' then
      computeRealtime()
      applyWeatherToClients()
    end
  end
end)

RegisterNetEvent('orbit:optStatus', function()
  local src = source
  if not OrbitIsAdmin(src) then return end
  local gv = nil
  if GIVEAWAY then
    local n = 0
    for _ in pairs(GIVEAWAY.entrants) do n = n + 1 end
    gv = { active = true, prize = GIVEAWAY.prize, endsAt = GIVEAWAY.endsAt, count = n }
  end
  TriggerClientEvent('orbit:optStatus', src, {
    npc = NPC_ENABLED,
    giveaway = gv,
    weather = weatherSnapshot(),
  })
end)
