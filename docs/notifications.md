# Notifications

User-facing notifications are delivered through `NotificationListener` (single
event-bus subscriber → `NotificationService` → `TelegramProvider`). Telegram is
currently the only supported provider.

The settings UI exposes one toggle per `NotificationEventType` key (defined in
`packages/shared/types.ts`, source of truth: `NOTIFICATION_EVENTS`).
`NotificationService.notify()` is the central gate — every emit path passes
through it, so toggle and provider checks are enforced in one place.
