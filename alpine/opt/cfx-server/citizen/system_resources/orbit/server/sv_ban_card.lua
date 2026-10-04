--[[ Orbit Ban Adaptive Card — deferrals.presentCard (FiveM Cookbook) ]]

local function trim(s)
  return (tostring(s or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

local function truncate(s, max)
  s = tostring(s or '')
  if #s <= max then return s end
  return s:sub(1, math.max(0, max - 1)) .. '...'
end

--- done()/presentCard sind oft callable tables (__cfx_functionReference).
--- Immer als deferrals.done(...) / deferrals.presentCard(...) aufrufen —
--- nie lokal extrahieren und via pcall(fn, ...) ohne Objekt-Kontext.
local function safeDone(deferrals, msg)
  if not deferrals or deferrals.done == nil then return end
  pcall(function()
    deferrals.done('\n' .. tostring(msg or '[Orbit] Du bist gebannt.'))
  end)
end

--- Minimale Adaptive Card (v1.0): NUR TextBlocks + optional OpenUrl/Submit.
--- Kein FactSet/Container/$schema — FiveM-Renderer ist streng.
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
      size = 'Medium',
    },
    {
      type = 'TextBlock',
      text = 'Du bist gebannt',
      weight = 'Bolder',
      size = 'Large',
    },
  }

  if serverName ~= '' then
    body[#body + 1] = {
      type = 'TextBlock',
      text = serverName,
      wrap = true,
    }
  end

  body[#body + 1] = {
    type = 'TextBlock',
    text = ('Grund: %s'):format(reason),
    wrap = true,
  }
  body[#body + 1] = {
    type = 'TextBlock',
    text = ('Bis: %s'):format(expiresLabel),
    wrap = true,
  }
  body[#body + 1] = {
    type = 'TextBlock',
    text = ('Ban-ID: %s'):format(banId),
    wrap = true,
  }

  if appeal ~= '' then
    body[#body + 1] = {
      type = 'TextBlock',
      text = appeal,
      wrap = true,
    }
  end

  local card = {
    type = 'AdaptiveCard',
    version = '1.0',
    body = body,
    actions = {
      {
        type = 'Action.Submit',
        title = 'OK',
      },
    },
  }

  if invite ~= '' then
    card.actions[#card.actions + 1] = {
      type = 'Action.OpenUrl',
      title = 'Discord',
      url = invite,
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
--- done() erst im presentCard-Callback (User schließt Card) — sonst Plain-Text-Dialog.
function OrbitPresentBanCard(deferrals, payload, fallbackText)
  if type(deferrals) ~= 'table' or deferrals.presentCard == nil then
    print('^1[Orbit] Ban-Card: presentCard fehlt — Text-Fallback^0')
    safeDone(deferrals, shortReject(payload, fallbackText))
    return false
  end

  local card = OrbitBuildBanCard(payload)
  local okEnc, cardJson = pcall(json.encode, card)
  if not okEnc or type(cardJson) ~= 'string' or cardJson == '' then
    print('^1[Orbit] Ban-Card: json.encode fehlgeschlagen — Text-Fallback^0')
    safeDone(deferrals, shortReject(payload, fallbackText))
    return false
  end

  -- Einmalig exakte JSON-Payload loggen (Debug)
  if not _G.__orbitBanCardJsonLogged then
    _G.__orbitBanCardJsonLogged = true
    print(('^3[Orbit] Ban-Card JSON: %s^0'):format(cardJson))
  end

  local rejectMsg = shortReject(payload, fallbackText)
  local finished = false

  local ok, err = pcall(function()
    -- WICHTIG: deferrals.presentCard(...) — nicht lokal extrahierte Ref ohne Kontext
    deferrals.presentCard(cardJson, function(_data, _raw)
      if finished then return end
      finished = true
      -- User hat Card geschlossen/Submit — kurzer done-Text (Card war sichtbar)
      pcall(function()
        deferrals.done('\n' .. rejectMsg)
      end)
    end)
  end)

  if not ok then
    print(('^1[Orbit] Ban-Card presentCard fehlgeschlagen: %s^0'):format(tostring(err)))
    safeDone(deferrals, rejectMsg)
    return false
  end

  print('^2[Orbit] Ban-Card via presentCard angezeigt^0')
  return true
end
