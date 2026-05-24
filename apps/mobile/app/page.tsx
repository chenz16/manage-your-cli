import WeizoAppClient from './_components/WeizoAppClient';

// Weizo 微作 — WeChat-style 4-tab mobile shell.
// Single-page SPA: renders the full tab shell client-side once paired.
// Old multi-route pages (today/chat/staff/inbound/more) are preserved
// as route stubs so the build stays clean, but this home replaces them
// as the primary entry point.
//
// The SPA is rendered CLIENT-ONLY (WeizoAppClient → next/dynamic ssr:false):
// WeizoApp + @assistant-ui + the Capacitor TTS plugin touch `window` at module
// load, which would crash the `output: 'export'` static export used to package
// the standalone Capacitor APK.
export default function MobileHomePage() {
  return <WeizoAppClient />;
}
