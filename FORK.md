# Triggerlab console fork

Based on upstream CPAMC v1.25.2 with CLIProxyAPI v8.0.10. The first target is
Theo's quota-ledger screenshots from https://www.youtube.com/watch?v=D8PikZ1KhUo.

Ledger is the default quota view. It groups credentials by provider and shows
aggregate percentages per provider, with a segmented meter for individual
accounts. A total of 409% across five accounts means 409% of 500% normalized
account capacity. It does not measure tokens or assume equal subscription sizes.
Unloaded, unknown, or incompatible quota buckets never silently count as zero.

Claude rows put the reported Fable weekly bucket first when available, followed
by the account's other windows. Codex rows keep their own reported windows,
subscription renewal, and available manual-reset credits with expiry dates.
Other providers keep their original quota rendering. Refresh and reset actions
use the existing provider implementations. Emails are masked in Ledger until
Show emails is selected. Cards remains available in the view selector.

Run `bun install --frozen-lockfile` and `bun run verify`. Tests run with Bun's
file isolation because upstream suites can leak mocks/i18n state between files.
The default full upstream run reproduced failures; the isolated suite passed.

The Dockerfile builds the single-file console and includes it in a pinned
upstream proxy image. This forks the presentation, not provider authentication
or account routing. Configure `management.disable-auto-update-panel: true`
so the backend keeps this bundled console. Kubernetes deployment and private
Tailscale enrollment belong in the triggerlab repository. ai-gateway is a
separate Claude Code/Codex print-mode service for cluster applications.
