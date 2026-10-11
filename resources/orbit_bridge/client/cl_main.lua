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

local NOTIFY_OK = { ['top-left'] = true, ['top-right'] = true, ['bottom-left'] = true, ['bottom-right'] = true }
local notifyPos = 'top-left'
-- Panel-Akzent (ESP + NUI) — Default Orange
local accentR, accentG, accentB = 255, 122, 26
local accentR2, accentG2, accentB2 = 255, 154, 77

local function parseAccentRgb(rgb)
  if type(rgb) ~= 'string' then return nil end
  local r, g, b = rgb:match('(%d+)%s*,%s*(%d+)%s*,%s*(%d+)')
  r, g, b = tonumber(r), tonumber(g), tonumber(b)
  if not r or not g or not b then return nil end
  return r, g, b
end

local function applyAccent(data)
  if type(data) ~= 'table' then return end
  local r, g, b = parseAccentRgb(data.accentRgb or data.rgb)
  if r then accentR, accentG, accentB = r, g, b end
  local r2, g2, b2 = parseAccentRgb(data.accentRgb2 or data.rgb2)
  if r2 then
    accentR2, accentG2, accentB2 = r2, g2, b2
  else
    accentR2 = math.min(255, math.floor(accentR + (255 - accentR) * 0.35))
    accentG2 = math.min(255, math.floor(accentG + (255 - accentG) * 0.35))
    accentB2 = math.min(255, math.floor(accentB + (255 - accentB) * 0.35))
  end
  SendNUIMessage({
    action = 'accent',
    accent = data.accent or data.id or 'orange',
    hex = data.accentHex or data.hex,
    hex2 = data.accentHex2 or data.hex2,
    rgb = ('%d, %d, %d'):format(accentR, accentG, accentB),
  })
end

local function applyNotifyPos(pos)
  if type(pos) ~= 'string' or not NOTIFY_OK[pos] then return end
  if pos == notifyPos then return end
  notifyPos = pos
  SendNUIMessage({ action = 'notifyPos', pos = notifyPos })
end

-- Nie chat:addMessage — spamt Chat + bricht esx_rpchat (GetPlayerName null).
local function toast(kind, title, message, duration)
  SendNUIMessage({
    action = 'toast',
    kind = kind or 'info',
    title = title or 'Orbit',
    message = tostring(message or ''),
    duration = duration,
    pos = notifyPos,
  })
end

RegisterNetEvent('orbit:toast', function(kind, title, message, duration)
  toast(kind, title, message, duration)
end)

RegisterNetEvent('orbit:notifyPos', function(pos)
  applyNotifyPos(pos)
end)

RegisterNetEvent('orbit:accent', function(data)
  applyAccent(data)
end)

