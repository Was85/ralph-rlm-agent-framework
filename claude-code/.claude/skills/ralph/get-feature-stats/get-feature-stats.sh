#!/bin/bash
#
# get-feature-stats.sh
# Get compact project stats from feature_list.json
#
# Usage: ./get-feature-stats.sh [path/to/feature_list.json]
#

set -e

FEATURE_FILE="${1:-feature_list.json}"

if [ ! -f "$FEATURE_FILE" ]; then
    echo "Error: $FEATURE_FILE not found" >&2
    exit 1
fi

jq '{project: .project, config: .config, stats: .stats}' "$FEATURE_FILE"
