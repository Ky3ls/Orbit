fx_version 'cerulean'
game 'gta5'

name 'orbit'
author 'Orbit'
description 'Orbit Monitor — Playerlist, Ban/WL-Check, Admin (system_resources)'
version '4.1.0'
ui_label 'Orbit'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/menu.css',
    'html/menu.js',
}

server_scripts {
    'server/sv_main.lua',
    'server/sv_connect.lua',
    'server/sv_events.lua',
    'server/sv_actions.lua',
}

client_scripts {
    'client/shared.lua',
    'client/cl_instructional.lua',
    -- txAdmin freecam vendor (gleiche Reihenfolge wie monitor)
    'client/freecam/utils.lua',
    'client/freecam/config.lua',
    'client/freecam/main.lua',
    'client/freecam/camera.lua',
    'client/cl_ptfx.lua', -- vor noclip (Ptfx-API)
    'client/cl_noclip.lua',
    'client/cl_main.lua',
}
