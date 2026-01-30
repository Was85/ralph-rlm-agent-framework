#!/bin/bash
#
# update-feature-status.sh
# Update a feature's status in feature_list.json
#
# Usage: ./update-feature-status.sh <feature_id> <new_status> [path/to/feature_list.json]
#
# Allowed statuses: pending, in_progress, complete, blocked
#

set -e

FEATURE_ID="${1:?Error: Feature ID required (e.g., F042)}"
NEW_STATUS="${2:?Error: Status required (pending|in_progress|complete|blocked)}"
FEATURE_FILE="${3:-feature_list.json}"

# Validate status
case "$NEW_STATUS" in
    pending|in_progress|complete|blocked) ;;
    *)
        echo "Error: Invalid status '$NEW_STATUS'. Must be: pending, in_progress, complete, blocked" >&2
        exit 1
        ;;
esac

if [ ! -f "$FEATURE_FILE" ]; then
    echo "Error: $FEATURE_FILE not found" >&2
    exit 1
fi

# Get current status
OLD_STATUS=$(jq -r --arg id "$FEATURE_ID" '.features[] | select(.id == $id) | .status' "$FEATURE_FILE")

if [ -z "$OLD_STATUS" ] || [ "$OLD_STATUS" = "null" ]; then
    echo "Error: Feature $FEATURE_ID not found" >&2
    exit 1
fi

# Idempotent: if already in desired status, exit cleanly
if [ "$OLD_STATUS" = "$NEW_STATUS" ]; then
    echo "Feature $FEATURE_ID is already '$NEW_STATUS'"
    exit 0
fi

# Update status (and clear last_error if completing)
if [ "$NEW_STATUS" = "complete" ]; then
    jq --arg id "$FEATURE_ID" --arg status "$NEW_STATUS" \
        '(.features[] | select(.id == $id)) |= (.status = $status | .last_error = null)' \
        "$FEATURE_FILE" > "${FEATURE_FILE}.tmp" && mv "${FEATURE_FILE}.tmp" "$FEATURE_FILE"
else
    jq --arg id "$FEATURE_ID" --arg status "$NEW_STATUS" \
        '(.features[] | select(.id == $id)).status = $status' \
        "$FEATURE_FILE" > "${FEATURE_FILE}.tmp" && mv "${FEATURE_FILE}.tmp" "$FEATURE_FILE"
fi

# Recalculate stats
jq '.stats.complete = [.features[] | select(.status == "complete")] | length |
    .stats.in_progress = [.features[] | select(.status == "in_progress")] | length |
    .stats.pending = [.features[] | select(.status == "pending")] | length |
    .stats.blocked = [.features[] | select(.status == "blocked")] | length' \
    "$FEATURE_FILE" > "${FEATURE_FILE}.tmp" && mv "${FEATURE_FILE}.tmp" "$FEATURE_FILE"

echo "Updated $FEATURE_ID status from \"$OLD_STATUS\" to \"$NEW_STATUS\""
