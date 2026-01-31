# ── Stage 1: download Paper + plugins ─────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine AS builder

RUN apk add --no-cache curl jq

WORKDIR /build
RUN mkdir -p plugins

# helper: download from Modrinth by project ID
RUN printf '#!/bin/sh\nset -e\nURL=$(curl -sf "https://api.modrinth.com/v2/project/$1/version?loaders=%%5B%%22paper%%22%%5D" | jq -r ".[0].files[] | select(.primary) | .url")\n[ -n "$URL" ] || { echo "FAIL: empty URL for Modrinth project $1"; exit 1; }\necho "Downloading $URL"\ncurl -fSL -o "$2" "$URL"\n' > /usr/local/bin/modrinth && chmod +x /usr/local/bin/modrinth

# Paper — latest stable build
RUN set -e; \
    VER=$(curl -sf https://api.papermc.io/v2/projects/paper \
          | jq -r '.versions | last'); \
    BUILD=$(curl -sf "https://api.papermc.io/v2/projects/paper/versions/$VER/builds" \
            | jq -r '[.builds[] | select(.channel=="default")] | last | .build'); \
    curl -fSL -o paper.jar \
      "https://api.papermc.io/v2/projects/paper/versions/$VER/builds/$BUILD/downloads/paper-$VER-$BUILD.jar"; \
    echo "Paper $VER build $BUILD"

# LuckPerms (Modrinth: Vebnzrzj)
RUN modrinth Vebnzrzj plugins/LuckPerms.jar

# AuthMe ReReloaded (Modrinth: 3IEZ9vol)
RUN modrinth 3IEZ9vol plugins/AuthMe.jar

# Simple Voice Chat (Modrinth: 9eGKb6K1)
RUN modrinth 9eGKb6K1 plugins/SimpleVoiceChat.jar

# SleepMost (GitHub)
RUN set -e; \
    URL=$(curl -sfH "User-Agent: DockerBuild" \
         https://api.github.com/repos/mrgeneralq/sleep-most/releases/latest \
         | jq -r '.assets[] | select(.name | endswith(".jar")) | .browser_download_url'); \
    [ -n "$URL" ] || { echo "FAIL: SleepMost URL empty"; exit 1; }; \
    curl -fSL -o plugins/SleepMost.jar "$URL"

# ViaVersion (Modrinth: P1OZGk5p)
RUN modrinth P1OZGk5p plugins/ViaVersion.jar

# ViaBackwards (Modrinth: NpvuJQoq)
RUN modrinth NpvuJQoq plugins/ViaBackwards.jar

# TAB (Modrinth: gG7VFbG0)
RUN modrinth gG7VFbG0 plugins/TAB.jar

# SkinsRestorer (Modrinth: TsLS8Py5)
RUN modrinth TsLS8Py5 plugins/SkinsRestorer.jar

# spark is bundled with Paper 1.21+

# ── Stage 2: lean runtime image ───────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache bash tini tmux ncurses-terminfo-base && \
    addgroup -S minecraft && \
    adduser  -S -G minecraft -u 1000 minecraft

# Binaries — immutable, never mounted over
COPY --from=builder /build/paper.jar   /opt/minecraft/paper.jar
COPY --from=builder /build/plugins/    /opt/minecraft/plugins/
COPY server.properties                 /opt/minecraft/server.properties
COPY entrypoint.sh                     /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data dir — safe to mount entirely or per-subdirectory
RUN mkdir -p /data && chown minecraft:minecraft /data
WORKDIR /data

USER minecraft

ENV TERM=xterm

# game
EXPOSE 25565/tcp
# Simple Voice Chat
EXPOSE 24454/udp

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
