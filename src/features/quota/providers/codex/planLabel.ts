import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';

export function getCodexPlanLabel(planType: string | null, translate: (key: string) => string) {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return translate('codex_quota.plan_business_premium');
  }
  if (normalized === 'pro') return translate('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return translate('codex_quota.plan_prolite');
  if (normalized === 'plus') return translate('codex_quota.plan_plus');
  if (normalized === 'team') return translate('codex_quota.plan_team');
  if (normalized === 'free') return translate('codex_quota.plan_free');
  return planType || normalized;
}
