# Product Requirements Document (PRD)

## Project Overview

**Project Name:** Pharmacy Slack Bot

**Description:** A Slack bot that integrates with pharmacy inventory systems to provide real-time stock queries, low-stock alerts, and expiry tracking. Helps pharmacy staff monitor inventory without leaving Slack.

**Tech Stack:** .NET 8, Slack API, REST API integration

---

## Goals

1. Enable pharmacy staff to query inventory status directly from Slack
2. Proactively alert staff about low stock and expiring medications
3. Provide audit trail of all inventory queries for compliance

---

## Functional Requirements

### Slack Integration

- The bot must authenticate with Slack using OAuth 2.0
- The bot must respond to the `/pharmacy` slash command
- The bot must handle unknown commands gracefully with help text
- The bot must support multiple Slack workspaces

### Inventory Queries

- Users must be able to query stock by medication name
- The system must return current stock count and storage location
- The system must handle partial name matches (fuzzy search)
- Queries must return results within 3 seconds

### Alerts

- The system must detect when stock falls below configured threshold
- Low stock alerts must include medication name, current count, and reorder suggestion
- The system must run daily inventory checks at a configurable time
- Daily summary must be posted to a designated channel

### Expiry Tracking

- The system must track medication expiry dates from the pharmacy API
- The system must alert 30 days before any medication expires
- Users must be able to list all medications expiring within N days

### Authorization

- Only authorized users may query inventory
- Admins must be able to add/remove authorized users via Slack commands
- Unauthorized query attempts must be logged and rejected with a message

### Audit Logging

- All inventory queries must be logged with user ID and timestamp
- All alerts must be logged with details
- Admins must be able to query audit logs via Slack command

---

## Non-Functional Requirements

### Performance

- The system must handle 50 concurrent queries
- Query response time must be under 3 seconds (95th percentile)
- Daily batch check must complete within 5 minutes

### Security

- Slack tokens must be stored encrypted at rest
- API credentials must not be logged
- All Slack communication must use HTTPS

### Reliability

- The system must retry failed API calls up to 3 times
- The system must gracefully handle pharmacy API downtime
- Failed daily checks must be retried and alert admin

---

## Error Handling

- When pharmacy API times out, show "Service temporarily unavailable, please retry"
- When medication not found, show "No results for [query]. Try a different name."
- When user not authorized, show "You don't have permission. Contact admin."
- When Slack API fails, log error and queue retry

---

## Integrations

- **Slack API**: OAuth, slash commands, messaging, user lookup
- **Pharmacy Inventory API**: GET /inventory, GET /expiry, authentication via API key

---

## Out of Scope

- Modifying inventory (read-only access)
- Ordering/reordering medications
- Integration with multiple pharmacy systems (single system only)
- Mobile app (Slack only)

---

## Acceptance Criteria

- [ ] Bot responds to `/pharmacy help` with command list
- [ ] Bot returns stock info for valid medication queries
- [ ] Low stock alerts appear in designated channel
- [ ] Expiry warnings sent 30 days before expiration
- [ ] Unauthorized users see rejection message
- [ ] Audit logs queryable by admin
- [ ] All unit tests passing
- [ ] Integration tests passing with mock pharmacy API
