#!/bin/bash
#
# get-next-feature.sh
# Select the next feature to implement from feature_list.json
#
# Usage: ./get-next-feature.sh [path/to/feature_list.json]
#
# Priority:
#   1. Any feature with status "in_progress" (retry scenario)
#   2. First feature with status "pending"
#   3. Returns ALL_COMPLETE if none found
#

set -e

FEATURE_FILE="${1:-feature_list.json}"

if [ ! -f "$FEATURE_FILE" ]; then
    echo "Error: $FEATURE_FILE not found" >&2
    exit 1
fi

# Check for in_progress feature first (retry scenario)
IN_PROGRESS=$(jq -e '.features[] | select(.status == "in_progress")' "$FEATURE_FILE" 2>/dev/null) && {
    echo "$IN_PROGRESS" | jq -s 'first'
    exit 0
}

# Otherwise get first pending feature
PENDING=$(jq -e '[.features[] | select(.status == "pending")] | first' "$FEATURE_FILE" 2>/dev/null) && {
    if [ "$PENDING" != "null" ] && [ -n "$PENDING" ]; then
        echo "$PENDING"
        exit 0
    fi
}

# No features available
echo '{ "result": "ALL_COMPLETE" }'
exit 0
