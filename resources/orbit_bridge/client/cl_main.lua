--[[ Orbit client — Admin-Menü ]]

local menuOpen = false
local menuCursor = false
local isAdmin = false
local lastTp = nil
local god = false
local superjump = false
local showIds = false
local spectating = false
local spectateTarget = nil

-- Nie chat:addMessage — spamt Chat + bricht esx_rpchat (GetPlayerName null).
local function toast(kind, title, message, duration)
  SendNUIMessage({
    action = 'toast',
    kind = kind or 'info',
    title = title or 'Orbit',
    message = tostring(message or ''),
    duration = duration,
  })
end

RegisterNetEvent('orbit:toast', function(kind, title, message, duration)
  toast(kind, title, message, duration)
end)

local function closeMenu()
  menuOpen = false
  menuCursor = false
  SetNuiFocusKeepInput(false)
  SetNuiFocus(false, false)
  SendNUIMessage({ action = 'close' })
end

local function rotationToDir(rot)
  local z = math.rad(rot.z)
  local x = math.rad(rot.x)
  local num = math.abs(math.cos(x))
  return vector3(-math.sin(z) * num, math.cos(z) * num, math.sin(x))
end

--- Fahrzeug: Sitz ODER Blickrichtung / Raycast (nicht nur im Fahrzeug)
local function getTargetVehicle(maxDist)
  maxDist = tonumber(maxDist) or 10.0
  local ped = PlayerPedId()
  local seated = GetVehiclePedIsIn(ped, false)
  if seated ~= 0 then return seated end

  local cam = GetGameplayCamCoord()
  local dir = rotationToDir(GetGameplayCamRot(2))
  local dest = cam + (dir * maxDist)
  local ray = StartShapeTestRay(cam.x, cam.y, cam.z, dest.x, dest.y, dest.z, 10, ped, 0)
  local _, hit, _, _, ent = GetShapeTestResult(ray)
  if hit == 1 and ent and ent ~= 0 and IsEntityAVehicle(ent) then
    return ent
  end

  local aiming, aimEnt = GetEntityPlayerIsFreeAimingAt(PlayerId())
  if aiming and aimEnt and aimEnt ~= 0 and IsEntityAVehicle(aimEnt) then
    return aimEnt
  end

  local my = GetEntityCoords(ped)
  local best, bestDist = 0, maxDist
  for _, veh in ipairs(GetGamePool('CVehicle')) do
    local vc = GetEntityCoords(veh)
    local dist = #(vc - my)
    if dist < bestDist then
      local to = vc - cam
      local len = #to
      if len > 0.05 then
        local dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / len
        if dot > 0.55 then
          best = veh
          bestDist = dist
        end
      end
    end
  end
  return best
end

-- Für „Zurück“-Teleport: Noclip speichert Startcoords wie txAdmin lastTpCoords
function OrbitNoclipOnEnable(coords)
  if coords then lastTp = coords end
end

