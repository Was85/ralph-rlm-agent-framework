#Requires -Version 7.0
<#
.SYNOPSIS
    Atomically claim a feature for a teammate under mutex.
    Teams variant only - prevents two teammates from claiming the same feature.

.DESCRIPTION
    Priority rules:
      1. If this teammate already has an in_progress feature, return it (retry scenario)
      2. Otherwise, find the first pending feature not claimed by anyone
      3. Set status to in_progress, set claimed_by to teammate name
      4. Recalculate stats, write file, return claimed feature

.PARAMETER TeammateName
    Name of the teammate claiming the feature (e.g., "implementer-1")

.PARAMETER Path
    Path to feature_list.json (default: ./feature_list.json)

.EXAMPLE
    ./claim-feature.ps1 -TeammateName "implementer-1"
    ./claim-feature.ps1 -TeammateName "implementer-2" -Path ./feature_list.json
#>

param(
    [Parameter(Mandatory)]
    [string]$TeammateName,

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

    # 1. Check if this teammate already has an in_progress feature (retry scenario)
    $myInProgress = $data.features | Where-Object {
        $_.status -eq "in_progress" -and $_.claimed_by -eq $TeammateName
    } | Select-Object -First 1

    if ($myInProgress) {
        $myInProgress | ConvertTo-Json -Depth 10
        exit 0
    }

    # 2. Find first pending feature not claimed by anyone
    $nextPending = $data.features | Where-Object {
        $_.status -eq "pending" -and (-not $_.claimed_by -or $_.claimed_by -eq "")
    } | Select-Object -First 1

    if (-not $nextPending) {
        Write-Output '{ "result": "ALL_CLAIMED" }'
        exit 0
    }

    # 3. Claim it: set status + claimed_by
    $nextPending.status = "in_progress"

    # Add claimed_by field if it doesn't exist
    if (-not ($nextPending.PSObject.Properties.Name -contains 'claimed_by')) {
        $nextPending | Add-Member -NotePropertyName 'claimed_by' -NotePropertyValue $TeammateName
    }
    else {
        $nextPending.claimed_by = $TeammateName
    }

    # 4. Recalculate stats
    $data.stats.complete = @($data.features | Where-Object { $_.status -eq 'complete' }).Count
    $data.stats.in_progress = @($data.features | Where-Object { $_.status -eq 'in_progress' }).Count
    $data.stats.pending = @($data.features | Where-Object { $_.status -eq 'pending' }).Count
    $data.stats.blocked = @($data.features | Where-Object { $_.status -eq 'blocked' }).Count

    # 5. Write file
    $data | ConvertTo-Json -Depth 10 | Set-Content $Path -Encoding UTF8

    # 6. Output claimed feature
    $nextPending | ConvertTo-Json -Depth 10
    exit 0
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
