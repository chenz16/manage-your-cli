# Mobile Pairing BFF Notes

This pass only adds the web/BFF pairing and device-token auth layer.

For LAN verification, the Next.js BFF must listen on the LAN interface. Run the web app with a LAN bind, for example:

```powershell
$env:HOSTNAME = "0.0.0.0"
pnpm --filter @holon/web dev
```

This is intentionally only an operator note here. The Windows/Tauri `apps/web/src-tauri/src/lib.rs` bind change is a separate follow-up.
