#Requires -Version 7.0
<#
.SYNOPSIS
    Update a feature's status in feature_list.json.
    Teams variant: Uses named mutex for concurrent access safety.

.PARAMETER FeatureId
    The feature ID (e.g., F042)

.PARAMETER Status
    New status: pending, in_progress, complete, blocked

.PARAMETER Path
    Path to feature_list.json (default: ./feature_list.json)

.EXAMPLE
    ./update-feature-status.ps1 -FeatureId F042 -Status in_progress
    ./update-feature-status.ps1 -FeatureId F001 -Status complete -Path ./feature_list.json
#>

param(
    [Parameter(Mandatory)]
    [string]$FeatureId,

    [Parameter(Mandatory)]
    [ValidateSet('pending', 'in_progress', 'complete', 'blocked')]
    [string]$Status,

    [string]$Path = "feature_list.json"
)

if (-not (Test-Path $Path)) {
    Write-Error "Error: $Path not found"
    exit 1
}

$mutex = [System.Threading.Mutex]::new($false, "Global\RalphFeatureListMutex")
try {
    if (-not $mutex.WaitOne(30000)) {
        Write-Error "Timeout: Could not acquire lock on feature_list.json"
        exit 1
    }

    $data = Get-Content $Path -Raw | ConvertFrom-Json

    $feature = $data.features | Where-Object { $_.id -eq $FeatureId }

    if (-not $feature) {
        Write-Error "Error: Feature $FeatureId not found"
        exit 1
    }

    $oldStatus = $feature.status

    # Idempotent check
    if ($oldStatus -eq $Status) {
        Write-Output "Feature $FeatureId is already '$Status'"
        exit 0
    }

    # Update status
    $feature.status = $Status

    # Clear last_error if completing
    if ($Status -eq 'complete') {
        $feature.last_error = $null
    }

    # Recalculate stats
    $data.stats.complete = @($data.features | Where-Object { $_.status -eq 'complete' }).Count
    $data.stats.in_progress = @($data.features | Where-Object { $_.status -eq 'in_progress' }).Count
    $data.stats.pending = @($data.features | Where-Object { $_.status -eq 'pending' }).Count
    $data.stats.blocked = @($data.features | Where-Object { $_.status -eq 'blocked' }).Count

    $data | ConvertTo-Json -Depth 10 | Set-Content $Path -Encoding UTF8

    Write-Output "Updated $FeatureId status from `"$oldStatus`" to `"$Status`""
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
