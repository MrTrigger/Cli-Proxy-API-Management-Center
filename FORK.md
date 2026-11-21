# Triggerlab console fork

Based on upstream CPAMC v1.25.2 with the CLIProxyAPI release pinned in the
Dockerfile. The first target is
Theo's quota-ledger screenshots from https://www.youtube.com/watch?v=D8PikZ1KhUo.

Ledger is the default quota view. It groups credentials by provider and shows
how much of the provider's combined plan capacity is left, with a segmented
meter sized by each account's plan. Accounts are weighted by plan size: Claude
Pro 1, Max 5x 5 and Max 20x 20 (from the profile's `rate_limit_tier`); Codex
Plus 1, Pro 100 5 and Pro 200 20 (OpenAI's announced multipliers). A nearly
spent Max 20x at 44% with a fresh Pro at 78% totals 46%, not 122%. Accounts on
the same plan weigh the same, as do accounts of other providers. Mixed plans
with an unknown size, and unloaded, unknown or incompatible quota buckets,
show no total instead of a guess. It does not measure tokens.

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

With the cap on, upstream `sdk/cliproxy/auth` tests that assert a long reported
window is honoured, or which window governs a deadline, fail (19 on v8.0.73).
That is the intended change; unset, the package passes. The image build runs
only the new `QuotaRecheck` tests plus the existing `helps` package.

## Updating the backend

The backend release sets the Claude Code version the proxy presents to
Anthropic (for example `claude-cli/2.1.321` in v8.0.73). A new Claude model that
needs a newer Claude Code fails through the proxy with `400 ... version X or
newer is required` until the backend is updated, whatever the client's version.

Run `scripts/update-backend.sh` (latest v8 release) or pass a tag. It resolves
the release commit and base-image digest, checks that every patch applies in
order, runs the patch tests when Go is installed, and only then rewrites the
Dockerfile pins. If a patch no longer applies, commit the patches onto the old
pinned commit, cherry-pick them onto the new tag, resolve conflicts, and
regenerate each file with `git diff`. A merge to main publishes
`registry.wallintech.eu/mrtrigger/cli-proxy-api:sha-<commit>`; Triggerlab
deploys it by pinning that tag and digest in
`kubernetes/apps/ai/cli-proxy-api/app/helmrelease.yaml`.
