import { getCodexPlanLabel } from '@/features/quota/providers/codex/planLabel';
import { describe, expect, test } from 'bun:test';
import {
  buildLedgerAccount,
  summarizeLedger,
  maskLedgerName,
  type LedgerQuotaStore,
} from '@/features/quota/ledger';
import type { QuotaFileEntry } from '@/features/quota/logic';

const emptyStore = (): LedgerQuotaStore => ({
  claudeQuota: {},
  codexQuota: {},
  antigravityQuota: {},
  xaiQuota: {},
  kimiQuota: {},
  devinQuota: {},
  metaQuota: {},
});
const entry = (name: string): QuotaFileEntry => ({
  type: 'claude',
  file: { name, provider: 'claude' },
});
const window = (id: string, remaining: number | null) => ({
  id,
  label: id,
  usedPercent: remaining === null ? null : 100 - remaining,
  resetLabel: '',
  resetAtMs: null,
  periodHours: 168,
});

describe('Theo quota ledger', () => {
  test('sums five account percentages to the screenshot total without averaging', () => {
    const store = emptyStore();
    const accounts = [58, 100, 100, 51, 100].map((remaining, index) => {
      const name = `claude-${index}.json`;
      store.claudeQuota[name] = {
        status: 'success',
        windows: [
          window('five-hour', 100),
          window('seven-day', 79),
          window('seven-day-fable', remaining),
        ],
      };
      return buildLedgerAccount(entry(name), store);
    });
    expect(summarizeLedger(accounts, 'claude')).toMatchObject({
      count: 5,
      loaded: 5,
      remaining: 409,
    });
    expect(accounts[0]?.windows[0]?.label).toBe('seven-day-fable');
  });

  test('unknown and unloaded accounts do not become zero quota', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = { status: 'success', windows: [window('seven-day', 0)] };
    const accounts = [buildLedgerAccount(entry('a'), store), buildLedgerAccount(entry('b'), store)];
    expect(summarizeLedger(accounts, 'claude')).toMatchObject({
      count: 2,
      loaded: 1,
      remaining: null,
    });
    store.claudeQuota['b'] = { status: 'success', windows: [window('seven-day', null)] };
    expect(summarizeLedger(accounts, 'claude').remaining).toBeNull();
  });

  test('does not sum different quota buckets when an account lacks Fable', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = { status: 'success', windows: [window('seven-day-fable', 80)] };
    store.claudeQuota['b'] = { status: 'success', windows: [window('seven-day', 80)] };
    const accounts = ['a', 'b'].map((name) => buildLedgerAccount(entry(name), store));
    expect(summarizeLedger(accounts, 'claude').remaining).toBeNull();
  });

  test('known zero is shown even without an active reset', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = { status: 'success', windows: [window('seven-day', 0)] };
    expect(summarizeLedger([buildLedgerAccount(entry('a'), store)], 'claude').remaining).toBe(0);
  });

  test('uses the existing Codex subscription labels in both layouts', () => {
    expect(getCodexPlanLabel('pro', (key) => key)).toBe('codex_quota.plan_pro');
    expect(getCodexPlanLabel('prolite', (key) => key)).toBe('codex_quota.plan_prolite');
    expect(getCodexPlanLabel(null, (key) => key)).toBeNull();
  });

  test('Codex keeps its reported windows, renewal and manual credits without inventing Claude limits', () => {
    const store = emptyStore();
    store.codexQuota['codex-a'] = {
      status: 'success',
      windows: [window('weekly', 17)],
      subscriptionActiveUntil: '2026-10-15T12:00:00Z',
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: '2026-10-01T12:00:00Z',
          expiresAt: '2026-10-10T12:00:00Z',
        },
      ],
    };
    const account = buildLedgerAccount(
      { type: 'codex', file: { name: 'codex-a', provider: 'codex' } },
      store
    );
    expect(account.windows.map((item) => item.id)).toEqual(['weekly']);
    expect(account.kind).toBe('codex');
    if (account.kind !== 'codex') throw new Error('expected Codex metadata');
    expect(account.availableResets).toBe(2);
    expect(account.renewalMs).toBe(Date.parse('2026-10-15T12:00:00Z'));
    expect(account.resetExpiries).toEqual([Date.parse('2026-10-10T12:00:00Z')]);
  });

  test('masks emails without putting them in the hidden label', () => {
    expect(maskLedgerName('magnus@example.com')).toBe('m•••@e•••.com');
    expect(maskLedgerName('claude-magnus@example.com.json')).toBe('claude-m•••@e•••.com.json');
    expect(maskLedgerName('local-account.json')).toBe('local-account.json');
  });
});
