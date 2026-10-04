--[[ Orbit Ban Adaptive Card — deferrals.presentCard (dunkles Premium-Layout) ]]

local function trim(s)
  return (tostring(s or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

local function truncate(s, max)
  s = tostring(s or '')
  if #s <= max then return s end
  return s:sub(1, math.max(0, max - 1)) .. '…'
end

--- Baut Adaptive-Card-JSON (Tabelle) für einen aktiven Ban.
--- @param payload table check-join Antwort (kind=ban)
function OrbitBuildBanCard(payload)
  payload = type(payload) == 'table' and payload or {}
  local serverName = trim(payload.serverName)
  local reason = truncate(trim(payload.banReason) ~= '' and payload.banReason or 'Kein Grund angegeben', 220)
  local expiresLabel = trim(payload.banExpiresLabel)
  if expiresLabel == '' then
    expiresLabel = payload.permanent and 'Permanent' or '—'
  end
  if payload.permanent or expiresLabel:lower() == 'permanent' then
    expiresLabel = 'Permanent'
  end
  local banId = payload.banId and ('#' .. tostring(payload.banId)) or '—'
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
      size = 'ExtraLarge',
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
      color = 'Light',
      spacing = 'None',
      wrap = true,
    }
  end

  body[#body + 1] = {
    type = 'TextBlock',
    text = 'Dein Zugang zu diesem Server wurde gesperrt.',
    size = 'Small',
    color = 'Default',
    spacing = 'Small',
    wrap = true,
    isSubtle = true,
  }

  body[#body + 1] = {
    type = 'Container',
    style = 'emphasis',
    spacing = 'Medium',
    items = {
      {
        type = 'FactSet',
        facts = {
          { title = 'Grund', value = reason },
          { title = 'Dauer', value = expiresLabel },
          { title = 'Ban-ID', value = banId },
        },
      },
    },
  }

  if appeal ~= '' then
    body[#body + 1] = {
      type = 'TextBlock',
      text = appeal,
      size = 'Small',
      color = 'Default',
      spacing = 'Medium',
      wrap = true,
      isSubtle = true,
    }
  end

  local actions = {}
  if invite ~= '' then
    actions[#actions + 1] = {
      type = 'Action.OpenUrl',
      title = 'Discord beitreten',
      url = invite,
      style = 'positive',
    }
  end

  local card = {
    type = 'AdaptiveCard',
    ['$schema'] = 'http://adaptivecards.io/schemas/adaptive-card.json',
    version = '1.3',
    body = body,
  }
  if #actions > 0 then
    card.actions = actions
  end
  return card
end

--- Zeigt Ban-Card; bei Fehler Fallback auf Text-Deferral.
--- Cancel bleibt FiveM-seitig. OpenUrl schließt die Deferral nicht.
function OrbitPresentBanCard(deferrals, payload, fallbackText)
  if type(deferrals) ~= 'table' or type(deferrals.presentCard) ~= 'function' then
    deferrals.done('\n' .. tostring(fallbackText or '[Orbit] Du bist gebannt.'))
    return false
  end

  local card = OrbitBuildBanCard(payload)
  local okEnc, encoded = pcall(json.encode, card)
  if not okEnc or type(encoded) ~= 'string' or encoded == '' then
    deferrals.done('\n' .. tostring(fallbackText or '[Orbit] Du bist gebannt.'))
    return false
  end

  local presenting = false
  local function show()
    if presenting then return end
    presenting = true
    local ok = pcall(function()
      deferrals.presentCard(encoded, function()
        presenting = false
        -- Card erneut zeigen (Submit/Refresh) — Cancel trennt clientseitig
        show()
      end)
    end)
    presenting = false
    if not ok then
      deferrals.done('\n' .. tostring(fallbackText or '[Orbit] Du bist gebannt.'))
      return false
    end
    return true
  end

  return show() ~= false
end
