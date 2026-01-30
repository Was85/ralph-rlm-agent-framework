#!/bin/bash
#
# increment-feature-attempts.sh
# Increment the attempts counter for a feature in feature_list.json
#
# Usage: ./increment-feature-attempts.sh <feature_id> [feature_list.json] [--error "message"]
#

set -e

FEATURE_ID="${1:?Error: Feature ID required (e.g., F042)}"
shift

FEATURE_FILE="feature_list.json"
ERROR_MSG=""

# Parse remaining arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --error)
            ERROR_MSG="$2"
            shift 2
            ;;
        *)
            FEATURE_FILE="$1"
            shift
            ;;
    esac
done

if [ ! -f "$FEATURE_FILE" ]; then
    echo "Error: $FEATURE_FILE not found" >&2
    exit 1
fi

# Get current attempts
OLD_ATTEMPTS=$(jq -r --arg id "$FEATURE_ID" '.features[] | select(.id == $id) | .attempts // 0' "$FEATURE_FILE")

if [ -z "$OLD_ATTEMPTS" ] || [ "$OLD_ATTEMPTS" = "null" ]; then
    echo "Error: Feature $FEATURE_ID not found" >&2
    exit 1
fi

NEW_ATTEMPTS=$((OLD_ATTEMPTS + 1))

# Get max_attempts from config
MAX_ATTEMPTS=$(jq -r '.config.max_attempts_per_feature // 5' "$FEATURE_FILE")

# Update attempts and optionally last_error
if [ -n "$ERROR_MSG" ]; then
    jq --arg id "$FEATURE_ID" --arg err "$ERROR_MSG" \
        '(.features[] | select(.id == $id)) |= (.attempts += 1 | .last_error = $err)' \
        "$FEATURE_FILE" > "${FEATURE_FILE}.tmp" && mv "${FEATURE_FILE}.tmp" "$FEATURE_FILE"
else
    jq --arg id "$FEATURE_ID" \
        '(.features[] | select(.id == $id)).attempts += 1' \
        "$FEATURE_FILE" > "${FEATURE_FILE}.tmp" && mv "${FEATURE_FILE}.tmp" "$FEATURE_FILE"
fi

echo "Updated attempts for $FEATURE_ID from $OLD_ATTEMPTS to $NEW_ATTEMPTS (max: $MAX_ATTEMPTS)"
