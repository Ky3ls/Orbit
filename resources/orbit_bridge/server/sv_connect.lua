--[[ Orbit connect — Ban/Whitelist-Check beim Join ]]

local function checkJoinEnabled()
  return ORBIT_TOKEN ~= '' and ORBIT_TOKEN ~= 'removed'
end

local function collectTokens(player)
  local tokens = {}
  if type(GetPlayerTokens) == 'function' then
    local ok, list = pcall(GetPlayerTokens, player)
    if ok and type(list) == 'table' then return list end
  end
  if type(GetNumPlayerTokens) == 'function' and player then
    local ok, n = pcall(GetNumPlayerTokens, player)
    if ok and type(n) == 'number' and n > 0 and type(GetPlayerToken) == 'function' then
      for i = 0, n - 1 do
        local tokOk, tok = pcall(GetPlayerToken, player, i)
        if tokOk and tok then tokens[#tokens + 1] = tok end
      end
    end
  end
  return tokens
end

local function handleConnecting(name, setKickReason, d)
  -- source MUSS vor defer/Wait gesichert werden (sonst nil → Native-Crash)
  local player = source

  if OrbitIsShuttingDown and OrbitIsShuttingDown() then
    CancelEvent()
    setKickReason('[Orbit] Server wird neu gestartet, bitte kurz warten.')
    return
  end
  if not checkJoinEnabled() then return end
  if not player then return end

  d.defer()
  Wait(0)

  local ids = GetPlayerIdentifiers(player) or {}
  local tokens = collectTokens(player)

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
