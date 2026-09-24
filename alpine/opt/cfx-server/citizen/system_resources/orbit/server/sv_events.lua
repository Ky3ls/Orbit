--[[ Orbit Events — vom Panel per Konsole: orbitEvent <json>  (wie txaEvent) ]]

local SHUTTING_DOWN = false

local function decodePayload(raw)
  if type(raw) ~= 'string' or raw == '' then return nil end
  -- Base64 (Panel sendet so, damit Konsole keine Quotes zerlegt)
  if not raw:find('[{[]', 1) then
    local ok, decoded = pcall(function()
      return json.decode(raw) -- try plain first
    end)
    if ok and type(decoded) == 'table' then return decoded end
    -- base64 via citizen native if available — fallback: PerformHttpRequest not needed
    local b64 = raw
    local alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    local data = {}
    b64 = b64:gsub('[^'..alphabet..'=]', '')
    local function decode(s)
      local t = {}
      for i = 1, #s, 4 do
        local a = alphabet:find(s:sub(i, i), 1, true) or 1
        local b = alphabet:find(s:sub(i+1, i+1), 1, true) or 1
        local c = alphabet:find(s:sub(i+2, i+2), 1, true) or 1
        local d = alphabet:find(s:sub(i+3, i+3), 1, true) or 1
        a, b, c, d = a - 1, b - 1, c - 1, d - 1
        local n = a * 262144 + b * 4096 + c * 64 + d
        t[#t+1] = string.char(math.floor(n / 65536) % 256)
        if s:sub(i+2, i+2) ~= '=' then t[#t+1] = string.char(math.floor(n / 256) % 256) end
        if s:sub(i+3, i+3) ~= '=' then t[#t+1] = string.char(n % 256) end
      end
      return table.concat(t)
    end
    local ok2, jsonStr = pcall(decode, b64)
    if ok2 and jsonStr then
      local ok3, data = pcall(json.decode, jsonStr)
      if ok3 and type(data) == 'table' then return data end
    end
  end
  local ok, data = pcall(json.decode, raw)
  if ok and type(data) == 'table' then return data end
  return nil
end

local function kickMatching(ids, message)
  ids = ids or {}
  local want = {}
  for _, id in ipairs(ids) do want[tostring(id)] = true end
  local kicked = 0
  for _, pid in ipairs(GetPlayers()) do
    local match = false
    for _, ident in ipairs(GetPlayerIdentifiers(pid) or {}) do
      if want[ident] then match = true break end
    end
    if match or (#ids == 0 and false) then
      DropPlayer(pid, message or '[Orbit] Gekickt.')
      kicked = kicked + 1
    end
  end
  return kicked
end

local HANDLERS = {}

HANDLERS.playerKicked = function(data)
  local target = tonumber(data.target or data.id)
  local msg = tostring(data.reason or data.dropMessage or 'Gekickt')
  if target and GetPlayerName(target) then
    DropPlayer(target, '[Orbit] ' .. msg)
  end
end

HANDLERS.playerBanned = function(data)
  local msg = tostring(data.kickMessage or data.reason or 'Gebannt')
  local ids = data.targetIds or data.identifiers or {}
  local netId = tonumber(data.targetNetId or data.target or data.id)
  if netId and GetPlayerName(netId) then
    DropPlayer(netId, '[Orbit] ' .. msg)
  end
  kickMatching(ids, '[Orbit] ' .. msg)
end

HANDLERS.playerWarned = function(data)
  local target = tonumber(data.targetNetId or data.target or data.id)
  if not target then return end
  TriggerClientEvent('orbit:showWarning', target, {
    author = data.author or 'Orbit',
    reason = data.reason or '',
    actionId = data.actionId,
  })
end

HANDLERS.directMessage = function(data)
  local target = tonumber(data.target or data.id)
  if not target then return end
  TriggerClientEvent('orbit:dm', target, tostring(data.author or 'Admin'), tostring(data.message or ''))
end

HANDLERS.announcement = function(data)
  TriggerClientEvent('orbit:announce', -1, tostring(data.message or ''))
end

HANDLERS.serverShuttingDown = function(data)
  SHUTTING_DOWN = true
  local msg = tostring(data.message or 'Server wird neu gestartet…')
  for _, pid in ipairs(GetPlayers()) do
    DropPlayer(pid, '[Orbit] ' .. msg)
  end
end

RegisterCommand('orbitEvent', function(source, args)
  if source ~= 0 then return end
  local eventName = args[1]
  local payload = decodePayload(table.concat(args, ' ', 2))
  if type(eventName) ~= 'string' or not HANDLERS[eventName] then
    print(('[orbit] unbekanntes Event: %s'):format(tostring(eventName)))
    return
  end
  HANDLERS[eventName](payload or {})
end, true)

--- Export für Shutdown-Flag
function OrbitIsShuttingDown()
  return SHUTTING_DOWN
end
