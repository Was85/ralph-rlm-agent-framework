#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only progress report for Ralph-RLM-Framework Teams.
    Run from another terminal while the team is working.

.EXAMPLE
    .\report-team-progress.ps1
    .\report-team-progress.ps1 -Watch
    .\report-team-progress.ps1 -Watch -Interval 10
#>

param(
    [switch]$Watch,
    [int]$Interval = 5
)

function Show-Report {
    if (-not (Test-Path "feature_list.json")) {
        Write-Host "feature_list.json not found. Run ralph-teams.ps1 init first." -ForegroundColor Red
        return
    }

    try {
        $data = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "Failed to parse feature_list.json: $_" -ForegroundColor Red
        return
    }

    $features = @($data.features)
    $total      = $features.Count
    $complete   = @($features | Where-Object { $_.status -eq "complete" })
    $inProgress = @($features | Where-Object { $_.status -eq "in_progress" })
    $pending    = @($features | Where-Object { $_.status -eq "pending" })
    $blocked    = @($features | Where-Object { $_.status -eq "blocked" })

    $percent = 0
    if ($total -gt 0) { $percent = [math]::Floor(($complete.Count / $total) * 100) }

    # Progress bar
    $barWidth = 40
    $filled = [math]::Floor($barWidth * $percent / 100)
    $empty = $barWidth - $filled
    $bar = ("#" * $filled) + ("-" * $empty)

    Clear-Host
    Write-Host ""
    Write-Host "  RALPH TEAMS - PROGRESS REPORT" -ForegroundColor Cyan
    Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  [$bar] $percent%" -ForegroundColor White
    Write-Host ""
    Write-Host "  Complete:    $($complete.Count)" -ForegroundColor Green -NoNewline
    Write-Host "  |  In-Progress: $($inProgress.Count)" -ForegroundColor Yellow -NoNewline
    Write-Host "  |  Pending: $($pending.Count)" -ForegroundColor Blue -NoNewline
    Write-Host "  |  Blocked: $($blocked.Count)" -ForegroundColor Red
    Write-Host ""

    # Feature table
    Write-Host "  ID       Status        Claimed By       Attempts  Description" -ForegroundColor White
    Write-Host "  ------   -----------   --------------   --------  -----------" -ForegroundColor DarkGray

    foreach ($f in $features) {
        $id = ($f.id).PadRight(6)
        $status = ($f.status).PadRight(11)

        $claimedBy = "-".PadRight(14)
        if ($f.claimed_by) { $claimedBy = ($f.claimed_by).PadRight(14) }

        $attempts = "0".PadRight(8)
        if ($f.attempts) { $attempts = "$($f.attempts)".PadRight(8) }

        $desc = $f.description
        if ($desc.Length -gt 40) { $desc = $desc.Substring(0, 37) + "..." }

        $color = switch ($f.status) {
            "complete"    { "Green" }
            "in_progress" { "Yellow" }
            "blocked"     { "Red" }
            default       { "Gray" }
        }

        Write-Host "  $id   $status   $claimedBy   $attempts  $desc" -ForegroundColor $color
    }

    # Show last errors for blocked features
    $blockedWithErrors = @($blocked | Where-Object { $_.last_error })
    if ($blockedWithErrors.Count -gt 0) {
        Write-Host ""
        Write-Host "  BLOCKED ERRORS" -ForegroundColor Red
        foreach ($f in $blockedWithErrors) {
            $err = $f.last_error
            if ($err.Length -gt 70) { $err = $err.Substring(0, 67) + "..." }
            Write-Host "    $($f.id): $err" -ForegroundColor DarkRed
        }
    }

    Write-Host ""
}

if ($Watch) {
    Write-Host "Watching progress (Ctrl+C to stop, refreshing every ${Interval}s)..." -ForegroundColor Cyan
    while ($true) {
        Show-Report
        Start-Sleep -Seconds $Interval
    }
}
else {
    Show-Report
}
