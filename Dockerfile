FROM oven/bun:1.4.0 AS base
WORKDIR /app
COPY package.json ./
COPY bun.lock ./
COPY patches/ ./patches
COPY tsconfig.json ./
RUN mkdir -p /data && chown bun:bun /data

FROM base AS migrate
RUN bun install --frozen-lockfile
COPY prisma.config.ts ./
COPY src/modules/prisma/ ./src/modules/prisma
ENV DO_NOT_TRACK=1
USER bun
CMD ["bunx", "prisma", "db", "migrate"]

FROM base AS runtime
RUN bun install --production --frozen-lockfile
COPY src/ ./src
COPY scripts/ ./scripts

ENV PORT=8000 \
  SQLITE_PATH=/data/db.sqlite \
  DATA_PATH=/data

EXPOSE 8000

USER bun

CMD ["bun", "./src"]
