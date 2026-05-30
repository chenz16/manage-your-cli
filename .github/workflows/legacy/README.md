## Disabled CI workflows

`windows-installer.yml` produces sister-repo Holon installer artifacts
and is heavily coupled to the Hermes Python sidecar. Moved here to
disable. See `apps/web/legacy-src-tauri/` for the matching Tauri
scaffold. Promote back to `..` after washing if MYC ever needs a
Windows installer.
