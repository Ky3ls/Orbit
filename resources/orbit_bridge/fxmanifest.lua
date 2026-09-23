fx_version 'cerulean'
game 'gta5'

name 'orbit'
author 'Orbit'
description 'Orbit Panel — schlankes Admin-Menü (Kick/Announce/Heal/Liste)'
version '3.1.0'
ui_label 'Orbit'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/menu.css',
    'html/menu.js',
}

server_scripts {
    'server/sv_main.lua',
    'server/sv_actions.lua',
}

client_scripts {
    'client/cl_main.lua',
}
