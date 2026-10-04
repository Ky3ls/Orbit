--[[ Orbit Ban Adaptive Card — deferrals.presentCard (FiveM Cookbook) ]]

local function trim(s)
  return (tostring(s or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

local function truncate(s, max)
  s = tostring(s or '')
  if #s <= max then return s end
  return s:sub(1, math.max(0, max - 1)) .. '...'
end

--- FiveM-Callbacks sind oft `function` ODER callable table (`__cfx_functionReference`).
--- Striktes `type(x) == 'function'` war Root-Cause: Card nie gezeigt → done()-Text-Dialog.
local function isCallable(v)
  if v == nil then return false end
  local t = type(v)
  if t == 'function' then return true end
  if t == 'table' then
    local mt = getmetatable(v)
    if mt and (type(mt.__call) == 'function' or mt.__call ~= nil) then return true end
    local ok, ref = pcall(rawget, v, '__cfx_functionReference')
    if ok and ref ~= nil then return true end
    -- Manche Runtimes: table ohne sichtbares Metatable, aber trotzdem aufrufbar
    return true
  end
  -- userdata / sonstige Ref-Wrapper: per pcall testen
  return t == 'userdata'
end

local function safeDone(deferrals, msg)
  if deferrals and isCallable(deferrals.done) then
    pcall(deferrals.done, '\n' .. tostring(msg or '[Orbit] Du bist gebannt.'))
  end
end

--- Einfache Adaptive Card (v1.0) — ohne $schema/Container/Action.style
function OrbitBuildBanCard(payload)
  payload = type(payload) == 'table' and payload or {}
  local serverName = trim(payload.serverName)
  local reason = truncate(trim(payload.banReason) ~= '' and payload.banReason or 'Kein Grund angegeben', 220)
  local expiresLabel = trim(payload.banExpiresLabel)
  if expiresLabel == '' then
    expiresLabel = payload.permanent and 'Permanent' or '-'
  end
  if payload.permanent or expiresLabel:lower() == 'permanent' then
    expiresLabel = 'Permanent'
  end
  local banId = payload.banId and ('#' .. tostring(payload.banId)) or '-'
  local appeal = truncate(trim(payload.appealMessage), 280)
  local invite = trim(payload.discordInvite)
  if invite ~= '' and not invite:match('^https?://') then
    invite = ''
  end

  local body = {
    {
      type = 'TextBlock',
      text = 'ORBIT',
      weight = 'Bolder',
      size = 'Small',
      color = 'Accent',
      spacing = 'None',
    },
    {
      type = 'TextBlock',
      text = 'Gebannt',
      weight = 'Bolder',
      size = 'Large',
      color = 'Attention',
      spacing = 'Small',
    },
  }

  if serverName ~= '' then
    body[#body + 1] = {
      type = 'TextBlock',
      text = serverName,
      size = 'Medium',
      weight = 'Bolder',
      spacing = 'None',
      wrap = true,
    }
  end

  body[#body + 1] = {
    type = 'TextBlock',
    text = 'Dein Zugang zu diesem Server wurde gesperrt.',
    size = 'Small',
    spacing = 'Small',
    wrap = true,
    isSubtle = true,
  }

  body[#body + 1] = {
    type = 'FactSet',
    spacing = 'Medium',
    facts = {
      { title = 'Grund:', value = reason },
      { title = 'Bis:', value = expiresLabel },
      { title = 'Ban-ID:', value = banId },
    },
  }

  if appeal ~= '' then
    body[#body + 1] = {
      type = 'TextBlock',
      text = appeal,
      size = 'Small',
      spacing = 'Medium',
      wrap = true,
      isSubtle = true,
    }
  end

  local card = {
    type = 'AdaptiveCard',
    version = '1.0',
    body = body,
  }

  if invite ~= '' then
    card.actions = {
      {
        type = 'Action.OpenUrl',
        title = 'Discord beitreten',
        url = invite,
      },
    }
  end

  return card
end

local function shortReject(payload, fallbackText)
  local banId = payload and payload.banId
  if banId then
    return ('[Orbit] Du bist gebannt. (Ban-ID #%s)'):format(tostring(banId))
  end
  local fb = trim(fallbackText)
  if fb ~= '' then
    local line = fb:match('^[^\r\n]+') or fb
    return truncate(line, 120)
  end
  return '[Orbit] Du bist gebannt.'
end

--- Zeigt Ban-Card und hält die Deferral offen.
--- KEIN done() außerhalb des Callbacks — sonst Plain-Text „Connection rejected“.
function OrbitPresentBanCard(deferrals, payload, fallbackText)
  local presentFn = deferrals and deferrals.presentCard
  -- Falls Key anders/Metatable: tolerant suchen
  if presentFn == nil and type(deferrals) == 'table' then
    for k, v in pairs(deferrals) do
      if type(k) == 'string' and k:lower() == 'presentcard' then
        presentFn = v
        break
      end
    end
  end

  if not isCallable(presentFn) then
    local keys = {}
    if type(deferrals) == 'table' then
      for k, v in pairs(deferrals) do
        keys[#keys + 1] = ('%s=%s'):format(tostring(k), type(v))
      end
    end
    print(('^1[Orbit] Ban-Card: presentCard fehlt (d=%s pc=%s keys={%s}) — Text-Fallback^0'):format(
      type(deferrals),
      type(presentFn),
      table.concat(keys, ', ')
    ))
    safeDone(deferrals, shortReject(payload, fallbackText))
    return false
  end

  local card = OrbitBuildBanCard(payload)
  -- JSON-String: Cookbook-kompatibel; FiveM akzeptiert auch Table
  local okEnc, cardJson = pcall(json.encode, card)
  if not okEnc or type(cardJson) ~= 'string' or cardJson == '' then
    print('^1[Orbit] Ban-Card: json.encode fehlgeschlagen — Text-Fallback^0')
    safeDone(deferrals, shortReject(payload, fallbackText))
    return false
  end

  local rejectMsg = shortReject(payload, fallbackText)
  local alive = true

  local function show()
    if not alive then return end
    local ok, err = pcall(function()
      presentFn(cardJson, function(_data, _raw)
        -- Submit/Refresh: Card erneut zeigen. Cancel trennt clientseitig.
        -- KEIN done() hier — sonst ersetzt Plain-Text die Card.
        CreateThread(function()
          Wait(0)
          if alive then show() end
        end)
      end)
    end)
    if not ok then
      alive = false
      print(('^1[Orbit] Ban-Card presentCard fehlgeschlagen: %s^0'):format(tostring(err)))
      safeDone(deferrals, rejectMsg)
      return false
    end
    return true
  end

  local shown = show()
  if shown then
    print('^2[Orbit] Ban-Card via presentCard angezeigt^0')
  end
  return shown ~= false
end