CreateThread(function()
  SendNUIMessage({ action = 'notifyPos', pos = notifyPos })
  while true do
    local p = GlobalState.orbitNotifyPos
    if type(p) == 'string' then applyNotifyPos(p) end
    Wait(4000)
  end
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

local function teleportTo(x, y, z, h)
  local ped = PlayerPedId()
  local veh = GetVehiclePedIsIn(ped, false)
  lastTp = GetEntityCoords(ped)
  if z == nil or z == 0 then z = findZ(x, y) end
  RequestCollisionAtCoord(x, y, z)
  if veh ~= 0 then
    SetEntityCoords(veh, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
    if h ~= nil then SetEntityHeading(veh, h + 0.0) end
  else
    SetEntityCoords(ped, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
    if h ~= nil then SetEntityHeading(ped, h + 0.0) end
  end
end

-- vec3/vec4/vector3/vector4/v3/v4(...) oder "x, y, z[, h]" / spaces
local function parseCoords(raw)
  raw = tostring(raw or ''):gsub('^%s+', ''):gsub('%s+$', '')
  if raw == '' then return nil end
  local inner = raw:match('^[%a_][%w_]*%s*%((.+)%)$')
  if inner then raw = inner end
  local nums = {}
  for tok in raw:gmatch('%-?%d+%.?%d*[Ee]?[+-]?%d*') do
    local n = tonumber(tok)
    if n ~= nil then nums[#nums + 1] = n end
  end
  if #nums < 2 then return nil end
  return nums[1], nums[2], nums[3], nums[4]
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

-- —— Player IDs + vertikale HP/Weste (Körper) + Skelett-ESP (durch Wände) ——
local BONE_HEAD = 31086
local BONE_NECK = 39317
local BONE_SPINE = 24818
local BONE_PELVIS = 11816
local BONE_L_CLAV = 64729
local BONE_L_UPARM = 45509
local BONE_L_FORE = 61163
local BONE_L_HAND = 18905
local BONE_R_CLAV = 10706
local BONE_R_UPARM = 40269
local BONE_R_FORE = 28252
local BONE_R_HAND = 57005
local BONE_L_THIGH = 58271
local BONE_L_CALF = 63931
local BONE_L_FOOT = 14201
local BONE_R_THIGH = 51826
local BONE_R_CALF = 36864
local BONE_R_FOOT = 52301

--- Knochen-Paare fürs Skelett
local SKELETON = {
  { BONE_HEAD, BONE_NECK },
  { BONE_NECK, BONE_SPINE },
  { BONE_SPINE, BONE_PELVIS },
  { BONE_NECK, BONE_L_CLAV },
  { BONE_L_CLAV, BONE_L_UPARM },
  { BONE_L_UPARM, BONE_L_FORE },
  { BONE_L_FORE, BONE_L_HAND },
  { BONE_NECK, BONE_R_CLAV },
  { BONE_R_CLAV, BONE_R_UPARM },
  { BONE_R_UPARM, BONE_R_FORE },
  { BONE_R_FORE, BONE_R_HAND },
  { BONE_PELVIS, BONE_L_THIGH },
  { BONE_L_THIGH, BONE_L_CALF },
  { BONE_L_CALF, BONE_L_FOOT },
  { BONE_PELVIS, BONE_R_THIGH },
  { BONE_R_THIGH, BONE_R_CALF },
  { BONE_R_CALF, BONE_R_FOOT },
}

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

local function boneScreen(ped, bone)
  local c = GetPedBoneCoords(ped, bone, 0.0, 0.0, 0.0)
  local ok, x, y = World3dToScreen2d(c.x, c.y, c.z)
  if not ok then return nil end
  return x, y, c
end

--- 2D-Linie (Screen) — durch Wände; überlappende Rects = durchgehende Striche (keine Punkte)
local function drawScreenLine(x1, y1, x2, y2, r, g, b, a)
  local dx, dy = x2 - x1, y2 - y1
  local len = math.sqrt(dx * dx + dy * dy)
  if len < 0.0002 then return end
  local thickness = 0.00235
  local step = thickness * 0.32
  local steps = math.min(180, math.max(3, math.floor(len / step + 0.5)))
  local w = thickness
  local h = thickness * 1.55
  for i = 0, steps do
    local t = i / steps
    DrawRect(x1 + dx * t, y1 + dy * t, w, h, r, g, b, a)
  end
end

--- Vertikaler Balken rechts am Körper (Fuß → Kopf), Füllung von unten
local function drawVerticalBar(barX, topY, botY, pct, r, g, b, barW)
  local height = botY - topY
  if height < 0.015 then height = 0.015 end
  local midY = topY + height * 0.5
  DrawRect(barX, midY, barW, height, 18, 18, 22, 180)
  local fill = math.max(0.0, math.min(1.0, pct / 100.0))
  if fill > 0.01 then
    local fillH = height * fill
    local fillCy = botY - fillH * 0.5
    DrawRect(barX, fillCy, barW * 0.62, fillH, r, g, b, 235)
  end
end

local function drawPedSkeleton(ped, r, g, b, a)
  local cache = {}
  local function scr(bone)
    local hit = cache[bone]
    if hit == false then return nil end
    if hit then return hit[1], hit[2] end
    local x, y = boneScreen(ped, bone)
    if x then
      cache[bone] = { x, y }
      return x, y
    end
    cache[bone] = false
    return nil
  end
  for i = 1, #SKELETON do
    local pair = SKELETON[i]
    local x1, y1 = scr(pair[1])
    local x2, y2 = scr(pair[2])
    if x1 and x2 then
      drawScreenLine(x1, y1, x2, y2, r, g, b, a)
    end
  end
end

-- TEMP: auch NPCs (einfach wieder auf false setzen)
local ESP_NPC_TEMP = true

local function drawEspEntity(ped, myPed, dist, label, tr, tg, tb, skR, skG, skB, textScale, barW, barGap)
  local hx, hy = boneScreen(ped, BONE_HEAD)
  if hx then
    SetTextScale(textScale, textScale)
    SetTextFont(4)
    SetTextCentre(true)
    SetTextColour(tr, tg, tb, 220)
    SetTextOutline()
    BeginTextCommandDisplayText('STRING')
    AddTextComponentSubstringPlayerName(label)
    EndTextCommandDisplayText(hx, hy - 0.048)
  end

  local alpha = ped == myPed and 200 or (dist < 40.0 and 230 or (dist < 100.0 and 180 or 130))
  drawPedSkeleton(ped, skR, skG, skB, alpha)

  local headX, headY = boneScreen(ped, BONE_HEAD)
  local lFootX, lFootY = boneScreen(ped, BONE_L_FOOT)
  local rFootX, rFootY = boneScreen(ped, BONE_R_FOOT)
  local lx = select(1, boneScreen(ped, BONE_L_UPARM))
  local rx = select(1, boneScreen(ped, BONE_R_UPARM))
  if not (headX and headY and (lFootY or rFootY)) then return end
  local footY = lFootY or rFootY
  if lFootY and rFootY then footY = math.max(lFootY, rFootY) end
  local topY = math.min(headY, footY)
  local botY = math.max(headY, footY)
  local barPad = 0.022
  local rightEdge = headX
  if lx then rightEdge = math.max(rightEdge, lx) end
  if rx then rightEdge = math.max(rightEdge, rx) end
  if lFootX then rightEdge = math.max(rightEdge, lFootX) end
  if rFootX then rightEdge = math.max(rightEdge, rFootX) end
  local barX = rightEdge + barPad
  if barX > 0.985 then
    local leftEdge = headX
    if lx then leftEdge = math.min(leftEdge, lx) end
    if rx then leftEdge = math.min(leftEdge, rx) end
    barX = leftEdge - barPad - barGap
  end
  local hp = pedHealthPct(ped)
  local armor = pedArmorPct(ped)
  local hr, hg, hb = 80, 200, 90
  if hp < 35.0 then hr, hg, hb = 230, 70, 70
  elseif hp < 65.0 then hr, hg, hb = 230, 180, 60 end
  drawVerticalBar(barX, topY, botY, hp, hr, hg, hb, barW)
  drawVerticalBar(barX + barGap, topY, botY, armor, 70, 140, 230, barW)
end

CreateThread(function()
  local textScale = 0.32
  local barW = 0.0036
  local barGap = 0.0055
  local ESP_DIST = 220.0
  local ESP_NPC_DIST = 80.0
  while true do
    if showIds then
      local myPed = PlayerPedId()
      local myCoords = GetEntityCoords(myPed)
      local seen = {}
      for _, pid in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(pid)
        if ped ~= 0 then
          seen[ped] = true
          local coords = GetEntityCoords(ped)
          local dist = #(coords - myCoords)
          if dist < ESP_DIST then
            local sid = GetPlayerServerId(pid)
            local label = ('[%s] %s'):format(sid, GetPlayerName(pid) or '')
            drawEspEntity(ped, myPed, dist, label, accentR, accentG, accentB, accentR2, accentG2, accentB2, textScale, barW, barGap)
          end
        end
      end
      -- TEMP: NPC-ESP
      if ESP_NPC_TEMP then
        local pool = GetGamePool('CPed') or {}
        local n = 0
        for i = 1, #pool do
          local ped = pool[i]
          if ped ~= 0 and not seen[ped] and DoesEntityExist(ped) and not IsPedDeadOrDying(ped, true) then
            local coords = GetEntityCoords(ped)
            local dist = #(coords - myCoords)
            if dist < ESP_NPC_DIST then
              n = n + 1
              if n > 40 then break end
              drawEspEntity(ped, myPed, dist, '[NPC]', 160, 170, 190, 120, 180, 220, textScale, barW, barGap)
            end
          end
        end
      end
      Wait(0)
    else
      Wait(400)
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
  if type(game.notifyPos) == 'string' then applyNotifyPos(game.notifyPos) end
  if game.accent or game.accentRgb or game.accentHex then applyAccent(game) end
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
    notifyPos = notifyPos,
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
    pos = notifyPos,
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
    pos = notifyPos,
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
  local x, y, z, h = parseCoords(data and data.coords)
  if not x or not y then toast('warn', 'Teleport', 'Coords ungültig') cb(1) return end
  teleportTo(x, y, z, h)
  toast('ok', 'Teleport', h and ('%.1f, %.1f, %.1f (h %.0f)'):format(x, y, z or 0.0, h) or ('%.1f, %.1f, %.1f'):format(x, y, z or 0.0))
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
