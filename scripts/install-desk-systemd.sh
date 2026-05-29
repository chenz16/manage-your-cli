#!/usr/bin/env bash
# install-desk-systemd.sh — install a systemd-user unit so the desk Next.js
# dev server auto-restarts on crash and auto-starts on WSL boot.
#
# Why systemd-user instead of system: WSL2 doesn't run a system systemd by
# default, and even when systemd is enabled in /etc/wsl.conf the user-level
# unit is the cleanest scope for an owner-owned dev server (no root needed,
# the unit lives in ~/.config/systemd/user/).
#
# Idempotent: re-run any time to refresh the unit file.
set -euo pipefail
REPO=/home/chenz/project/myc-mobile
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/holon-desk.service"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "FAIL: systemctl not found. Enable systemd in WSL: edit /etc/wsl.conf with"
  echo "  [boot]"
  echo "  systemd=true"
  echo "then 'wsl --shutdown' from Windows and reopen the WSL shell."
  exit 1
fi
if ! systemctl --user status >/dev/null 2>&1; then
  echo "FAIL: systemd --user not available. Same fix as above (enable systemd in WSL)."
  exit 1
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<EOF
[Unit]
Description=Holon mobile desk (Next.js dev server on :3110)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
# pnpm via corepack — same path as the manual nohup we used.
ExecStart=/usr/bin/env corepack pnpm -F web exec next dev --port 3110 -H 0.0.0.0
Restart=always
RestartSec=3
StandardOutput=append:%h/desk-3110.log
StandardError=append:%h/desk-3110.log
# Give the dev server room — Next dev is memory-hungry under HMR.
LimitNOFILE=4096
# Inherit a usable PATH so node/pnpm work.
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now holon-desk.service
echo
echo "Installed. Useful commands:"
echo "  systemctl --user status holon-desk     # see state"
echo "  systemctl --user restart holon-desk    # bounce"
echo "  systemctl --user stop holon-desk       # stop"
echo "  journalctl --user -u holon-desk -f     # follow logs (in addition to ~/desk-3110.log)"
echo
echo "If WSL doesn't have lingering enabled, the unit may stop when you close all"
echo "WSL sessions. Run once as root: 'sudo loginctl enable-linger \$USER' to keep"
echo "the unit running across WSL session closes."