local function notifyToggles()
  SendNUIMessage({
    action = 'toggles',
    toggles = {
      noclip = OrbitIsNoclip and OrbitIsNoclip() or false,
      god = god,
      superjump = superjump,
      ids = showIds,
    },
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
  if god and OrbitIsNoclip and OrbitIsNoclip() then
    OrbitSetNoclip(false)
  end
  SetEntityInvincible(PlayerPedId(), god or (OrbitIsNoclip and OrbitIsNoclip()))
  notifyToggles()
  toast('ok', 'Modus', god and 'Godmode an' or 'Godmode aus')
end

local function setSuperjump(state)
  superjump = state and true or false
  notifyToggles()
  toast('ok', 'Modus', superjump and 'Superjump an' or 'Superjump aus')
end

local function setNoclip(state)
  -- txAdmin-Freecam 1:1 (cl_noclip.lua)
  if god and state then
    god = false -- wie txAdmin: vor Noclip Godmode aus
  end
  local on = OrbitSetNoclip(state and true or false)
  if on and not god then
    -- Freecam setzt Invincible selbst
  elseif not on then
    SetEntityInvincible(PlayerPedId(), god)
  end
  notifyToggles()
  toast('ok', 'Modus', on and 'NoClip an' or 'NoClip aus')
end

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

-- —— Player IDs + HP/Armor-Balken (Balken RECHTS neben der ID) ——
local function pedHealthPct(ped)
  local hp = GetEntityHealth(ped)
  local maxHp = GetEntityMaxHealth(ped)
  if maxHp <= 100 then maxHp = 200 end
  local pct = ((hp - 100) / (maxHp - 100)) * 100.0
  if pct < 0.0 then pct = 0.0 end
  if pct > 100.0 then pct = 100.0 end
  return pct
end

local function pedArmorPct(ped)
  local a = GetPedArmour(ped) or 0
  if a < 0 then a = 0 end
  if a > 100 then a = 100 end
  return a + 0.0
end

local function measureTextWidth(label, scale)
  SetTextScale(scale, scale)
  SetTextFont(4)
  local ok, w = pcall(function()
    BeginTextCommandGetWidth('STRING')
    AddTextComponentSubstringPlayerName(label)
    return EndTextCommandGetWidth(true)
  end)
  if ok and type(w) == 'number' and w > 0.001 then return w end
  -- Fallback: grobe Breite aus Zeichenlänge
  return math.min(0.22, (#tostring(label)) * 0.0048 * (scale / 0.35))
end

--- Screen-Balken (0–1), Zentrum bei (cx, cy)
local function drawStatBar(cx, cy, pct, r, g, b, barW, barH)
  local fill = math.max(0.0, math.min(1.0, pct / 100.0))
  DrawRect(cx, cy, barW + 0.0018, barH + 0.0018, 0, 0, 0, 140)
  DrawRect(cx, cy, barW, barH, 20, 20, 24, 170)
  if fill > 0.001 then
    local fillW = barW * fill
    local fillX = cx - (barW * 0.5) + (fillW * 0.5)
    DrawRect(fillX, cy, fillW, barH * 0.7, r, g, b, 235)
  end
end

CreateThread(function()
  local textScale = 0.35
  local barW, barH = 0.038, 0.0052
  local barGapY = 0.0072
  local padX = 0.008
  while true do
    if showIds then
      local myCoords = GetEntityCoords(PlayerPedId())
      for _, pid in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(pid)
        if ped ~= 0 then
          local coords = GetEntityCoords(ped)
          if #(coords - myCoords) < 150.0 then
            local sid = GetPlayerServerId(pid)
            local label = ('[%s] %s'):format(sid, GetPlayerName(pid) or '')
            local onScreen, sx, sy = World3dToScreen2d(coords.x, coords.y, coords.z + 1.15)
            if onScreen then
              local textW = measureTextWidth(label, textScale)
              SetTextScale(textScale, textScale)
              SetTextFont(4)
              SetTextCentre(true)
              SetTextColour(255, 122, 26, 220)
              SetTextOutline()
              BeginTextCommandDisplayText('STRING')
              AddTextComponentSubstringPlayerName(label)
              EndTextCommandDisplayText(sx, sy)

              -- Balken rechts neben der ID (gleiche Höhe, kein Overlap)
              local barX = sx + (textW * 0.5) + padX + (barW * 0.5)
              -- Text-Y ist oben; Balken-Zentrum ≈ Textmitte
              local midY = sy + 0.012
              local hp = pedHealthPct(ped)
              local armor = pedArmorPct(ped)
              local hr, hg, hb = 80, 200, 90
              if hp < 35.0 then
                hr, hg, hb = 230, 70, 70
              elseif hp < 65.0 then
                hr, hg, hb = 230, 180, 60
              end
              drawStatBar(barX, midY - (barGapY * 0.5), hp, hr, hg, hb, barW, barH)
              drawStatBar(barX, midY + (barGapY * 0.5), armor, 70, 140, 230, barW, barH)
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
  toast('info', 'Spectate', 'Beendet')
end

local function startSpectate(serverId)
  local target = GetPlayerFromServerId(tonumber(serverId))
  if target == -1 then toast('warn', 'Spectate', 'Spieler nicht gefunden') return end
  local tped = GetPlayerPed(target)
  if tped == 0 then toast('warn', 'Spectate', 'Ped fehlt') return end
  spectating = true
  spectateTarget = serverId
  local me = PlayerPedId()
  SetEntityVisible(me, false, false)
  SetEntityCollision(me, false, false)
  NetworkSetInSpectatorMode(true, tped)
  toast('info', 'Spectate', 'Esc im Menü / erneut Spectate zum Beenden')
end

-- —— Events ——
RegisterNetEvent('orbit:setAdmin', function(ok)
  isAdmin = ok and true or false
end)

RegisterNetEvent('orbit:openMenu', function(payload)
  if menuOpen then return end
  menuOpen = true
  menuCursor = false
  local game = payload and payload.game or {}
  -- Main: Tastatur-Menü + laufen/umschauen (KeepInput)
  SetNuiFocus(true, false)
  SetNuiFocusKeepInput(true)
  SendNUIMessage({
    action = 'open',
    name = payload and payload.name or '',
    perms = payload and payload.perms or {},
    players = payload and payload.players or {},
    game = game,
    alignRight = game.alignRight == true,
    pageKey = game.pageKey or 'Tab',
  })
  notifyToggles()
end)

RegisterNetEvent('orbit:playerList', function(list)
  SendNUIMessage({ action = 'players', list = list or {} })
end)

RegisterNetEvent('orbit:announce', function(msg, meta)
  local hide = type(meta) == 'table' and meta.hide
  if hide then return end
  local author = type(meta) == 'table' and meta.author or nil
  if type(meta) == 'table' and meta.hideAdmin then author = nil end
  SendNUIMessage({
    action = 'announceUi',
    message = tostring(msg or ''),
    author = author and tostring(author) or nil,
    duration = 8000,
  })
end)

RegisterNetEvent('orbit:dm', function(author, message, meta)
  local hideName = type(meta) == 'table' and meta.hideAdmin
  local hideNotif = type(meta) == 'table' and meta.hide
  if hideNotif then return end
  local who = hideName and 'Admin' or tostring(author or 'Admin')
  SendNUIMessage({
    action = 'toast',
    kind = 'dm',
    title = 'DM',
    message = tostring(message or ''),
    meta = ('von %s'):format(who),
    duration = 6000,
  })
end)

RegisterNetEvent('orbit:showWarning', function(payload)
  local author = type(payload) == 'table' and payload.author or 'Admin'
  local reason = type(payload) == 'table' and payload.reason or tostring(payload or '')
  local hideName = type(payload) == 'table' and payload.hideAdmin
  local hideNotif = type(payload) == 'table' and payload.hide
  if hideNotif then return end
  local who = hideName and 'Admin' or tostring(author)
  SendNUIMessage({
    action = 'toast',
    kind = 'warn',
    title = 'Verwarnung',
    message = tostring(reason),
    meta = ('von %s'):format(who),
    duration = 7000,
  })
end)

RegisterNetEvent('orbit:heal', function()
  local ped = PlayerPedId()
  SetEntityHealth(ped, GetEntityMaxHealth(ped))
  SetPedArmour(ped, 100)
  ClearPedBloodDamage(ped)
  -- ESX: Hunger + Durst voll (esx_basicneeds / esx_status)
  if GetResourceState('esx_basicneeds') == 'started' then
    TriggerEvent('esx_basicneeds:healPlayer')
  elseif GetResourceState('esx_status') == 'started' then
    TriggerEvent('esx_status:set', 'hunger', 1000000)
    TriggerEvent('esx_status:set', 'thirst', 1000000)
  end
  toast('ok', 'Heilung', 'HP, Weste, Essen & Trinken voll')
end)

RegisterNetEvent('orbit:armor', function()
  SetPedArmour(PlayerPedId(), 100)
  toast('ok', 'Weste', 'Rüstung voll')
end)

RegisterNetEvent('orbit:tpCoords', function(x, y, z)
  teleportTo(x + 0.0, y + 0.0, z + 0.0)
end)

RegisterNetEvent('orbit:freeze', function(state)
  FreezeEntityPosition(PlayerPedId(), state and true or false)
  toast('info', 'Freeze', state and 'Eingefroren' or 'Aufgetaut')
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
  toast('ok', 'Area', ('Bereinigt (%.0fm)'):format(radius))
end)

-- —— NUI ——
RegisterNUICallback('close', function(_, cb)
  if spectating then stopSpectate() end
  closeMenu()
  cb(1)
end)

RegisterNUICallback('setCursor', function(data, cb)
  if not menuOpen then cb(0) return end
  local want = data and data.enabled and true or false
  menuCursor = want
  SetNuiFocus(true, want)
  -- Ohne Maus: Spiel-Input behalten (laufen/gucken). Mit Maus: nur NUI.
  SetNuiFocusKeepInput(not want)
  cb(1)
end)

RegisterNUICallback('healSelf', function(_, cb) TriggerServerEvent('orbit:adminHeal') cb(1) end)
RegisterNUICallback('healAll', function(_, cb) TriggerServerEvent('orbit:adminHealAll') cb(1) end)
RegisterNUICallback('armorSelf', function(_, cb) TriggerServerEvent('orbit:adminArmor') cb(1) end)
RegisterNUICallback('armorAll', function(_, cb) TriggerServerEvent('orbit:adminArmorAll') cb(1) end)
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
  if not DoesBlipExist(blip) then toast('warn', 'Teleport', 'Kein Wegpunkt') cb(1) return end
  local c = GetBlipInfoIdCoord(blip)
  teleportTo(c.x, c.y, 0.0)
  cb(1)
end)
RegisterNUICallback('tpBack', function(_, cb)
  if not lastTp then toast('warn', 'Teleport', 'Kein Rücksprung') cb(1) return end
  teleportTo(lastTp.x, lastTp.y, lastTp.z)
  cb(1)
end)
RegisterNUICallback('tpCoords', function(data, cb)
  local raw = tostring(data and data.coords or '')
  local x, y, z = raw:match('([^,%s]+)%s*,%s*([^,%s]+)%s*,%s*([^,%s]+)')
  x, y, z = tonumber(x), tonumber(y), tonumber(z)
  if not x or not y then toast('warn', 'Teleport', 'Coords ungültig') cb(1) return end
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
  local veh = getTargetVehicle(12.0)
  if veh == 0 then toast('warn', 'Fahrzeug', 'Kein Fahrzeug im Blick / Sitz') cb(1) return end
  SetVehicleFixed(veh)
  SetVehicleDirtLevel(veh, 0.0)
  SetVehicleEngineOn(veh, true, true, false)
  toast('ok', 'Fahrzeug', 'Repariert')
  cb(1)
end)
RegisterNUICallback('vehBoost', function(_, cb)
  local veh = getTargetVehicle(12.0)
  if veh == 0 then toast('warn', 'Fahrzeug', 'Kein Fahrzeug im Blick / Sitz') cb(1) return end
  SetVehicleEnginePowerMultiplier(veh, 25.0)
  toast('ok', 'Fahrzeug', 'Boost aktiv')
  cb(1)
end)
RegisterNUICallback('vehFlip', function(_, cb)
  local veh = getTargetVehicle(12.0)
  if veh == 0 then toast('warn', 'Fahrzeug', 'Kein Fahrzeug im Blick / Sitz') cb(1) return end
  local c = GetEntityCoords(veh)
  SetEntityRotation(veh, 0.0, 0.0, GetEntityHeading(veh), 2, true)
  SetEntityCoords(veh, c.x, c.y, c.z + 0.5, false, false, false, false)
  toast('ok', 'Fahrzeug', 'Aufgerichtet')
  cb(1)
end)
RegisterNUICallback('vehDelete', function(_, cb)
  local veh = getTargetVehicle(12.0)
  if veh == 0 then toast('warn', 'Fahrzeug', 'Kein Fahrzeug im Blick / Sitz') cb(1) return end
  SetEntityAsMissionEntity(veh, true, true)
  DeleteVehicle(veh)
  toast('ok', 'Fahrzeug', 'Gelöscht')
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
RegisterCommand('orbitnoclip', function()
  if not isAdmin then return end
  setNoclip(not (OrbitIsNoclip and OrbitIsNoclip()))
end, false)
RegisterKeyMapping('orbit', 'Orbit Admin-Menü', 'keyboard', '')
RegisterKeyMapping('orbitnoclip', 'Orbit NoClip umschalten', 'keyboard', '')

-- Menü offen: Main → laufen/gucken; Spieler-Tab (Maus) → Look sperren
CreateThread(function()
  while true do
    if menuOpen then
      DisableControlAction(0, 24, true)  -- Attack
      DisableControlAction(0, 25, true)  -- Aim
      DisableControlAction(0, 37, true)  -- Weapon wheel
      DisableControlAction(0, 44, true)  -- Cover
      DisableControlAction(0, 47, true)
      DisableControlAction(0, 58, true)
      DisableControlAction(0, 140, true)
      DisableControlAction(0, 141, true)
      DisableControlAction(0, 142, true)
      DisableControlAction(0, 143, true)
      DisableControlAction(0, 199, true) -- Pause
      DisableControlAction(0, 200, true)
      DisableControlAction(0, 245, true) -- Chat
      DisableControlAction(0, 257, true)
      DisableControlAction(0, 263, true)
      DisableControlAction(0, 264, true)
      -- Pfeile nur für Menü, nicht Radio/Phone
      DisableControlAction(0, 172, true)
      DisableControlAction(0, 173, true)
      DisableControlAction(0, 174, true)
      DisableControlAction(0, 175, true)
      DisableControlAction(0, 27, true)
      if menuCursor then
        DisableControlAction(0, 1, true)  -- Look LR
        DisableControlAction(0, 2, true)  -- Look UD
        DisableControlAction(0, 106, true)
        DisableControlAction(0, 23, true)
        DisableControlAction(0, 75, true)
      end
      Wait(0)
    else
      Wait(200)
    end
  end
end)

CreateThread(function()
  Wait(2000)
  TriggerServerEvent('orbit:checkAdmin')
end)
