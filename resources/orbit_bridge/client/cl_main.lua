--[[ Orbit client — schlankes Menü ]]

local menuOpen = false

local function chat(msg)
  TriggerEvent('chat:addMessage', { color = { 255, 122, 26 }, args = { 'Orbit', msg } })
end

local function closeMenu()
  menuOpen = false
  SetNuiFocus(false, false)
  SendNUIMessage({ action = 'close' })
end

RegisterNetEvent('orbit:openMenu', function(payload)
  if menuOpen then return end
  menuOpen = true
  SetNuiFocus(true, true)
  SendNUIMessage({
    action = 'open',
    name = payload and payload.name or '',
    players = payload and payload.players or {},
  })
end)

RegisterNetEvent('orbit:playerList', function(list)
  SendNUIMessage({ action = 'players', list = list or {} })
end)

RegisterNetEvent('orbit:announce', function(msg)
  chat(msg or '')
end)

RegisterNetEvent('orbit:dm', function(author, message)
  chat(('DM von %s: %s'):format(tostring(author or 'Admin'), tostring(message or '')))
end)

RegisterNetEvent('orbit:showWarning', function(payload)
  local author = type(payload) == 'table' and payload.author or 'Admin'
  local reason = type(payload) == 'table' and payload.reason or tostring(payload or '')
  chat(('WARNUNG von %s: %s'):format(tostring(author), tostring(reason)))
  BeginTextCommandThefeedPost('STRING')
  AddTextComponentSubstringPlayerName(('~o~Orbit Warnung~s~\nVon: %s\n%s'):format(author, reason))
  EndTextCommandThefeedPostTicker(false, true)
end)

RegisterNetEvent('orbit:heal', function()
  local ped = PlayerPedId()
  SetEntityHealth(ped, GetEntityMaxHealth(ped))
  SetPedArmour(ped, 100)
  ClearPedBloodDamage(ped)
  chat('Geheilt.')
end)

RegisterNUICallback('close', function(_, cb) closeMenu() cb(1) end)
RegisterNUICallback('heal', function(_, cb) TriggerServerEvent('orbit:adminHeal') cb(1) end)
RegisterNUICallback('announce', function(data, cb)
  TriggerServerEvent('orbit:adminAnnounce', data and data.message or '')
  cb(1)
end)
RegisterNUICallback('refreshPlayers', function(_, cb)
  TriggerServerEvent('orbit:requestPlayerList')
  cb(1)
end)
RegisterNUICallback('kick', function(data, cb)
  TriggerServerEvent('orbit:kickPlayer', tonumber(data and data.id), data and data.reason or '')
  cb(1)
end)

local function tryOpen()
  TriggerServerEvent('orbit:requestMenu')
end

RegisterCommand('orbit', tryOpen, false)
RegisterCommand('orbitmenu', tryOpen, false)
RegisterCommand('tx', tryOpen, false)
RegisterKeyMapping('orbit', 'Orbit Admin-Menü', 'keyboard', '')

CreateThread(function()
  Wait(2000)
  TriggerServerEvent('orbit:checkAdmin')
end)
