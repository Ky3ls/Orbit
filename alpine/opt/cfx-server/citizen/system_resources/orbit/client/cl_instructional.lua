-- Instructional scaleform (1:1 aus txAdmin cl_instructional_ui.lua, nur FiveM)

function makeFivemInstructionalScaleform(keysTable)
  local scaleform = RequestScaleformMovie('instructional_buttons')
  while not HasScaleformMovieLoaded(scaleform) do
    Wait(10)
  end
  BeginScaleformMovieMethod(scaleform, 'CLEAR_ALL')
  EndScaleformMovieMethod()

  BeginScaleformMovieMethod(scaleform, 'SET_CLEAR_SPACE')
  ScaleformMovieMethodAddParamInt(200)
  EndScaleformMovieMethod()

  for btnIndex, keyData in ipairs(keysTable) do
    local btn = GetControlInstructionalButton(0, keyData[2], true)

    BeginScaleformMovieMethod(scaleform, 'SET_DATA_SLOT')
    ScaleformMovieMethodAddParamInt(btnIndex - 1)
    ScaleformMovieMethodAddParamPlayerNameString(btn)
    BeginTextCommandScaleformString('STRING')
    AddTextComponentSubstringKeyboardDisplay(keyData[1])
    EndTextCommandScaleformString()
    EndScaleformMovieMethod()
  end

  BeginScaleformMovieMethod(scaleform, 'DRAW_INSTRUCTIONAL_BUTTONS')
  EndScaleformMovieMethod()

  BeginScaleformMovieMethod(scaleform, 'SET_BACKGROUND_COLOUR')
  ScaleformMovieMethodAddParamInt(0)
  ScaleformMovieMethodAddParamInt(0)
  ScaleformMovieMethodAddParamInt(0)
  ScaleformMovieMethodAddParamInt(80)
  EndScaleformMovieMethod()

  return scaleform
end
