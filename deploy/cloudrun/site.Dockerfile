# The pages host image (deploy/cloudrun/deploy.sh): Caddy 2.11.4, pinned by digest alone (a tag beside
# a digest is ignored by the runtime), with the rendered site and deploy/cloudrun/Caddyfile baked in.
# The build context is the staging directory deploy.sh assembles, not the repo. Runs as an unprivileged
# user: the port is 8080 (>= 1024) and Caddy's state directories are handed to that user. The official
# binary carries the cap_net_bind_service file capability, which a non-root exec needs in the
# container's bounding set; port 8080 does not need it, so it is stripped.
FROM caddy@sha256:13ba145cba2f3e28fa801994876e4c086d1b95d5aa2a520a734765ffb6b12017
RUN adduser -D -H -u 10001 caddy-site \
 && chown -R caddy-site /data /config \
 && apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap
COPY Caddyfile /etc/caddy/Caddyfile
COPY site /srv/site
USER caddy-site
