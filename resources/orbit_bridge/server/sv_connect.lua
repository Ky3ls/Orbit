--[[ Orbit connect — Ban/Whitelist-Check wie txAdmin monitor playerConnecting ]]

local function checkJoinEnabled()
  -- Immer prüfen wenn Panel-Token da ist (Ban/WL kommt vom Panel)
  return ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed'
end

local function handleConnecting(name, setKickReason, d)
  if OrbitIsShuttingDown and OrbitIsShuttingDown() then
    CancelEvent()
    setKickReason('[Orbit] Server wird neu gestartet, bitte kurz warten.')
    return
  end
  if not checkJoinEnabled() then return end

  d.defer()
  Wait(0)

  local src = source
  local ids = GetPlayerIdentifiers(src) or {}
  local tokens = {}
  if GetNumPlayerTokens then
    local n = GetNumPlayerTokens(src) or 0
    for i = 0, n - 1 do
      tokens[#tokens + 1] = GetPlayerToken(src, i)
    end
  end

  if #ids < 1 then
    d.done('\n[Orbit] Keine Identifier — prüfe sv_lan / Rockstar-Login.')
    return
  end

  d.update('\n[Orbit] Banlist/Allowlist prüfen…')
  local done = false
  OrbitHttp('POST', '/api/ingame/check-join', {
    token = ORBIT_TOKEN,
    playerIds = ids,
    playerHwids = tokens,
    playerName = name,
  }, nil, function(code, resp)
    if done then return end
    done = true
    if code ~= 200 or type(resp) ~= 'table' then
      d.done('\n[Orbit] Panel nicht erreichbar — versuche es gleich nochmal.')
      return
    end
    if resp.allow == true then
      d.done()
    else
      d.done('\n' .. tostring(resp.reason or '[Orbit] Zugang verweigert.'))
    end
  end)

  CreateThread(function()
    local t = 0
    while not done and t < 25 do
      Wait(1000)
      t = t + 1
      d.update(('\n[Orbit] Banlist/Allowlist prüfen… (%ss)'):format(t))
    end
    if not done then
      done = true
      d.done('\n[Orbit] Timeout bei Banlist-Prüfung.')
    end
  end)
end

AddEventHandler('playerConnecting', handleConnecting)
