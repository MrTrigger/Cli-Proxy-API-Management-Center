import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import { summarizeLedger, type LedgerAccount } from '../ledger';
import styles from './QuotaLedger.module.scss';

export function LedgerSummary({
  accounts,
  resolvedTheme,
}: {
  accounts: LedgerAccount[];
  resolvedTheme: ResolvedTheme;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const groups = QUOTA_TAB_ORDER.map((provider) => ({
    provider,
    summaries:
      provider === 'claude'
        ? ['seven-day', 'seven-day-fable'].map((id) => summarizeLedger(accounts, provider, id))
        : [summarizeLedger(accounts, provider)],
  })).filter((group) => (group.summaries[0]?.count ?? 0) > 0);
  return (
    <section className={styles.summary} aria-label={t('quota_management.ledger_summary')}>
      {groups.map(({ provider, summaries }) => {
        const icon = getAuthFileIcon(provider, resolvedTheme);
        return (
          <article key={provider} className={styles.tile}>
            <div className={styles.tileHead}>
              <strong>
                {icon && <img src={icon} alt="" />} {getTypeLabel(t, provider)}
              </strong>
              <span>{t('quota_management.meta_credentials', { count: summaries[0]?.count })}</span>
            </div>
            <div className={styles.summaryWindows}>
              {summaries.map((summary) => {
                const reset = buildResetDisplay('', summary.resetAtMs, now, i18n.resolvedLanguage);
                const label =
                  summary.windowId === 'seven-day'
                    ? t('quota_management.ledger_overall')
                    : summary.windowId === 'seven-day-fable'
                      ? t('quota_management.ledger_fable')
                      : summary.label || t('quota_management.ledger_weekly');
                return (
                  <div key={summary.windowId ?? 'primary'}>
                    <div className={styles.windowLabel}>{label}</div>
                    <div className={styles.total}>
                      <strong>
                        {summary.remaining === null ? '--' : `${Math.round(summary.remaining)}%`}
                      </strong>
                      <span>
                        {t('quota_management.ledger_capacity', { capacity: summary.count * 100 })}
                      </span>
                    </div>
                    <div className={styles.segments}>
                      {accounts
                        .filter((account) => account.entry.type === provider)
                        .map((account) => (
                          <LedgerMeter
                            key={account.entry.file.name}
                            remaining={
                              account.blockingWindow
                                ? 0
                                : summary.windowId
                                  ? (account.windows.find(
                                      (window) => window.id === summary.windowId
                                    )?.remaining ?? null)
                                  : (account.primary?.remaining ?? null)
                            }
                          />
                        ))}
                    </div>
                    {summary.blocked > 0 && (
                      <div className={styles.blocked} role="status">
                        {t('quota_management.ledger_accounts_blocked', { count: summary.blocked })}
                      </div>
                    )}
                    <div className={styles.reset}>
                      {reset
                        ? `${reset.relative} · ${reset.absolute}`
                        : t('quota_management.meta_loaded', { count: summary.loaded })}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function LedgerMeter({ remaining }: { remaining: number | null }) {
  const fill =
    remaining === null
      ? ''
      : remaining >= 70
        ? styles.high
        : remaining >= 30
          ? styles.medium
          : styles.low;
  return (
    <div className={styles.meter}>
      <div className={fill} style={{ width: `${remaining ?? 0}%` }} />
    </div>
  );
}

export function LedgerWindows({ account }: { account: LedgerAccount }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  return (
    <div className={styles.windows}>
      {account.windows.length === 0 ? (
        <span>{t('quota_management.ledger_unavailable')}</span>
      ) : (
        account.windows.map((window, index) => {
          const blocker = account.blockingWindow;
          const blocked = blocker !== null && blocker.id !== window.id;
          const reset = buildResetDisplay(
            '',
            blocked ? blocker.resetAtMs : window.resetAtMs,
            now,
            i18n.resolvedLanguage
          );
          return (
            <div className={styles.window} key={`${window.label}:${index}`}>
              <div className={styles.windowHead}>
                <span>{window.label}</span>
                <strong>
                  {window.remaining === null ? '--' : `${Math.round(window.remaining)}%`}
                </strong>
              </div>
              <LedgerMeter remaining={blocked ? 0 : window.remaining} />
              {blocked && (
                <div className={styles.blocked} role="status">
                  {t('quota_management.ledger_blocked_by', { limit: blocker.label })}
                </div>
              )}
              <div className={styles.reset}>
                {reset
                  ? `${reset.relative} · ${reset.absolute}`
                  : t('quota_management.ledger_no_reset')}
              </div>
            </div>
          );
        })
      )}
      {account.kind === 'codex' && (
        <div className={styles.window}>
          <div className={styles.windowHead}>{t('codex_quota.reset_credits_label')}</div>
          <strong>
            {account.availableResets === null
              ? '--'
              : t('quota_management.ledger_resets_available', { count: account.availableResets })}
          </strong>
          {account.resetExpiries.map((expiry, index) => {
            const reset = buildResetDisplay('', expiry, now, i18n.resolvedLanguage);
            return (
              reset && (
                <div className={styles.reset} key={`${expiry}:${index}`}>
                  {t('codex_quota.reset_credit_number', { index: index + 1 })} · {reset.relative} ·{' '}
                  {reset.absolute}
                </div>
              )
            );
          })}
          {account.creditsError && (
            <div role="status" className={styles.reset}>
              {account.creditsError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
