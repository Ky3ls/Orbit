--[[ Orbit client — Admin-Menü ]]

local menuOpen = false
local isAdmin = false
local lastTp = nil
local noclip = false
local god = false
local superjump = false
local showIds = false
local spectating = false
local spectateTarget = nil

local function chat(msg)
  TriggerEvent('chat:addMessage', { color = { 255, 122, 26 }, args = { 'Orbit', msg } })
end

local function closeMenu()
  menuOpen = false
  SetNuiFocus(false, false)
  SendNUIMessage({ action = 'close' })
end

local function notifyToggles()
  SendNUIMessage({
    action = 'toggles',
    toggles = { noclip = noclip, god = god, superjump = superjump, ids = showIds },
  })
end

local function findZ(x, y)
  local found, z = GetGroundZFor_3dCoord(x + 0.0, y + 0.0, 1000.0, false)
  if found then return z end
  return 72.0
end

local function teleportTo(x, y, z)
  local ped = PlayerPedId()
  local veh = GetVehiclePedIsIn(ped, false)
  lastTp = GetEntityCoords(ped)
  if z == nil or z == 0 then z = findZ(x, y) end
  RequestCollisionAtCoord(x, y, z)
  if veh ~= 0 then
    SetEntityCoords(veh, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
  else
    SetEntityCoords(ped, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
  end
end

-- —— Modes ——
local function setGod(state)
  god = state and true or false
  SetEntityInvincible(PlayerPedId(), god)
  notifyToggles()
  chat(god and 'Godmode an' or 'Godmode aus')
end

local function setSuperjump(state)
  superjump = state and true or false
  notifyToggles()
  chat(superjump and 'Superjump an' or 'Superjump aus')
end

local function setNoclip(state)
  noclip = state and true or false
  local ped = PlayerPedId()
  SetEntityCollision(ped, not noclip, not noclip)
  FreezeEntityPosition(ped, false)
  SetEntityVisible(ped, not noclip, false)
  SetEntityInvincible(ped, noclip or god)
  notifyToggles()
  chat(noclip and 'NoClip an' or 'NoClip aus')
end

CreateThread(function()
  while true do
    if noclip then
      local ped = PlayerPedId()
      local pos = GetEntityCoords(ped)
      local cam = GetGameplayCamRot(2)
      local speed = IsControlPressed(0, 21) and 4.0 or 1.2 -- Shift
      local dx, dy, dz = 0.0, 0.0, 0.0
      if IsControlPressed(0, 32) then -- W
        local h = math.rad(cam.z)
        dx = dx + (-math.sin(h) * speed)
        dy = dy + (math.cos(h) * speed)
      end
      if IsControlPressed(0, 33) then -- S
        local h = math.rad(cam.z)
        dx = dx - (-math.sin(h) * speed)
        dy = dy - (math.cos(h) * speed)
      end
      if IsControlPressed(0, 34) then -- A
        local h = math.rad(cam.z + 90.0)
        dx = dx + (-math.sin(h) * speed)
        dy = dy + (math.cos(h) * speed)
      end
      if IsControlPressed(0, 35) then -- D
        local h = math.rad(cam.z - 90.0)
        dx = dx + (-math.sin(h) * speed)
        dy = dy + (math.cos(h) * speed)
      end
      if IsControlPressed(0, 22) then dz = dz + speed end -- Space
      if IsControlPressed(0, 36) then dz = dz - speed end -- Ctrl
      SetEntityVelocity(ped, 0.0, 0.0, 0.0)
      SetEntityCoordsNoOffset(ped, pos.x + dx, pos.y + dy, pos.z + dz, true, true, true)
      Wait(0)
    else
      Wait(250)
    end
  end
end)

CreateThread(function()
  while true do
    if superjump then
      SetSuperJumpThisFrame(PlayerId())
      RestorePlayerStamina(PlayerId(), 100.0)
      Wait(0)
    else
      Wait(400)
    end
  end
end)

-- —— Player IDs ——
CreateThread(function()
  while true do
    if showIds then
      for _, pid in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(pid)
        if ped ~= 0 then
          local coords = GetEntityCoords(ped)
          local my = GetEntityCoords(PlayerPedId())
          if #(coords - my) < 150.0 then
            local sid = GetPlayerServerId(pid)
            local onScreen, sx, sy = World3dToScreen2d(coords.x, coords.y, coords.z + 1.1)
            if onScreen then
              SetTextScale(0.35, 0.35)
              SetTextFont(4)
              SetTextCentre(true)
              SetTextColour(255, 122, 26, 220)
              BeginTextCommandDisplayText('STRING')
              AddTextComponentSubstringPlayerName(('[%s] %s'):format(sid, GetPlayerName(pid) or ''))
              EndTextCommandDisplayText(sx, sy)
            end
          end
        end
      end
      Wait(0)
    else
      Wait(500)
    end
  end
end)

-- —— Spectate ——
local function stopSpectate()
  if not spectating then return end
  spectating = false
  local me = PlayerPedId()
  NetworkSetInSpectatorMode(false, me)
  SetEntityVisible(me, true, false)
  SetEntityCollision(me, true, true)
  if spectateTarget then
    -- stay near last pos
  end
  spectateTarget = nil
  chat('Spectate beendet')
end

local function startSpectate(serverId)
  local target = GetPlayerFromServerId(tonumber(serverId))
  if target == -1 then chat('Spieler nicht gefunden') return end
  local tped = GetPlayerPed(target)
  if tped == 0 then chat('Ped fehlt') return end
  spectating = true
  spectateTarget = serverId
  local me = PlayerPedId()
  SetEntityVisible(me, false, false)
  SetEntityCollision(me, false, false)
  NetworkSetInSpectatorMode(true, tped)
  chat('Spectate · Esc im Menü / erneut Spectate zum Beenden')
end

-- —— Events ——
RegisterNetEvent('orbit:setAdmin', function(ok)
  isAdmin = ok and true or false
end)

RegisterNetEvent('orbit:openMenu', function(payload)
  if menuOpen then return end
  menuOpen = true
  SetNuiFocus(true, true)
  SendNUIMessage({
    action = 'open',
    name = payload and payload.name or '',
    perms = payload and payload.perms or {},
    players = payload and payload.players or {},
  })
  notifyToggles()
end)

RegisterNetEvent('orbit:playerList', function(list)
  SendNUIMessage({ action = 'players', list = list or {} })
end)

RegisterNetEvent('orbit:announce', function(msg)
  chat(msg or '')
  BeginTextCommandThefeedPost('STRING')
  AddTextComponentSubstringPlayerName(('~o~Orbit~s~\n%s'):format(tostring(msg or '')))
  EndTextCommandThefeedPostTicker(false, true)
end)

RegisterNetEvent('orbit:dm', function(author, message)
  chat(('DM von %s: %s'):format(tostring(author or 'Admin'), tostring(message or '')))
end)

RegisterNetEvent('orbit:showWarning', function(payload)
  local author = type(payload) == 'table' and payload.author or 'Admin'
  local reason = type(payload) == 'table' and payload.reason or tostring(payload or '')
  chat(('WARNUNG von %s: %s'):format(tostring(author), tostring(reason)))
end)

RegisterNetEvent('orbit:heal', function()
  local ped = PlayerPedId()
  SetEntityHealth(ped, GetEntityMaxHealth(ped))
  SetPedArmour(ped, 100)
  ClearPedBloodDamage(ped)
  chat('Geheilt.')
end)

RegisterNetEvent('orbit:tpCoords', function(x, y, z)
  teleportTo(x + 0.0, y + 0.0, z + 0.0)
end)

RegisterNetEvent('orbit:freeze', function(state)
  FreezeEntityPosition(PlayerPedId(), state and true or false)
  chat(state and 'Eingefroren' or 'Aufgetaut')
end)

RegisterNetEvent('orbit:drunk', function()
  CreateThread(function()
    RequestAnimSet('move_m@drunk@verydrunk')
    while not HasAnimSetLoaded('move_m@drunk@verydrunk') do Wait(10) end
    SetPedMovementClipset(PlayerPedId(), 'move_m@drunk@verydrunk', 1.0)
    SetTimecycleModifier('spectator5')
    Wait(30000)
    ClearTimecycleModifier()
    ResetPedMovementClipset(PlayerPedId(), 0.0)
  end)
end)

RegisterNetEvent('orbit:setOnFire', function()
  StartEntityFire(PlayerPedId())
end)

RegisterNetEvent('orbit:clearArea', function(radius)
  radius = tonumber(radius) or 50.0
  local c = GetEntityCoords(PlayerPedId())
  ClearAreaOfVehicles(c.x, c.y, c.z, radius, false, false, false, false, false)
  ClearAreaOfPeds(c.x, c.y, c.z, radius, 1)
  ClearAreaOfObjects(c.x, c.y, c.z, radius, 0)
  chat(('Area gecleared (%.0fm)'):format(radius))
end)

-- —— NUI ——
RegisterNUICallback('close', function(_, cb)
  if spectating then stopSpectate() end
  closeMenu()
  cb(1)
end)

RegisterNUICallback('healSelf', function(_, cb) TriggerServerEvent('orbit:adminHeal') cb(1) end)
RegisterNUICallback('healAll', function(_, cb) TriggerServerEvent('orbit:adminHealAll') cb(1) end)
RegisterNUICallback('announce', function(data, cb)
  TriggerServerEvent('orbit:adminAnnounce', data and data.message or '')
  cb(1)
end)
RegisterNUICallback('refreshPlayers', function(_, cb)
  TriggerServerEvent('orbit:requestPlayerList')
  cb(1)
end)
RegisterNUICallback('toggleNoclip', function(data, cb) setNoclip(data and data.enabled) cb(1) end)
RegisterNUICallback('toggleGod', function(data, cb) setGod(data and data.enabled) cb(1) end)
RegisterNUICallback('toggleSuperjump', function(data, cb) setSuperjump(data and data.enabled) cb(1) end)
RegisterNUICallback('toggleIds', function(data, cb)
  showIds = data and data.enabled and true or false
  notifyToggles()
  cb(1)
end)
RegisterNUICallback('tpWaypoint', function(_, cb)
  local blip = GetFirstBlipInfoId(8)
  if not DoesBlipExist(blip) then chat('Kein Wegpunkt') cb(1) return end
  local c = GetBlipInfoIdCoord(blip)
  teleportTo(c.x, c.y, 0.0)
  cb(1)
end)
RegisterNUICallback('tpBack', function(_, cb)
  if not lastTp then chat('Kein Rücksprung') cb(1) return end
  teleportTo(lastTp.x, lastTp.y, lastTp.z)
  cb(1)
end)
RegisterNUICallback('tpCoords', function(data, cb)
  local raw = tostring(data and data.coords or '')
  local x, y, z = raw:match('([^,%s]+)%s*,%s*([^,%s]+)%s*,%s*([^,%s]+)')
  x, y, z = tonumber(x), tonumber(y), tonumber(z)
  if not x or not y then chat('Coords ungültig') cb(1) return end
  teleportTo(x, y, z or 0.0)
  cb(1)
end)
RegisterNUICallback('copyCoords', function(_, cb)
  local p = GetEntityCoords(PlayerPedId())
  local h = GetEntityHeading(PlayerPedId())
  cb({ coords = ('%.4f, %.4f, %.4f, %.4f'):format(p.x, p.y, p.z, h) })
end)
RegisterNUICallback('clearArea', function(_, cb)
  TriggerServerEvent('orbit:adminClearArea', 50.0)
  cb(1)
end)

RegisterNUICallback('vehRepair', function(_, cb)
  local veh = GetVehiclePedIsIn(PlayerPedId(), false)
  if veh == 0 then chat('Kein Fahrzeug') cb(1) return end
  SetVehicleFixed(veh)
  SetVehicleDirtLevel(veh, 0.0)
  chat('Fahrzeug repariert')
  cb(1)
end)
RegisterNUICallback('vehBoost', function(_, cb)
  local veh = GetVehiclePedIsIn(PlayerPedId(), false)
  if veh == 0 then chat('Kein Fahrzeug') cb(1) return end
  SetVehicleEnginePowerMultiplier(veh, 25.0)
  chat('Boost aktiv')
  cb(1)
end)
RegisterNUICallback('vehFlip', function(_, cb)
  local veh = GetVehiclePedIsIn(PlayerPedId(), false)
  if veh == 0 then chat('Kein Fahrzeug') cb(1) return end
  local c = GetEntityCoords(veh)
  SetEntityRotation(veh, 0.0, 0.0, GetEntityHeading(veh), 2, true)
  SetEntityCoords(veh, c.x, c.y, c.z + 0.5, false, false, false, false)
  cb(1)
end)
RegisterNUICallback('vehDelete', function(_, cb)
  local veh = GetVehiclePedIsIn(PlayerPedId(), false)
  if veh == 0 then chat('Kein Fahrzeug') cb(1) return end
  SetEntityAsMissionEntity(veh, true, true)
  DeleteVehicle(veh)
  chat('Fahrzeug gelöscht')
  cb(1)
end)

RegisterNUICallback('playerAction', function(data, cb)
  local id = tonumber(data and data.id)
  local action = data and data.action or ''
  local reason = data and data.reason or ''
  if not id then cb(1) return end

  if action == 'goto' then
    TriggerServerEvent('orbit:tpToPlayer', id)
  elseif action == 'bring' then
    TriggerServerEvent('orbit:bringPlayer', id)
  elseif action == 'freeze' then
    TriggerServerEvent('orbit:freezePlayer', id)
  elseif action == 'spectate' then
    if spectating and spectateTarget == id then stopSpectate()
    else
      closeMenu()
      startSpectate(id)
    end
  elseif action == 'heal' then
    TriggerServerEvent('orbit:healPlayer', id)
  elseif action == 'kick' then
    TriggerServerEvent('orbit:kickPlayer', id, reason ~= '' and reason or 'Orbit')
  elseif action == 'warn' then
    TriggerServerEvent('orbit:warnPlayer', id, reason ~= '' and reason or 'Warnung')
  elseif action == 'message' then
    TriggerServerEvent('orbit:messagePlayer', id, reason ~= '' and reason or '…')
  elseif action == 'ban' then
    TriggerServerEvent('orbit:banPlayer', id, reason ~= '' and reason or 'Orbit Ban', '2d')
  elseif action == 'drunk' then
    TriggerServerEvent('orbit:trollPlayer', id, 'drunk')
  elseif action == 'fire' then
    TriggerServerEvent('orbit:trollPlayer', id, 'fire')
  end
  cb(1)
end)

-- legacy aliases
RegisterNUICallback('heal', function(_, cb) TriggerServerEvent('orbit:adminHeal') cb(1) end)
RegisterNUICallback('kick', function(data, cb)
  TriggerServerEvent('orbit:kickPlayer', tonumber(data and data.id), data and data.reason or 'Orbit')
  cb(1)
end)

local function tryOpen()
  TriggerServerEvent('orbit:requestMenu')
end

RegisterCommand('orbit', tryOpen, false)
RegisterCommand('orbitmenu', tryOpen, false)
RegisterKeyMapping('orbit', 'Orbit Admin-Menü', 'keyboard', '')

CreateThread(function()
  Wait(2000)
  TriggerServerEvent('orbit:checkAdmin')
end)
