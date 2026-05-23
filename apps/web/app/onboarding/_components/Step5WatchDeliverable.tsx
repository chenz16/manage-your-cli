'use client';

import { useT } from '../../../lib/i18n/useT';

interface Props {
  startedAt: number;
  onBack: () => void;
  onDone: () => void;
  onSkipStep: () => void;
  onSkipOnboarding: () => void;
}

export function Step5WatchDeliverable({ onBack, onDone, onSkipStep, onSkipOnboarding }: Props) {
  const { t } = useT();
  return (
    <div className="onb-card">
      <div className="onb-kicker">{t('onboarding.step5.kicker', 'Step 5')}</div>
      <h1>{t('onboarding.step5.title', 'You are ready')}</h1>
      <p className="onb-sub">
        {t('onboarding.step5.subtitle', 'Use chat for the Secretary and Team for live CLI employees.')}
      </p>
      <div className="onb-actions">
        <button type="button" className="btn" onClick={onBack}>{t('onboarding.back', 'Back')}</button>
        <button type="button" className="btn" onClick={onSkipStep}>{t('onboarding.skip_step', 'Skip step')}</button>
        <button type="button" className="btn" onClick={onSkipOnboarding}>{t('onboarding.skip_for_now', 'Skip for now')}</button>
        <button type="button" className="btn primary" onClick={onDone}>{t('onboarding.finish', 'Finish')}</button>
      </div>
    </div>
  );
}
