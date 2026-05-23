'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// Load the assistant-ui-heavy shell as a /chat-only async chunk so the
// `@assistant-ui/react` runtime (ThreadPrimitive/ComposerPrimitive/
// useLocalRuntime) never leaks into shared chunks used by inbound/staff/
// today/me. ssr:false — the shell is client-only (streams + useSearchParams).
const MobileChatShell = dynamic(
  () => import('./MobileChatShell').then((m) => m.MobileChatShell),
  { ssr: false },
);

export default function MobileChatPage() {
  // Suspense boundary required by Next 15 App Router for any client component
  // that reads useSearchParams (MobileChatShell hydrates composer from
  // `?prompt=`+`&autosubmit=1` — Pass #1 wiring for landing chips).
  return (
    <Suspense fallback={null}>
      <MobileChatShell />
    </Suspense>
  );
}
