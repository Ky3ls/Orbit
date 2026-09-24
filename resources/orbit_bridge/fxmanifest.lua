fx_version 'cerulean'
game 'gta5'

name 'orbit'
author 'Orbit'
description 'Orbit Monitor — Playerlist, Ban/WL-Check, Admin (system_resources)'
version '4.0.0'
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
    'client/cl_main.lua',
}
