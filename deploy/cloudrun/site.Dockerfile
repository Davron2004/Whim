# The pages host image (deploy/cloudrun/deploy.sh): Caddy, pinned by digest like deploy/compose.yaml's,
# with the rendered site and deploy/cloudrun/Caddyfile baked in. The build context is the staging
# directory deploy.sh assembles, not the repo.
FROM caddy:2.11.4@sha256:13ba145cba2f3e28fa801994876e4c086d1b95d5aa2a520a734765ffb6b12017
COPY Caddyfile /etc/caddy/Caddyfile
COPY site /srv/site
