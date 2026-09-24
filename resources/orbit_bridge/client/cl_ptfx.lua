--[[
  Orbit NoClip Ptfx — kurzer kosmetischer Sparkle/Glow-Burst (VOR Mode-Wechsel),
  am Körperzentrum (Spine3). Rein NonLooped, kein Fire-Damage, keine Säule.
  Abschalten:
    set orbit_menuPtfxDisable true
    (+set / server.cfg / Additional Args)
]]

local PTFX_DICT = 'core'
-- Nur Funken/Glow — kein fire_beam / sht_flame (verursachen Entity-Fire + Säule)
-- Scale etwas höher als Mini-Spark (0.45), aber weiter klein/kurz — keine Säule
local PTFX_SPARK = 'muz_spark'
local PTFX_GLOW = 'exp_grd_flare'
local PTFX_SCALE_SPARK = 0.95
local PTFX_SCALE_GLOW = 0.62
local BURST_COUNT = 3
local BURST_DELAY = 55
local PROTECT_MS = 300
-- SKEL_Spine3 — Brust/Torso-Mitte (nicht Füße / Entity-Origin)
local BONE_SPINE3 = 24818
local BONE_PELVIS = 11816
local LOAD_TIMEOUT_MS = 400

local function isPtfxDisabled()
  return GetConvarBool('orbit_menuPtfxDisable', false)
    or GetConvarBool('orbit-menuPtfxDisable', false)
end

--- Asset laden; Timeout kurz. Preload hält core im Speicher.
local function ensurePtfxAsset(timeoutMs)
  if HasNamedPtfxAssetLoaded(PTFX_DICT) then return true end
  RequestNamedPtfxAsset(PTFX_DICT)
  local deadline = GetGameTimer() + (timeoutMs or LOAD_TIMEOUT_MS)
  while not HasNamedPtfxAssetLoaded(PTFX_DICT) do
    if GetGameTimer() > deadline then return false end
    Wait(0)
  end
  return true
end

local function pedCenterBone(tgtPedId)
  local bone = GetPedBoneIndex(tgtPedId, BONE_SPINE3)
  if not bone or bone == -1 then
    bone = GetPedBoneIndex(tgtPedId, BONE_PELVIS)
  end
  return bone
end

local function clearFireSafe(tgtPedId)
  if not tgtPedId or tgtPedId <= 0 or not DoesEntityExist(tgtPedId) then return end
  if IsEntityOnFire(tgtPedId) then
    StopEntityFire(tgtPedId)
  end
end

-- Preload beim Resource-Start → kein Sekunden-Delay beim ersten Toggle
CreateThread(function()
  if isPtfxDisabled() then return end
  ensurePtfxAsset(3000)
end)

AddEventHandler('onResourceStop', function(resourceName)
  if resourceName ~= GetCurrentResourceName() then return end
  if HasNamedPtfxAssetLoaded(PTFX_DICT) then
    RemoveNamedPtfxAsset(PTFX_DICT)
  end
end)

--- Kurzer NonLooped-Burst auf einem Ped (self oder Sync — kein schädlicher Effect)
function CreateOrbitPlayerModePtfxLoop(tgtPedId)
  if isPtfxDisabled() then return end
  if not tgtPedId or tgtPedId <= 0 then return end

  CreateThread(function()
    if not ensurePtfxAsset(LOAD_TIMEOUT_MS) then return end
    if not DoesEntityExist(tgtPedId) then return end

    local bone = pedCenterBone(tgtPedId)
    local isLocal = tgtPedId == PlayerPedId()

    -- Nie StartEntityFire; vorhandenes Feuer sofort löschen
    clearFireSafe(tgtPedId)
    if isLocal then
      -- Kurz schützen; Invincible-Restore macht NoClip/God (kein Race auf false)
      SetEntityInvincible(tgtPedId, true)
    end

    for _ = 1, BURST_COUNT do
      if not DoesEntityExist(tgtPedId) then break end

      -- Kleine Funken (kosmetisch, kein Entity-Fire)
      UseParticleFxAsset(PTFX_DICT)
      StartParticleFxNonLoopedOnPedBone(
        PTFX_SPARK,
        tgtPedId,
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
        bone,
        PTFX_SCALE_SPARK,
        false, false, false
      )

      -- Kurzer warmer Glow-Flash (sehr klein skaliert)
      UseParticleFxAsset(PTFX_DICT)
      StartParticleFxNonLoopedOnPedBone(
        PTFX_GLOW,
        tgtPedId,
        0.0, 0.0, 0.02,
        0.0, 0.0, 0.0,
        bone,
        PTFX_SCALE_GLOW,
        false, false, false
      )

      Wait(BURST_DELAY)
    end

    clearFireSafe(tgtPedId)
    if isLocal then
      Wait(PROTECT_MS)
      clearFireSafe(tgtPedId)
    end
    -- Asset bleibt geladen (kein Remove → nächster Toggle sofort)
  end)
end

--- Lokal + Sync an Nearby (ohne Self-Doppelung; gleicher kosmetischer Effect)
function OrbitPlayNoclipPtfx()
  if isPtfxDisabled() then return end
  local ped = PlayerPedId()
  clearFireSafe(ped)
  CreateOrbitPlayerModePtfxLoop(ped)

  local mySid = GetPlayerServerId(PlayerId())
  local nearby = {}
  for _, player in ipairs(GetActivePlayers()) do
    local sid = GetPlayerServerId(player)
    if sid ~= mySid then
      nearby[#nearby + 1] = sid
    end
  end
  if #nearby > 0 then
    TriggerServerEvent('orbit:reqPtfx', nearby)
  end
end

RegisterNetEvent('orbit:showPtfx', function(tgtSrc)
  if isPtfxDisabled() then return end
  tgtSrc = tonumber(tgtSrc)
  if not tgtSrc then return end
  local tgtPlayer = GetPlayerFromServerId(tgtSrc)
  if tgtPlayer == -1 then return end
  CreateOrbitPlayerModePtfxLoop(GetPlayerPed(tgtPlayer))
end)
