'use client';

import { useOwner } from '../../lib/hooks/useOwner';
import { useT } from '../../lib/i18n/useT';

export function ChatEmptyState() {
  const { owner } = useOwner();
  const { t } = useT();
  const name = owner?.owner_name?.trim();

  return (
    <div className="chat-empty">
      <img
        src="/assets/holon-icon.png"
        alt="Holon"
        width={56}
        height={56}
        style={{ margin: '0 auto 14px', display: 'block' }}
      />
      <div className="chat-empty-title">
        {name ? t('chat.empty.greeting', 'Hi {name}').replace('{name}', name) : t('chat.empty.greeting_noname', 'Hi there')}
      </div>
      <div className="chat-empty-sub">
        {t('chat.empty.invite_short', "What's on your mind today?")}
      </div>
      <div className="chat-empty-chips">
        <button
          type="button"
          className="chat-chip chat-chip-task"
          onClick={() => {
            document.querySelector<HTMLTextAreaElement>('.chat-input')?.focus();
          }}
        >
          {t('chat.empty.chip_assign_task', 'Assign a task')}
        </button>
      </div>
    </div>
  );
}
