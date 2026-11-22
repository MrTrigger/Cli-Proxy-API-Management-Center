import type { AntigravityQuotaBucket, AntigravityQuotaGroup, ClaudeQuotaWindow } from '@/types';
import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType, QuotaStore } from './providers/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { resolveResetMs } from '@/utils/quota';
import { buildTimelineLane } from './quotaTimelineModel';

export type LedgerQuotaStore = Pick<
  QuotaStore,
  | 'claudeQuota'
  | 'codexQuota'
  | 'antigravityQuota'
  | 'xaiQuota'
  | 'kimiQuota'
  | 'devinQuota'
  | 'metaQuota'
>;

export type LedgerWindow = {
  id: string;
  label: string;
  remaining: number | null;
  resetAtMs: number | null;
};

type LedgerAccountBase = {
  entry: QuotaFileEntry;
  windows: LedgerWindow[];
  primary: LedgerWindow | null;
  blockingWindow: LedgerWindow | null;
  plan: string | null;
  /** Plan capacity relative to the provider's base plan, or null when unknown. */
  planWeight: number | null;
  /** The quota fetch succeeded. */
  loaded: boolean;
};

export type LedgerAccount = LedgerAccountBase &
  (
    | {
        kind: 'codex';
        availableResets: number | null;
        resetExpiries: number[];
        renewalMs: number | null;
        creditsError: string | null;
      }
    | { kind: 'standard' }
  );

// Relative plan sizes. Claude's come from the profile's rate-limit tier (Max 5x and 20x
// of Pro). Codex uses OpenAI's announced multipliers over Plus: Pro 100 is 5x and Pro 200
// is 20x. Plans without a published multiplier (Free, Go, Team, Business) stay unknown.
const PLAN_WEIGHTS: Partial<Record<QuotaProviderType, Record<string, number>>> = {
  claude: { plan_pro: 1, plan_max5: 5, plan_max20: 20 },
  codex: { plus: 1, prolite: 5, 'pro-lite': 5, pro_lite: 5, pro: 20 },
};

export function resolvePlanWeight(provider: QuotaProviderType, plan: string | null) {
  const weights = PLAN_WEIGHTS[provider];
  const key = plan?.trim().toLowerCase();
  return weights && key && Object.prototype.hasOwnProperty.call(weights, key) ? weights[key] : null;
}

const remainingPercent = (used: number | null) =>
  used !== null && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null;

/**
 * The longest Antigravity bucket, the scarcest one on a tie. A full bucket has no reset time,
 * so this reads the buckets directly instead of the timeline lane, which needs one.
 */
function antigravityPrimary(groups: AntigravityQuotaGroup[]): LedgerWindow | null {
  const chosen = groups
    .flatMap((group) => group.buckets)
    .reduce<AntigravityQuotaBucket | null>((best, bucket) => {
      if (best === null) return bucket;
      const byPeriod = (bucket.periodHours ?? 0) - (best.periodHours ?? 0);
      if (byPeriod !== 0) return byPeriod > 0 ? bucket : best;
      return bucket.remainingFraction < best.remainingFraction ? bucket : best;
    }, null);
  return chosen
    ? {
        id: 'primary',
        label: '',
        remaining: Math.max(0, Math.min(100, chosen.remainingFraction * 100)),
        resetAtMs: chosen.resetAtMs ?? null,
      }
    : null;
}

export function buildLedgerAccount(entry: QuotaFileEntry, store: LedgerQuotaStore): LedgerAccount {
  const key = getQuotaCacheKey(entry.file);
  const planQuota =
    entry.type === 'claude'
      ? store.claudeQuota[key]
      : entry.type === 'codex'
        ? store.codexQuota[key]
        : undefined;
  const plan = planQuota?.status === 'success' ? (planQuota.planType ?? null) : null;
  const maps = {
    claude: store.claudeQuota,
    codex: store.codexQuota,
    antigravity: store.antigravityQuota,
    xai: store.xaiQuota,
    kimi: store.kimiQuota,
    devin: store.devinQuota,
    meta: store.metaQuota,
  };
  const planInfo = {
    plan,
    planWeight: resolvePlanWeight(entry.type, plan),
    loaded: maps[entry.type][key]?.status === 'success',
  };
  let windows: ClaudeQuotaWindow[] | null = null;
  if (entry.type === 'claude') {
    const quota = store.claudeQuota[key];
    if (quota?.status === 'success') windows = quota.windows;
  } else if (entry.type === 'codex') {
    const quota = store.codexQuota[key];
    if (quota?.status === 'success') windows = quota.windows;
  }
  if (windows !== null) {
    const preferredIds =
      entry.type === 'claude'
        ? ['seven-day-fable', 'seven-day', 'five-hour']
        : ['weekly', 'five-hour'];
    const primary =
      preferredIds
        .map((id) => windows.find((window) => window.id === id))
        .find((window) => window !== undefined) ?? windows[0];
    const ordered = primary
      ? [primary, ...windows.filter((window) => window !== primary)]
      : windows;
    const mapped = ordered.map((window) => ({
      id: window.id,
      label: window.label,
      remaining: remainingPercent(window.usedPercent),
      resetAtMs: window.resetAtMs ?? null,
    }));
    const blockingWindow =
      entry.type === 'claude'
        ? (mapped
            .filter(
              (window) => ['seven-day', 'five-hour'].includes(window.id) && window.remaining === 0
            )
            .sort((a, b) => (b.resetAtMs ?? 0) - (a.resetAtMs ?? 0))[0] ?? null)
        : null;
    const base = {
      entry,
      windows: mapped,
      primary: mapped[0] ?? null,
      blockingWindow,
      ...planInfo,
    };
    if (entry.type === 'codex') {
      const quota = store.codexQuota[key];
      return {
        ...base,
        kind: 'codex',
        availableResets: quota?.rateLimitResetCreditsAvailableCount ?? null,
        resetExpiries: (quota?.rateLimitResetCredits ?? [])
          .filter((credit) => credit.status === 'available')
          .flatMap((credit) => {
            const ms = resolveResetMs([credit.expiresAt]);
            return ms === null ? [] : [ms];
          }),
        renewalMs: resolveResetMs([quota?.subscriptionActiveUntil]),
        creditsError: quota?.rateLimitResetCreditsError ?? null,
      };
    }
    return { ...base, kind: 'standard' };
  }
  if (entry.type === 'antigravity') {
    const quota = store.antigravityQuota[key];
    const primary = quota?.status === 'success' ? antigravityPrimary(quota.groups) : null;
    return {
      entry,
      windows: primary ? [primary] : [],
      primary,
      blockingWindow: null,
      ...planInfo,
      kind: 'standard',
    };
  }
  const lane = buildTimelineLane({
    name: key,
    displayName: key,
    provider: entry.type,
    quota: maps[entry.type][key],
  });
  const primary: LedgerWindow | null =
    lane.remaining === null
      ? null
      : {
          id: 'primary',
          label: '',
          remaining: lane.remaining,
          resetAtMs: lane.anchorMs,
        };
  return {
    entry,
    windows: primary ? [primary] : [],
    primary,
    blockingWindow: null,
    ...planInfo,
    kind: 'standard',
  };
}

