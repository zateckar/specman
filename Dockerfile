# Specman, as a container.
#
# Two things about this image are not obvious and are the reason it is written
# out rather than generated:
#
#   1. It installs `git`. `simple-git` shells out to the real binary, and every
#      application Specman writes is a real repository. A plain Node image boots
#      perfectly and then fails on the first project anyone creates.
#   2. Everything that must survive a restart is under `/app/data` — the SQLite
#      database *and* every application's repository. That directory is created
#      here, owned by the user the server runs as, so a named volume mounted
#      over it is writable. Without a volume the design documents are lost on
#      the first restart, and nothing reports it.

# --------------------------------------------------------------------- build
FROM node:26-alpine AS build

WORKDIR /app

# Dependencies first: this layer is rebuilt only when the lockfile moves.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# The runtime needs the production tree only. Done here so the final stage
# copies a directory rather than running a package manager.
RUN npm prune --omit=dev


# ------------------------------------------------------------------- runtime
FROM node:26-alpine AS runtime

# The one thing the application shells out to.
RUN apk add --no-cache git

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# `node` (uid 1000) ships with the base image. The data directory is created and
# handed over here: Docker copies this ownership onto an empty named volume when
# it first mounts one, which is what makes the volume writable without the
# server running as root.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

# adapter-node reads these. HOST must be 0.0.0.0 for anything outside the
# container to reach it; what may reach it is decided by how the port is
# published, not here — see `docker-compose.yml`.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# `/health` opens the database, so this reports a missing or read-only volume as
# unhealthy instead of serving pages that cannot store anything. Written with
# node rather than curl because the image has one and not the other.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
