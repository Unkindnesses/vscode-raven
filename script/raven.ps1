$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$cli = Join-Path $scriptDir '..\node_modules\@unkindnesses\raven\dist\cli\index.js'

$env:ELECTRON_RUN_AS_NODE = '1'
& $env:RAVEN_NODE $cli @args
exit $LASTEXITCODE
