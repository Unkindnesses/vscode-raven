$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$cli = Join-Path $scriptDir '..\node_modules\@unkindnesses\raven\dist\cli\index.js'

$hasArguments = $args -and $args.Count -gt 0
if (-not $hasArguments) {
  Write-Output "The Raven REPL is not available from this script.`nYou can run a file with ``raven foo.rv``."
  exit 1
}

$env:ELECTRON_RUN_AS_NODE = '1'
$arguments = @('--experimental-wasm-jspi', $cli) + $args
$process = Start-Process -FilePath $env:RAVEN_NODE `
  -ArgumentList $arguments `
  -WorkingDirectory $PWD `
  -NoNewWindow `
  -Wait `
  -PassThru
exit $process.ExitCode
