--[[ Orbit Ban Adaptive Card — deferrals.presentCard (FiveM Cookbook) ]]

local function trim(s)
  return (tostring(s or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

local function truncate(s, max)
  s = tostring(s or '')
  if #s <= max then return s end
  return s:sub(1, math.max(0, max - 1)) .. '...'
end

--- Einfache Adaptive Card (v1.0) — ohne $schema/Container/Action.style
--- (komplexere Schemas → Renderer-Fehler → Text-Fallback).
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

--- Zeigt Ban-Card und haelt die Deferral offen (Cancel = Client trennt).
--- Nie sofort done(longText): das ersetzt die Card durch den Plain-Text-Dialog.
function OrbitPresentBanCard(deferrals, payload, fallbackText)
  if type(deferrals) ~= 'table' or type(deferrals.presentCard) ~= 'function' then
    print('^1[Orbit] Ban-Card: presentCard nicht verfuegbar — Text-Fallback^0')
    if type(deferrals) == 'table' and type(deferrals.done) == 'function' then
      deferrals.done('\n' .. shortReject(payload, fallbackText))
    end
    return false
  end

  local card = OrbitBuildBanCard(payload)
  local rejectMsg = shortReject(payload, fallbackText)
  local alive = true

  local function show()
    if not alive then return end
    local ok, err = pcall(function()
      -- Tabelle (nicht vorencodeter String) — FiveM encodiert selbst
      deferrals.presentCard(card, function(_data, _raw)
        -- Callback oft bei Submit/Refresh; Cancel trennt clientseitig.
        -- Re-present NUR verzögert — sync Re-entry killt presentCard → Text-Fallback.
        CreateThread(function()
          Wait(0)
          if alive then show() end
        end)
      end)
    end)
    if not ok then
      alive = false
      print(('^1[Orbit] Ban-Card presentCard fehlgeschlagen: %s^0'):format(tostring(err)))
      deferrals.done('\n' .. rejectMsg)
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
