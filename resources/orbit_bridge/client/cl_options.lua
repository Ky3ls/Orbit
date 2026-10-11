--[[ Orbit Optionen — Client: NPC density, Wetter/Zeit, NUI bridges ]]

local npcEnabled = true
local weatherState = {
  mode = 'manual',
  weather = 'EXTRASUNNY',
  hour = 12,
  minute = 0,
  freeze = false,
  blackout = false,
}

local function applyWeather(st)
  if type(st) ~= 'table' then return end
  weatherState = st
  local w = tostring(st.weather or 'EXTRASUNNY')
  ClearOverrideWeather()
  ClearWeatherTypePersist()
  SetWeatherTypeOvertimePersist(w, 15.0)
  SetWeatherTypeNow(w)
  SetWeatherTypeNowPersist(w)
  local h = math.floor(tonumber(st.hour) or 12)
  local m = math.floor(tonumber(st.minute) or 0)
  NetworkOverrideClockTime(h, m, 0)
  if st.freeze then
    PauseClock(true)
  else
    PauseClock(false)
  end
  SetArtificialLightsState(st.blackout and true or false)
  SetArtificialLightsStateAffectsVehicles(st.blackout and true or false)
end

RegisterNetEvent('orbit:weatherSync', function(st)
  applyWeather(st)
end)

RegisterNetEvent('orbit:weatherState', function(st)
  applyWeather(st)
  SendNUIMessage({ action = 'optWeather', weather = st })
end)

RegisterNetEvent('orbit:npcToggle', function(enabled)
  npcEnabled = enabled and true or false
  SendNUIMessage({ action = 'optNpc', enabled = npcEnabled })
end)

RegisterNetEvent('orbit:giveawayStatus', function(st)
  SendNUIMessage({ action = 'optGiveaway', giveaway = st })
end)

RegisterNetEvent('orbit:optBans', function(list)
  SendNUIMessage({ action = 'optBans', bans = list or {} })
end)

RegisterNetEvent('orbit:optConsoleLine', function(line)
  SendNUIMessage({ action = 'optConsoleLine', line = tostring(line or '') })
end)

RegisterNetEvent('orbit:optConsoleTail', function(lines)
  SendNUIMessage({ action = 'optConsoleTail', lines = lines or {} })
end)

RegisterNetEvent('orbit:optStatus', function(st)
  if type(st) ~= 'table' then return end
  if st.npc ~= nil then npcEnabled = st.npc and true or false end
  if st.weather then applyWeather(st.weather) end
  SendNUIMessage({ action = 'optStatus', status = st })
end)

CreateThread(function()
  while true do
    if not npcEnabled then
      SetPedDensityMultiplierThisFrame(0.0)
      SetScenarioPedDensityMultiplierThisFrame(0.0, 0.0)
      SetVehicleDensityMultiplierThisFrame(0.0)
      SetRandomVehicleDensityMultiplierThisFrame(0.0)
      SetParkedVehicleDensityMultiplierThisFrame(0.0)
      SetGarbageTrucks(false)
      SetRandomBoats(false)
      SetCreateRandomCops(false)
      SetCreateRandomCopsNotOnScenarios(false)
      SetCreateRandomCopsOnScenarios(false)
      Wait(0)
    else
      Wait(500)
    end
  end
end)

CreateThread(function()
  while true do
    if weatherState.freeze then
      NetworkOverrideClockTime(
        math.floor(tonumber(weatherState.hour) or 12),
        math.floor(tonumber(weatherState.minute) or 0),
        0
      )
      PauseClock(true)
    end
    if weatherState.blackout then
      SetArtificialLightsState(true)
    end
    Wait(1000)
  end
end)

-- NUI
RegisterNUICallback('optGiveMoney', function(data, cb)
  TriggerServerEvent('orbit:optGiveMoney', data and data.id, data and data.amount, false)
  cb(1)
end)
RegisterNUICallback('optGiveMoneyAll', function(data, cb)
  TriggerServerEvent('orbit:optGiveMoney', 0, data and data.amount, true)
  cb(1)
end)
RegisterNUICallback('optGiveawayStart', function(data, cb)
  TriggerServerEvent('orbit:optGiveawayStart', data and data.prize, data and data.seconds)
  cb(1)
end)
RegisterNUICallback('optGiveawayStop', function(_, cb)
  TriggerServerEvent('orbit:optGiveawayStop')
  cb(1)
end)
RegisterNUICallback('optNpc', function(data, cb)
  TriggerServerEvent('orbit:optNpc', data and data.enabled)
  cb(1)
end)
RegisterNUICallback('optWorldClear', function(data, cb)
  TriggerServerEvent('orbit:optWorldClear', data and data.radius)
  cb(1)
end)
RegisterNUICallback('optBansList', function(_, cb)
  TriggerServerEvent('orbit:optBansList')
  cb(1)
end)
RegisterNUICallback('optBanRevoke', function(data, cb)
  TriggerServerEvent('orbit:optBanRevoke', data and data.id)
  cb(1)
end)
RegisterNUICallback('optConsoleCmd', function(data, cb)
  TriggerServerEvent('orbit:optConsoleCmd', data and data.command)
  cb(1)
end)
RegisterNUICallback('optConsoleTail', function(_, cb)
  TriggerServerEvent('orbit:optConsoleTail')
  cb(1)
end)
RegisterNUICallback('optWeatherGet', function(_, cb)
  TriggerServerEvent('orbit:optWeatherGet')
  cb(1)
end)
RegisterNUICallback('optWeatherSet', function(data, cb)
  TriggerServerEvent('orbit:optWeatherSet', data or {})
  cb(1)
end)
RegisterNUICallback('optStatus', function(_, cb)
  TriggerServerEvent('orbit:optStatus')
  cb(1)
end)
