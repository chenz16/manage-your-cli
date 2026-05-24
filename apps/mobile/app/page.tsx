import { WeizoApp } from './_components/WeizoApp';

// Weizo 微作 — WeChat-style 4-tab mobile shell.
// Single-page SPA: renders the full tab shell client-side once paired.
// Old multi-route pages (today/chat/staff/inbound/more) are preserved
// as route stubs so the build stays clean, but this home replaces them
// as the primary entry point.
export default function MobileHomePage() {
  return <WeizoApp />;
}
