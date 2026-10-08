--[[ Orbit hardcap — Slot-Cap (sv_maxclients) + Connect-Log (ersetzt cfx hardcap) ]]

local playerCount = 0
local activated = {}

--- cfx hardcap parallel = Doppel-„Connecting:“ — stoppen sobald Orbit läuft
local function stopLegacyHardcap()
  local st = GetResourceState('hardcap')
  if st ~= 'started' and st ~= 'starting' then return false end
  print('^3[orbit] hardcap gestoppt (Slot-Cap + Connect-Log über Orbit).^7')
  StopResource('hardcap')
  return true
end

CreateThread(function()
  Wait(0)
  stopLegacyHardcap()
  -- ensure hardcap kann nach Orbit in der cfg stehen → kurz nachziehen
  for _ = 1, 30 do
    Wait(1000)
    if not stopLegacyHardcap() and GetResourceState('hardcap') == 'stopped' then
      break
    end
  end
end)

AddEventHandler('onResourceStart', function(resName)
  if resName ~= 'hardcap' then return end
  CreateThread(function()
    Wait(0)
    stopLegacyHardcap()
  end)
end)

local function maxClients()
  return GetConvarInt('sv_maxclients', 32)
end

function OrbitHardcapCount()
  return playerCount
end

function OrbitHardcapIsFull()
  return playerCount >= maxClients()
end

--- Vor Ban/WL: Connect-Log + Slot-Check. true = Join erlaubt (weiter), false = abgewiesen.
function OrbitHardcapOnConnecting(name, setKickReason)
  print(('^2Connecting: %s^7'):format(tostring(name or '?')))

  local max = maxClients()
  if playerCount >= max then
    print(('^1Server voll (%d/%d).^7'):format(playerCount, max))
    if setKickReason then
      setKickReason(('Dieser Server ist voll (max. %d Spieler).'):format(max))
    end
    CancelEvent()
    return false
  end
  return true
end

RegisterNetEvent('orbit:playerActivated', function()
  local src = source
  if not src or activated[src] then return end
  activated[src] = true
  playerCount = playerCount + 1
end)

AddEventHandler('playerDropped', function()
  local src = source
  if activated[src] then
    activated[src] = nil
    playerCount = playerCount - 1
    if playerCount < 0 then playerCount = 0 end
  end
end)
