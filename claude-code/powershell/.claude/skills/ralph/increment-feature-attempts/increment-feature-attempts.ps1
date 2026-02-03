#Requires -Version 7.0
<#
.SYNOPSIS
    Increment the attempts counter for a feature in feature_list.json.

.PARAMETER FeatureId
    The feature ID (e.g., F042)

.PARAMETER ErrorMessage
    Optional error message to store in last_error

.PARAMETER Path
    Path to feature_list.json (default: ./feature_list.json)

.EXAMPLE
    ./increment-feature-attempts.ps1 -FeatureId F042
    ./increment-feature-attempts.ps1 -FeatureId F042 -ErrorMessage "Build failed: CS1002"
#>

param(
    [Parameter(Mandatory)]
    [string]$FeatureId,

    [string]$ErrorMessage = "",

    [string]$Path = "feature_list.json"
)

if (-not (Test-Path $Path)) {
    Write-Error "Error: $Path not found"
    exit 1
}

$data = Get-Content $Path -Raw | ConvertFrom-Json

$feature = $data.features | Where-Object { $_.id -eq $FeatureId }

if (-not $feature) {
    Write-Error "Error: Feature $FeatureId not found"
    exit 1
}

$oldAttempts = if ($feature.attempts) { $feature.attempts } else { 0 }
$newAttempts = $oldAttempts + 1
$maxAttempts = if ($data.config.max_attempts_per_feature) { $data.config.max_attempts_per_feature } else { 5 }

$feature.attempts = $newAttempts

if ($ErrorMessage) {
    $feature.last_error = $ErrorMessage
}

$data | ConvertTo-Json -Depth 10 | Set-Content $Path -Encoding UTF8

Write-Output "Updated attempts for $FeatureId from $oldAttempts to $newAttempts (max: $maxAttempts)"
