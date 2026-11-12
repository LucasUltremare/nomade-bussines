# Windows — registra o runner no Task Scheduler pra subir ao logar.
# Roda UMA vez, no PowerShell do teu usuário (não precisa de admin):
#
#   powershell -ExecutionPolicy Bypass -File runner-windows.ps1
#
# Depois:
#   Get-ScheduledTask NomadeRunner        # ver
#   Start-ScheduledTask NomadeRunner      # subir agora
#   Unregister-ScheduledTask NomadeRunner # remover
#
# Por que Task Scheduler e não serviço do Windows: serviço roda numa sessão
# isolada, sem o login do Claude Code do teu usuário — e aí todo run falha
# com "Not logged in". O agendador roda como VOCÊ, que é o que precisamos.

# O .cmd, explicitamente: a ação roda por cmd.exe, que NÃO executa .ps1. Um
# `Get-Command nomade` solto resolve pro shim .ps1 (o PowerShell prefere) e
# registra uma tarefa que nunca sobe — falha silenciosa, no logon, sem ninguém
# olhando. Só cai no genérico se o .cmd não existir (npm fora do Windows).
$nomade = (Get-Command 'nomade.cmd' -ErrorAction SilentlyContinue).Source
if (-not $nomade) { $nomade = (Get-Command nomade -ErrorAction SilentlyContinue).Source }
if (-not $nomade) { Write-Error "'nomade' não está no PATH. Roda: npm i -g @nomade/cli"; exit 1 }

$acao    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$nomade`" runner"
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$config  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

Register-ScheduledTask -TaskName "NomadeRunner" -Action $acao -Trigger $gatilho `
  -Settings $config -Description "Nomade Business — runner de agents" -Force

Write-Host "pronto. sobe sozinho no proximo login; 'Start-ScheduledTask NomadeRunner' sobe agora." -ForegroundColor Green
