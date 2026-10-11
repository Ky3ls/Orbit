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

local function tb(text, opts)
  local t = { type = 'TextBlock', text = text, wrap = true }
  if opts then for k, v in pairs(opts) do t[k] = v end end
  return t
end

local function infoCell(label, value, color)
  return {
    type = 'Column',
    width = 'stretch',
    items = {
      tb(label, { size = 'Small', weight = 'Bolder', color = 'Accent', spacing = 'None' }),
      tb(value, { size = 'Medium', weight = 'Bolder', color = color or 'Default', spacing = 'Small' }),
    },
  }
end

--- Adaptive Card 1.2 — FiveM rendert Container-Styles (attention/emphasis) nicht farbig,
--- daher nur TextBlock/ColumnSet mit Farben + Separatoren (kein Image/$schema).
function OrbitBuildBanCard(payload)
  payload = type(payload) == 'table' and payload or {}
  local serverName = truncate(trim(payload.serverName), 48)
  local reason = truncate(trim(payload.banReason) ~= '' and payload.banReason or 'Kein Grund angegeben', 260)
  local permanent = payload.permanent == true
  local untilLabel = trim(payload.banExpiresShort)
  if untilLabel == '' then untilLabel = trim(payload.banExpiresLabel) end
  if permanent or untilLabel == '' or untilLabel:lower() == 'permanent' then untilLabel = 'Permanent' end
  local remaining = trim(payload.banRemainingLabel)
  local created = trim(payload.banCreatedLabel)
  local author = truncate(trim(payload.banAuthor), 32)
  local banId = payload.banId and ('#' .. tostring(payload.banId)) or '—'
  local appeal = truncate(trim(payload.appealMessage), 300)
  local invite = trim(payload.discordInvite)
  if invite ~= '' and not invite:match('^https?://') then invite = '' end

  local header = 'ORBIT'
  if serverName ~= '' then header = header .. '  ·  ' .. serverName end

  local status
  if permanent then
    status = 'Permanenter Ban'
  elseif remaining ~= '' then
    status = 'Läuft noch ' .. remaining
  else
    status = 'Vorübergehender Ban'
  end

  local body = {
    tb(header, { size = 'Small', weight = 'Bolder', color = 'Accent', spacing = 'None' }),
    tb('Du bist gebannt', { size = 'ExtraLarge', weight = 'Bolder', color = 'Attention', spacing = 'Medium' }),
    tb(status, { size = 'Medium', weight = 'Bolder', color = permanent and 'Attention' or 'Warning', spacing = 'Small' }),

    {
      type = 'Container',
      separator = true,
      spacing = 'Large',
      items = {
        tb('GRUND', { size = 'Small', weight = 'Bolder', color = 'Accent', spacing = 'None' }),
        tb(reason, { size = 'Large', weight = 'Bolder', spacing = 'Small' }),
      },
    },

    {
      type = 'ColumnSet',
      spacing = 'Large',
      columns = {
        infoCell('GÜLTIG BIS', untilLabel, permanent and 'Attention' or 'Default'),
        infoCell('GEBANNT AM', created ~= '' and created or '—'),
      },
    },
    {
      type = 'ColumnSet',
      spacing = 'Medium',
      columns = {
        infoCell('VON', author ~= '' and author or '—'),
        infoCell('BAN-ID', banId),
      },
    },
  }

  local hint = appeal ~= '' and appeal
    or (invite ~= '' and 'Ban ungerechtfertigt? Öffne ein Ticket auf unserem Discord und nenne deine Ban-ID ' .. banId .. '.'
      or 'Ban ungerechtfertigt? Melde dich beim Server-Team und nenne deine Ban-ID ' .. banId .. '.')
  body[#body + 1] = tb(hint, { size = 'Default', separator = true, spacing = 'Large' })

  local actions = {}
  if invite ~= '' then
    actions[#actions + 1] = { type = 'Action.OpenUrl', title = 'Ban anfechten (Discord)', url = invite }
  end
  actions[#actions + 1] = { type = 'Action.Submit', title = 'Schließen' }

  return {
    type = 'AdaptiveCard',
    version = '1.2',
    body = body,
    actions = actions,
  }
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
