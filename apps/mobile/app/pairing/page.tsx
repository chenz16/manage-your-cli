import { PairingForm } from './_components/PairingForm';

// M-L-061 — Pairing page. Rendered when no desktop connection is stored.
// MobileBootstrap (rendered in layout) redirects here if unpaired.
// PairingForm is a 'use client' component; on success it does
// window.location.href = '/' to re-enter the app.
export default function PairingPage() {
  return <PairingForm />;
}
