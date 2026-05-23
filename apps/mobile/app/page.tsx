import { MobileLandingChips } from './_components/MobileLandingChips';

// M-L-014 — first-value landing per V1 chat-first vision. Brand + tagline,
// optional micro-summary (driven by client component when /api/v1/jobs +
// /api/v1/deliverables respond), and 3-4 Chinese suggestion chips that
// router.push into /chat?prompt=<chip>. Mirrors EMPTY_SUGGESTIONS from
// apps/web/app/_components/ChatSurface.tsx but tuned for owner-on-phone.
export default function MobileHomePage() {
  return (
    <div className="mobile-shell">
      <section className="landing-hero">
        <div className="landing-brand">Holon</div>
        <p className="landing-tagline">聊天指挥你的 AI 员工</p>
        <MobileLandingChips />
      </section>
    </div>
  );
}
