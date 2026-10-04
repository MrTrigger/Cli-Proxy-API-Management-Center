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
upstream proxy image. Provider authentication and account selection are
upstream's. Configure `management.disable-auto-update-panel: true`
so the backend keeps this bundled console. Kubernetes deployment and private
Tailscale enrollment belong in the triggerlab repository. ai-gateway is a
separate Claude Code/Codex print-mode service for cluster applications.

## Backend patches

The Dockerfile also rebuilds the proxy from the pinned upstream commit with the
patches in `backend-patches/`, applied in this order. Each patch is opt-in
through an environment variable, so upstream behaviour and upstream tests are
unchanged unless it is set.

- `utls-ipv4.patch`: `CLIPROXY_FORCE_IPV4=1` dials providers over IPv4 only, for
  the IPv4-only cluster. Triggerlab sets it in the HelmRelease.
- `quota-recheck.patch`: `CLIPROXY_QUOTA_RECHECK_SECONDS=N` caps how long a
  quota failure (429) keeps a credential out of rotation. Upstream sets the
  cooldown from the reset time the provider reported, for example five days
  after a Codex `usage_limit_reached`, and never re-checks, so a limit that is
  reset or upgraded earlier stays blocked and every request returns an instant
  429. With the cap, the next request after N seconds probes the provider again:
  a reset account works within N seconds, a still-limited account costs one
  rejected request per N seconds per credential. It also bounds the headerless
  429 backoff ladder (otherwise up to 30 minutes). Unset, 0 or invalid keeps the
  upstream behaviour. The image sets it to 60.

With the cap on, six upstream tests fail because they assert that a long
reported window is honoured (`claude_ratelimit_cooldown_test.go`,
`conductor_cooldown_monotonic_test.go`, `conductor_stream_quota_test.go`,
`conductor_subsecond_cooldown_test.go`). That is the intended change; the image
build runs only the new `QuotaRecheck` tests plus the existing `helps` package.
After changing a patch, check `git apply` on a fresh checkout of the pinned
commit with every patch in order, then `go test ./sdk/cliproxy/auth`.
