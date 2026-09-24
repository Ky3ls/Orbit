--[[
  Orbit NoClip — 1:1 Verhalten aus txAdmin cl_player_mode.lua (toggleFreecam)
  + Freecam-Vendor. Keine txAdmin-Events/UI; Toggle über Orbit-API.
]]

local noClipEnabled = false
local freecamVeh = 0
local isVehAHorse = false
local setLocallyInvisibleFunc = SetEntityLocallyInvisible

-- Calculated in python using sklearn.linear_model.LinearRegression with the points:
-- H: 10, F: 20 / H: 150, F: 250
local function getFallImpulse(H)
  local coefficient = 1.6428571428571428
  local intercept = 3.5714285714285836
  return coefficient * H + intercept
end

-- NOTE: this depends on godmode being off before disabling noclip
local function disableRagdollingWhileFall()
  CreateThread(function()
    local ped = PlayerPedId()
    local pedHeight = GetEntityHeightAboveGround(ped)
    if pedHeight == nil or pedHeight < 4.0 then
      return
    end

    local pid = PlayerId()
    SetEntityInvincible(ped, true)
    SetPlayerFallDistance(pid, 9000.0)

    local downForce = getFallImpulse(pedHeight)
    ApplyForceToEntity(
      ped,
      3,
      vector3(0.0, 0.0, -downForce),
      vector3(0.0, 0.0, 0.0),
      0,
      true,
      true,
      true,
      false,
      true
    )

    local fallAwaitLimit = 1000
    local fallAwaitStep = 25
    local fallAwaitElapsed = 0
    while not IsPedFalling(ped) do
      if fallAwaitElapsed >= fallAwaitLimit then
        SetEntityInvincible(ped, false)
        SetPlayerFallDistance(pid, -1)
        return
      end
      fallAwaitElapsed = fallAwaitElapsed + fallAwaitStep
      Wait(fallAwaitStep)
    end

    repeat
      Wait(50)
    until not IsPedFalling(ped)

    Wait(750)
    SetEntityInvincible(ped, false)
    SetPlayerFallDistance(pid, -1)
  end)
end

local function toggleFreecam(enabled)
  noClipEnabled = enabled and true or false
  local ped = PlayerPedId()
  SetEntityVisible(ped, not enabled)
  SetEntityInvincible(ped, enabled)
  FreezeEntityPosition(ped, enabled)

  if enabled then
    freecamVeh = GetVehiclePedIsIn(ped, false)
    isVehAHorse = false
    if IsPedOnMount(ped) then
      isVehAHorse = true
      freecamVeh = GetMount(ped)
    end
    if freecamVeh > 0 then
      NetworkSetEntityInvisibleToNetwork(freecamVeh, true)
      SetEntityCollision(freecamVeh, false, false)
      SetEntityVisible(freecamVeh, false)
      FreezeEntityPosition(freecamVeh, true)
      if not isVehAHorse then
        SetVehicleCanBreak(freecamVeh, false)
        SetVehicleWheelsCanBreak(freecamVeh, false)
      end
    end
  end

  local function enableNoClip()
    -- lastTp wird in cl_main gesetzt (Orbit „Zurück“)
    if OrbitNoclipOnEnable then
      OrbitNoclipOnEnable(GetEntityCoords(ped))
    end

    SetFreecamActive(true)
    StartFreecamThread()

    CreateThread(function()
      while IsFreecamActive() do
        setLocallyInvisibleFunc(ped, true)
        if freecamVeh > 0 then
          if DoesEntityExist(freecamVeh) then
            setLocallyInvisibleFunc(freecamVeh, true)
          else
            freecamVeh = 0
          end
        end
        Wait(0)
      end

      if freecamVeh > 0 and DoesEntityExist(freecamVeh) then
        local coords = GetEntityCoords(ped)
        NetworkSetEntityInvisibleToNetwork(freecamVeh, false)
        SetEntityCoords(freecamVeh, coords.x, coords.y, coords.z, false, false, false, false)
        SetVehicleOnGroundProperly(freecamVeh)
        SetEntityCollision(freecamVeh, true, true)
        SetEntityVisible(freecamVeh, true)
        FreezeEntityPosition(freecamVeh, false)

        if isVehAHorse then
          Citizen.InvokeNative(0x028F76B6E78246EB, ped, freecamVeh, -1)
        else
          SetEntityAlpha(freecamVeh, 125)
          SetPedIntoVehicle(ped, freecamVeh, -1)
          local persistVeh = freecamVeh
          CreateThread(function()
            Wait(2000)
            ResetEntityAlpha(persistVeh)
            SetVehicleCanBreak(persistVeh, true)
            SetVehicleWheelsCanBreak(persistVeh, true)
          end)
        end
      end
      freecamVeh = 0
    end)
  end

  local function disableNoClip()
    SetFreecamActive(false)
    SetGameplayCamRelativeHeading(0)
    if freecamVeh == 0 then
      disableRagdollingWhileFall()
    end
  end

  if not IsFreecamActive() and enabled then
    enableNoClip()
  end

  if IsFreecamActive() and not enabled then
    disableNoClip()
  end
end

function OrbitIsNoclip()
  return noClipEnabled
end

function OrbitSetNoclip(enabled)
  enabled = enabled and true or false
  if enabled == noClipEnabled then
    return noClipEnabled
  end
  -- Ptfx VOR Mode-Wechsel (sichtbar am Ped, bevor Freecam greift)
  if OrbitPlayNoclipPtfx then
    OrbitPlayNoclipPtfx()
  end
  toggleFreecam(enabled)
  return noClipEnabled
end

function OrbitToggleNoclip()
  return OrbitSetNoclip(not noClipEnabled)
end

AddEventHandler('onResourceStop', function(resourceName)
  if resourceName ~= GetCurrentResourceName() then return end
  if noClipEnabled or IsFreecamActive() then
    toggleFreecam(false)
  end
end)
