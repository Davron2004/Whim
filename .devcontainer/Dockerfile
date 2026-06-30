# Whim fix-loop dev container.
#
# ROLE IN THE THREAT MODEL (see docs/parallel-fix-loop.md §6.7):
#   This container is the Threat-C boundary (arbitrary execution / exfil).
#   It REPLACES the macOS Seatbelt sandbox + the excludedCommands carve-outs,
#   which were Swiss cheese: Chromium can't run under Seatbelt, so the three
#   Chromium suites + fixloop.sh ran UN-sandboxed. Inside this container,
#   network egress is locked to Anthropic only (init-firewall.sh), so Chromium
#   running freely no longer matters — there is nowhere to exfil to.
#   Threats A (hooks) and B (integrity / redcheck / fresh-gate / reviewer)
#   are UNCHANGED — they run inside, exactly as on the host.
#
# Toolchain is the fix loop's ONLY: Node 22 + Chromium + the repo's own
# node_modules. NO Android SDK / JDK / emulator — the loop never builds the device app.

FROM node:22-bookworm

# --- OS packages -----------------------------------------------------------
#   git                      : worktrees, merges, the deterministic checks
#   iptables ipset iproute2  : init-firewall.sh (egress lockdown)
#   dnsutils ca-certificates : DNS resolution for the firewall allowlist + TLS
#   sudo                     : the 'node' user applies the firewall at start
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      iptables \
      ipset \
      iproute2 \
      dnsutils \
      ca-certificates \
      sudo \
    && rm -rf /var/lib/apt/lists/*

# Let the unprivileged 'node' user apply the firewall (needs NET_ADMIN) at start.
RUN echo 'node ALL=(root) NOPASSWD: /workspace/.devcontainer/init-firewall.sh' \
      > /etc/sudoers.d/firewall && chmod 0440 /etc/sudoers.d/firewall

# Claude Code CLI (the orchestrator + its fixer subagents all run in here).
RUN npm install -g @anthropic-ai/claude-code

# Playwright Chromium lives OUTSIDE node_modules so the read-only node_modules
# mount (the run-time node_modules-poison guard) does not hide the browser.
# Pin to the repo's playwright minor (package.json: "playwright": "^1.49.0").
# --with-deps pulls the Chromium apt libraries; must run as root at build time.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.49.1 install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

# Quiet git's "dubious ownership" on the bind-mounted (host-owned) /workspace.
RUN git config --system --add safe.directory /workspace

# Disable Claude Code's OS sandbox INSIDE the container. The container itself is
# the Threat-C boundary (egress firewall), so the host's bind-mounted
# .claude/settings.json (sandbox:true — correct for macOS Seatbelt) must NOT apply
# here. Managed settings outrank project settings AND live in the image (never on
# the bind mount), so the host file stays untouched and sandbox:true on the host.
# (Linux backend is bubblewrap+socat, deliberately NOT installed; disabling here
# means no fail-open warning. failIfUnavailable stays off — we never want it on.)
RUN mkdir -p /etc/claude-code \
    && printf '{ "sandbox": { "enabled": false } }\n' > /etc/claude-code/managed-settings.json

USER node
WORKDIR /workspace

# Pre-trust the bind-mounted /workspace so headless runs don't stall on (and
# don't ignore .claude/settings.json because of) the first-run trust dialog.
# Key/path are exactly what Claude Code's untrusted-workspace warning names.
RUN printf '{ "projects": { "/workspace": { "hasTrustDialogAccepted": true, "hasCompletedProjectOnboarding": true } } }\n' \
      > /home/node/.claude.json
