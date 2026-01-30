#Requires -Version 7.0
<#
.SYNOPSIS
    Select the next feature to implement from feature_list.json.

.DESCRIPTION
    Priority rules:
      1. Any feature with status "in_progress" (retry scenario)
      2. First feature with status "pending"
      3. Returns ALL_COMPLETE if none found

.PARAMETER Path
    Path to feature_list.json (default: ./feature_list.json)

.EXAMPLE
    ./get-next-feature.ps1
    ./get-next-feature.ps1 -Path ./my-project/feature_list.json
#>

param(
    [string]$Path = "feature_list.json"
)

if (-not (Test-Path $Path)) {
    Write-Error "Error: $Path not found"
    exit 1
}

$data = Get-Content $Path -Raw | ConvertFrom-Json

# Check for in_progress feature first (retry scenario)
$inProgress = $data.features | Where-Object { $_.status -eq "in_progress" } | Select-Object -First 1

if ($inProgress) {
    $inProgress | ConvertTo-Json -Depth 10
    exit 0
}

# Otherwise get first pending feature
$pending = $data.features | Where-Object { $_.status -eq "pending" } | Select-Object -First 1

if ($pending) {
    $pending | ConvertTo-Json -Depth 10
    exit 0
}

# No features available
Write-Output '{ "result": "ALL_COMPLETE" }'
exit 0
