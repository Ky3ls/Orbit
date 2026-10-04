--[[ Orbit hardcap — meldet Session-Start für Slot-Zählung (ersetzt cfx hardcap client) ]]

CreateThread(function()
  while true do
    if NetworkIsSessionStarted() then
      TriggerServerEvent('orbit:playerActivated')
      return
    end
    Wait(250)
  end
end)