/**
 * Weights for summing accounts of different plan sizes. Accounts on the same plan, or a
 * provider without plan weights, weigh the same. With mixed plans an account whose plan size
 * is unknown gets null and is left out of the total rather than guessed. A Max plan without
 * its 5x/20x tier is not one size, so two of them are not treated as the same plan.
 */
export function resolveLedgerWeights(group: LedgerAccount[]): (number | null)[] | null {
  const weights = group.map((account) => account.planWeight);
  if (weights.every((weight) => weight !== null)) return weights;
  const plans = new Set(group.map((account) => account.plan));
  if (plans.size <= 1 && !(group.length > 1 && plans.has('plan_max'))) return group.map(() => 1);
  return weights.some((weight) => weight !== null) ? weights : null;
}

export function summarizeLedger(
  accounts: LedgerAccount[],
  provider: QuotaProviderType,
  windowId?: string
) {
  const group = accounts.filter((account) => account.entry.type === provider);
  const weights = resolveLedgerWeights(group);
  const selected = group.map((account, index) => ({
    account,
    weight: weights?.[index] ?? null,
    window: windowId
      ? (account.windows.find((window) => window.id === windowId) ?? null)
      : account.primary,
  }));
  const counted = selected.filter(({ weight }) => weight !== null);
  const bucketIds = new Set(counted.flatMap(({ window }) => (window ? [window.id] : [])));
  const loaded = selected.filter(({ window }) => window !== null && window.remaining !== null);
  const totalWeight = counted.reduce((sum, { weight }) => sum + (weight ?? 0), 0);
  // An account that has not loaded has no plan yet either, so it is not "unknown size".
  const allLoaded = group.every((account) => account.loaded);
  const complete =
    allLoaded &&
    counted.length > 0 &&
    bucketIds.size === 1 &&
    counted.every(({ window }) => window !== null && window.remaining !== null);
  const resets = counted.flatMap(({ account, window }) => {
    const instant = account.blockingWindow?.resetAtMs ?? window?.resetAtMs;
    return typeof instant === 'number' && Number.isFinite(instant) ? [instant] : [];
  });
  return {
    provider,
    count: group.length,
    loaded: loaded.length,
    // Share of the counted accounts' combined plan capacity that is left, from 0 to 100.
    remaining:
      complete && totalWeight > 0
        ? counted.reduce(
            (sum, { weight, window }) => sum + (weight ?? 0) * (window?.remaining ?? 0),
            0
          ) / totalWeight
        : null,
    weights,
    /** Accounts left out of the total because their plan size is unknown. */
    uncounted: weights === null || !allLoaded ? 0 : group.length - counted.length,
    label: counted[0]?.window?.label ?? '',
    blocked: group.filter((account) => account.blockingWindow !== null).length,
    windowId,
    resetAtMs:
      allLoaded && resets.length === counted.length && resets.length > 0
        ? Math.min(...resets)
        : null,
  };
}

export function maskLedgerName(name: string): string {
  return name.replace(
    /([^@\s]+)@([^@\s]+?)\.([a-z]+)(?=\.json$|$)/gi,
    (_, local: string, domain: string, suffix: string) =>
      `${local.slice(0, local.lastIndexOf('-') + 1)}${local.slice(local.lastIndexOf('-') + 1, local.lastIndexOf('-') + 2)}•••@${domain.slice(0, 1)}•••.${suffix}`
  );
}
