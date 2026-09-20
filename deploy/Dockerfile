# Whim generation server image (design D2). Build context is the repo root, filtered by the root
# .dockerignore. Cloud Build runs it as linux/amd64 (deploy/cloudbuild.yaml):
#
#   docker build --platform linux/amd64 -f deploy/Dockerfile .
#
# Every stage is Node 22 pinned by digest, because production must run the Node major every gate
# runs. The Playwright pin below must equal package-lock.json's resolved `playwright` version, and
# the deploy-config tripwire (server/test/deploy-config.suite.ts) fails when either moves alone.

# 1. build: the whole workspace, then the self-contained runtime tree (handoff/runtime-tree.md).
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && node server/build.mjs

# 2. deps: the server workspace's production dependency closure only. The workspace links are
# dropped because the runtime tree bundles @whim/*. The build fails if React or React Native leak in.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false --ignore-scripts \
  && rm -rf node_modules/@whim \
  && test ! -e node_modules/react \
  && test ! -e node_modules/react-native

# 3. runtime: Chromium's headless shell at the lockfile's Playwright version, the runtime tree and
# the production closure, run as a fixed non-root user.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes --ignore-scripts --package=playwright@1.60.0 playwright install --with-deps --only-shell chromium \
  && chmod -R a+rX /ms-playwright \
  && rm -rf /root/.npm /var/lib/apt/lists/*
RUN groupadd --gid 10001 whim \
  && useradd --uid 10001 --gid 10001 --no-log-init --no-create-home --home-dir /tmp --shell /usr/sbin/nologin whim
WORKDIR /app
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /src/server/dist/app ./
# The root filesystem is read-only on the VM (deploy/compose.yaml), so $HOME points at the /tmp tmpfs
# for Chromium's and fontconfig's per-user state.
ENV NODE_ENV=production HOME=/tmp
USER 10001:10001
EXPOSE 8787
CMD ["node", "--enable-source-maps", "server/main.mjs"]
