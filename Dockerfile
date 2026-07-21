# syntax=docker/dockerfile:1.7

FROM node:22.17.1-bookworm-slim AS webui

WORKDIR /src/crates/gateway/web
RUN npm install -g pnpm@10.32.1

COPY crates/gateway/web/package.json crates/gateway/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY crates/gateway/web ./
RUN pnpm build

FROM golang:1.25-bookworm AS gateway-builder

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src/crates/gateway

COPY crates/gateway/go.mod crates/gateway/go.sum ./
RUN go mod download

COPY crates/gateway ./
COPY --from=webui /src/crates/gateway/web/dist ./web/dist

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/xagent-gateway ./cmd/gateway

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --user-group --home-dir /nonexistent --shell /usr/sbin/nologin xagent \
    && install -d -o xagent -g xagent -m 0700 /var/lib/xagent

COPY --from=gateway-builder /out/xagent-gateway /usr/local/bin/xagent-gateway

USER xagent

ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/xagent-gateway"]
