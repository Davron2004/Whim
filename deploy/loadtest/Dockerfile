# The load-test image (design D26; specs/server-deployment "A load test measures capacity without
# spending provider credit"). Build context is the repo root, filtered by the sibling
# Dockerfile.dockerignore (the root .dockerignore excludes deploy/, which this build stage needs).
#
#   docker build --platform linux/amd64 -f deploy/loadtest/Dockerfile \
#     --build-arg SERVER_IMAGE=<region>-docker.pkg.dev/<project>/whim/server:<sha> .
#
# Stage 1 builds the SAME way `deploy/Dockerfile`'s build stage does, then bundles the load-test
# entry instead of the production one. Stage 2 starts from the ALREADY-BUILT production image of
# the same commit (`SERVER_IMAGE`) and only swaps the bundle and its command — every hardening
# choice (non-root user 10001, no key, the runtime closure) rides along unchanged.
ARG SERVER_IMAGE

FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && node server/loadtest-build.mjs

FROM ${SERVER_IMAGE} AS runtime
COPY --from=build --chown=10001:10001 /src/server/dist/loadtest/server/loadtest-server.mjs /src/server/dist/loadtest/server/loadtest-server.mjs.map ./server/
CMD ["node", "--enable-source-maps", "server/loadtest-server.mjs"]
