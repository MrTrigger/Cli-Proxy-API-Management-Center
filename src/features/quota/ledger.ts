import type { ClaudeQuotaWindow } from '@/types';
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

const remainingPercent = (used: number | null) =>
  used !== null && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null;

export function buildLedgerAccount(entry: QuotaFileEntry, store: LedgerQuotaStore): LedgerAccount {
  const key = getQuotaCacheKey(entry.file);
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
    const base = { entry, windows: mapped, primary: mapped[0] ?? null };
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
  const maps = {
    claude: store.claudeQuota,
    codex: store.codexQuota,
    antigravity: store.antigravityQuota,
    xai: store.xaiQuota,
    kimi: store.kimiQuota,
    devin: store.devinQuota,
    meta: store.metaQuota,
  };
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
  return { entry, windows: primary ? [primary] : [], primary, kind: 'standard' };
}

export function summarizeLedger(accounts: LedgerAccount[], provider: QuotaProviderType) {
  const group = accounts.filter((account) => account.entry.type === provider);
  const bucketIds = new Set(
    group.flatMap((account) => (account.primary ? [account.primary.id] : []))
  );
  const known = group.flatMap((account) =>
    account.primary?.remaining === null || account.primary === null
      ? []
      : [account.primary.remaining]
  );
  const resets = group.flatMap((account) => {
    const instant = account.primary?.resetAtMs;
    return typeof instant === 'number' && Number.isFinite(instant) ? [instant] : [];
  });
  return {
    provider,
    count: group.length,
    loaded: known.length,
    remaining:
      group.length > 0 && known.length === group.length && bucketIds.size === 1
        ? known.reduce((sum, value) => sum + value, 0)
        : null,
    label: group[0]?.primary?.label ?? '',
    resetAtMs: resets.length === group.length && resets.length > 0 ? Math.min(...resets) : null,
  };
}

export function maskLedgerName(name: string): string {
  return name.replace(
    /([^@\s]+)@([^@\s]+?)\.([a-z]+)(?=\.json$|$)/gi,
    (_, local: string, domain: string, suffix: string) =>
      `${local.slice(0, local.lastIndexOf('-') + 1)}${local.slice(local.lastIndexOf('-') + 1, local.lastIndexOf('-') + 2)}•••@${domain.slice(0, 1)}•••.${suffix}`
  );
}
