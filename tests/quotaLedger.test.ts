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
  test('averages accounts on the same plan as a share of their combined capacity', () => {
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
      remaining: 81.8,
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

  test('weights a nearly spent Max 20x account above a fresh Pro account', () => {
    const store = emptyStore();
    store.claudeQuota['max'] = {
      status: 'success',
      planType: 'plan_max20',
      windows: [window('seven-day', 44)],
    };
    store.claudeQuota['pro'] = {
      status: 'success',
      planType: 'plan_pro',
      windows: [window('seven-day', 78)],
    };
    const accounts = ['max', 'pro'].map((name) => buildLedgerAccount(entry(name), store));
    const summary = summarizeLedger(accounts, 'claude', 'seven-day');
    expect(summary.weights).toEqual([20, 1]);
    expect(summary.remaining).toBeCloseTo((20 * 44 + 78) / 21, 5);
  });

  test('leaves an account of unknown plan size out of a mixed-plan total', () => {
    const store = emptyStore();
    store.claudeQuota['max'] = {
      status: 'success',
      planType: 'plan_max',
      windows: [window('seven-day', 44)],
    };
    store.claudeQuota['pro'] = {
      status: 'success',
      planType: 'plan_pro',
      windows: [window('seven-day', 78)],
    };
    const accounts = ['max', 'pro'].map((name) => buildLedgerAccount(entry(name), store));
    expect(summarizeLedger(accounts, 'claude', 'seven-day')).toMatchObject({
      remaining: 78,
      weights: [null, 1],
      uncounted: 1,
      loaded: 2,
    });
  });

  test('totals Codex Pro 200 alone when a Free account has a monthly limit of unknown size', () => {
    const store = emptyStore();
    store.codexQuota['pro'] = {
      status: 'success',
      planType: 'pro',
      windows: [{ ...window('weekly', 91), resetAtMs: 2_000 }],
    };
    store.codexQuota['free'] = {
      status: 'success',
      planType: 'free',
      windows: [{ ...window('monthly', 100), resetAtMs: 1_000 }],
    };
    const accounts = ['pro', 'free'].map((name) =>
      buildLedgerAccount({ type: 'codex', file: { name, provider: 'codex' } }, store)
    );
    expect(summarizeLedger(accounts, 'codex')).toMatchObject({
      remaining: 91,
      uncounted: 1,
      resetAtMs: 2_000,
    });
  });

  test('waits for every Codex account before totalling mixed plans', () => {
    const store = emptyStore();
    store.codexQuota['pro'] = { status: 'success', planType: 'pro', windows: [window('weekly', 91)] };
    store.codexQuota['other'] = { status: 'loading', windows: [] };
    const accounts = ['pro', 'other'].map((name) =>
      buildLedgerAccount({ type: 'codex', file: { name, provider: 'codex' } }, store)
    );
    expect(summarizeLedger(accounts, 'codex')).toMatchObject({ remaining: null, uncounted: 0 });
  });

  test('a loaded Free account without a usage figure does not hide the Pro 200 total', () => {
    const store = emptyStore();
    store.codexQuota['pro'] = { status: 'success', planType: 'pro', windows: [window('weekly', 91)] };
    store.codexQuota['free'] = {
      status: 'success',
      planType: 'free',
      windows: [window('monthly', null)],
    };
    const accounts = ['pro', 'free'].map((name) =>
      buildLedgerAccount({ type: 'codex', file: { name, provider: 'codex' } }, store)
    );
    expect(summarizeLedger(accounts, 'codex')).toMatchObject({ remaining: 91, uncounted: 1 });
  });

  test('a full Antigravity bucket without a reset time counts as 100%', () => {
    const store = emptyStore();
    const bucket = (window: string, remainingFraction: number, periodHours: number) => ({
      id: window,
      label: window,
      window,
      remainingFraction,
      resetAtMs: remainingFraction === 1 ? null : 5_000,
      periodHours,
    });
    store.antigravityQuota['a'] = {
      status: 'success',
      groups: [
        {
          id: 'claude-gpt',
          label: 'Claude and GPT models',
          buckets: [bucket('five_hour', 1, 5), bucket('weekly', 1, 168)],
        },
      ],
    };
    store.antigravityQuota['b'] = {
      status: 'success',
      groups: [
        {
          id: 'claude-gpt',
          label: 'Claude and GPT models',
          buckets: [bucket('five_hour', 1, 5), bucket('weekly', 0.4, 168)],
        },
      ],
    };
    const accounts = ['a', 'b'].map((name) =>
      buildLedgerAccount({ type: 'antigravity', file: { name, provider: 'antigravity' } }, store)
    );
    expect(accounts[0]?.primary?.remaining).toBe(100);
    expect(summarizeLedger(accounts, 'antigravity')).toMatchObject({
      loaded: 2,
      remaining: 70,
      uncounted: 0,
    });
  });

  test('does not treat two Max accounts of unknown size as one plan', () => {
    const store = emptyStore();
    const accounts = ['a', 'b'].map((name) => {
      store.claudeQuota[name] = {
        status: 'success',
        planType: 'plan_max',
        windows: [window('seven-day', 50)],
      };
      return buildLedgerAccount(entry(name), store);
    });
    expect(summarizeLedger(accounts, 'claude', 'seven-day').remaining).toBeNull();
  });

  test('weights Codex Pro 200 as 20 Plus plans', () => {
    const store = emptyStore();
    const codex = (name: string, planType: string, remaining: number) => {
      store.codexQuota[name] = { status: 'success', planType, windows: [window('weekly', remaining)] };
      return buildLedgerAccount({ type: 'codex', file: { name, provider: 'codex' } }, store);
    };
    const accounts = [codex('pro', 'pro', 0), codex('plus', 'plus', 100)];
    expect(summarizeLedger(accounts, 'codex').remaining).toBeCloseTo(100 / 21, 5);
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

  test('overall exhaustion blocks other Claude windows without changing their reported percentages', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = {
      status: 'success',
      windows: [window('five-hour', 100), window('seven-day', 0), window('seven-day-fable', 97)],
    };
    const account = buildLedgerAccount(entry('a'), store);
    expect(account.blockingWindow?.id).toBe('seven-day');
    expect(summarizeLedger([account], 'claude', 'seven-day')).toMatchObject({
      remaining: 0,
      blocked: 1,
    });
    expect(summarizeLedger([account], 'claude', 'seven-day-fable')).toMatchObject({
      remaining: 97,
      blocked: 1,
    });
    expect(account.windows.find((item) => item.id === 'five-hour')?.remaining).toBe(100);
  });

  test('model-specific exhaustion does not block other Claude models', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = {
      status: 'success',
      windows: [window('five-hour', 100), window('seven-day', 80), window('seven-day-fable', 0)],
    };
    const account = buildLedgerAccount(entry('a'), store);
    expect(account.blockingWindow).toBeNull();
    expect(summarizeLedger([account], 'claude', 'seven-day')).toMatchObject({
      remaining: 80,
      blocked: 0,
    });
  });

  test('shared limits unblock after a refreshed quota reports capacity', () => {
    const store = emptyStore();
    store.claudeQuota['a'] = { status: 'success', windows: [window('seven-day', 0)] };
    expect(buildLedgerAccount(entry('a'), store).blockingWindow?.id).toBe('seven-day');
    store.claudeQuota['a'] = { status: 'success', windows: [window('seven-day', 100)] };
    expect(buildLedgerAccount(entry('a'), store).blockingWindow).toBeNull();
  });

  test('masks emails without putting them in the hidden label', () => {
    expect(maskLedgerName('magnus@example.com')).toBe('m•••@e•••.com');
    expect(maskLedgerName('claude-magnus@example.com.json')).toBe('claude-m•••@e•••.com.json');
    expect(maskLedgerName('local-account.json')).toBe('local-account.json');
  });
});
