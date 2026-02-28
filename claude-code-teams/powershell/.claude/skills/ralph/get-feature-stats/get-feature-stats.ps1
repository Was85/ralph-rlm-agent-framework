#Requires -Version 7.0
<#
.SYNOPSIS
    Get compact project stats from feature_list.json.

.PARAMETER Path
    Path to feature_list.json (default: ./feature_list.json)

.EXAMPLE
    ./get-feature-stats.ps1
    ./get-feature-stats.ps1 -Path ./my-project/feature_list.json
#>

param(
    [string]$Path = "feature_list.json"
)

if (-not (Test-Path $Path)) {
    Write-Error "Error: $Path not found"
    exit 1
}

$data = Get-Content $Path -Raw | ConvertFrom-Json

$result = [PSCustomObject]@{
    project = $data.project
    config  = $data.config
    stats   = $data.stats
}

$result | ConvertTo-Json -Depth 10
