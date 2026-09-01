# E2B sandbox template for hackathon evaluation.
# Build with:  npx @e2b/cli template build --name hackathon-eval
# Then set E2B_TEMPLATE="hackathon-eval" in your environment.
#
# Provides git, Node, and Playwright + Chromium so the responsiveness step can
# run a headless browser INSIDE the sandbox against the submission's server.

FROM e2bdev/code-interpreter:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Playwright + browser with OS deps.
RUN npm install -g playwright@latest \
    && npx --yes playwright@latest install --with-deps chromium

# Make the global playwright resolvable to `require('playwright')` in scripts.
ENV NODE_PATH=/usr/lib/node_modules
