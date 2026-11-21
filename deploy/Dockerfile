# Whim generation server image (design D2). Build context is the repo root, filtered by the root
# .dockerignore. Cloud Build runs it as linux/amd64 (deploy/cloudbuild.yaml):
#
#   docker build --platform linux/amd64 -f deploy/Dockerfile .
#
# Every stage is Node 26 pinned by digest, because production must run the Node major every gate
# runs. The Playwright pin below must equal package-lock.json's resolved `playwright` version, and
# the deploy-config tripwire (server/test/deploy-config.suite.ts) fails when either moves alone.

# 1. build: the whole workspace, then the self-contained runtime tree (handoff/runtime-tree.md).
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && node server/build.mjs

# 2. deps: the server workspace's production dependency closure only. npm places it in the root
# node_modules, in server/node_modules where a root version conflicts, or both (with nested
# node_modules under either), so both directories are made to exist and both are copied. The
# workspace links are dropped because the runtime tree bundles @whim/*. The build fails if React or
# React Native leak into either.
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false --ignore-scripts \
  && mkdir -p node_modules server/node_modules \
  && rm -rf node_modules/@whim server/node_modules/@whim \
  && test ! -e node_modules/react \
  && test ! -e node_modules/react-native \
  && test ! -e server/node_modules/react \
  && test ! -e server/node_modules/react-native

# 3. runtime: Chromium's headless shell at the lockfile's Playwright version, the runtime tree and
# the production closure, run as a fixed non-root user. The closure keeps npm's layout relative to
# the entry, /app/server/main.mjs, so Node finds each package where npm put it (the deploy-config
# suite resolves every production import through this layout).
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes --ignore-scripts --package=playwright@1.65.1 playwright install --with-deps --only-shell chromium \
  && chmod -R a+rX /ms-playwright \
  && rm -rf /root/.npm /var/lib/apt/lists/*
RUN groupadd --gid 10001 whim \
  && useradd --uid 10001 --gid 10001 --no-log-init --no-create-home --home-dir /tmp --shell /usr/sbin/nologin whim
WORKDIR /app
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=deps /deps/server/node_modules ./server/node_modules
COPY --from=build /src/server/dist/app ./
# The root filesystem is read-only on the VM (deploy/compose.yaml), so $HOME points at the /tmp tmpfs
# for Chromium's and fontconfig's per-user state.
ENV NODE_ENV=production HOME=/tmp
# The commit this image is built from (developer-observability D13): deploy/cloudbuild.yaml passes
# Cloud Build's $COMMIT_SHA, the same SHA that tags the image, so /health and the boot log describe
# these bytes and a rollback reports its own commit. Any other build reports "unknown". Declared
# last so a new commit rebuilds only this layer.
ARG WHIM_COMMIT=unknown
ENV WHIM_COMMIT=$WHIM_COMMIT
USER 10001:10001
EXPOSE 8787
CMD ["node", "--enable-source-maps", "server/main.mjs"]
