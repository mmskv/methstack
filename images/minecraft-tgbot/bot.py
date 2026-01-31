#!/usr/bin/env python3
"""Updates Telegram group chat titles with Minecraft player count.

Discovers groups from incoming updates (getUpdates). On each tick:
  1. Process pending updates — track group chat_ids, delete title-change
     service messages to avoid noise.
  2. For each known group, fetch its current title via getChat, strip our
     suffix to recover the admin-set base name, and set the new title.

Title format: "{base name} (N mining rn)" when players > 0, else just base name.
"""

import asyncio
import logging
import os
import re
import urllib.request

from telegram import Bot
from telegram.request import HTTPXRequest

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

TOKEN = os.environ["BOT_TOKEN"]
METRICS_URL = os.environ.get(
    "MC_METRICS_URL", "http://minecraft-mc-exporter-svc.minecraft:8080/metrics"
)
SOCKS_HOST = os.environ.get("SOCKS_HOST", "")
SOCKS_PORT = os.environ.get("SOCKS_PORT", "1080")
INTERVAL = int(os.environ.get("INTERVAL", "60"))
GROUPS = os.environ.get("GROUPS", "")  # comma-separated chat IDs

SUFFIX_RE = re.compile(r"^(.*?)\s*\(\d+ mining rn\)$")


def player_count() -> int:
    """Get online player count from mc-monitor /metrics."""
    with urllib.request.urlopen(METRICS_URL, timeout=10) as r:
        for line in r.read().decode().splitlines():
            if line.startswith("minecraft_status_players_online_count"):
                return int(float(line.split()[-1]))
    return 0


def base_name(title: str) -> str:
    """Strip our suffix to get the admin-set group name."""
    m = SUFFIX_RE.match(title)
    return m.group(1) if m else title


async def main():
    proxy = f"socks5://{SOCKS_HOST}:{SOCKS_PORT}" if SOCKS_HOST else None

    def make_request():
        return HTTPXRequest(
            proxy=proxy,
            connect_timeout=30.0,
            read_timeout=30.0,
            write_timeout=30.0,
        )

    kwargs = (
        {"request": make_request(), "get_updates_request": make_request()}
        if proxy
        else {}
    )

    async with Bot(token=TOKEN, **kwargs) as bot:
        groups: dict[int, str] = {}  # chat_id -> last known base name
        offset = None

        # seed from GROUPS env var
        for g in GROUPS.split(","):
            g = g.strip()
            if g:
                cid = int(g)
                try:
                    chat = await bot.get_chat(cid)
                    groups[cid] = base_name(chat.title or "")
                    log.info("configured group %d: %s", cid, groups[cid])
                except Exception as e:
                    log.warning("failed to load group %s: %s", g, e)

        log.info("starting with %d groups", len(groups))

        while True:
            try:
                updates = await bot.get_updates(
                    offset=offset,
                    timeout=0,
                    read_timeout=30,
                    allowed_updates=["message", "my_chat_member"],
                )

                for u in updates:
                    offset = u.update_id + 1

                    if u.message and u.message.chat.type in ("group", "supergroup"):
                        cid = u.message.chat.id
                        if cid not in groups:
                            groups[cid] = base_name(u.message.chat.title or "")
                            log.info("discovered %d: %s", cid, groups[cid])
                        if u.message.new_chat_title:
                            try:
                                await bot.delete_message(cid, u.message.message_id)
                            except Exception:
                                pass
                            groups[cid] = base_name(u.message.new_chat_title)

                    if mcm := u.my_chat_member:
                        if mcm.chat.type in ("group", "supergroup"):
                            st = mcm.new_chat_member.status
                            if st in ("member", "administrator"):
                                groups[mcm.chat.id] = base_name(mcm.chat.title or "")
                                log.info("joined %d", mcm.chat.id)
                            elif st in ("left", "kicked"):
                                groups.pop(mcm.chat.id, None)

                n = player_count()
                log.info(
                    "tick: %d groups, %d players, ids=%s",
                    len(groups), n, list(groups.keys()),
                )

                for cid in list(groups):
                    try:
                        chat = await bot.get_chat(cid)
                        groups[cid] = base_name(chat.title or "")
                        want = (
                            f"{groups[cid]} ({n} mining rn)" if n else groups[cid]
                        )
                        if (chat.title or "") != want:
                            await bot.set_chat_title(cid, want)
                            log.info("set %d: %s", cid, want)
                            # immediately grab and delete the service message
                            svc = await bot.get_updates(
                                offset=offset, timeout=0, read_timeout=30,
                            )
                            for s in svc:
                                offset = s.update_id + 1
                                if s.message and s.message.new_chat_title:
                                    try:
                                        await bot.delete_message(
                                            s.message.chat.id,
                                            s.message.message_id,
                                        )
                                    except Exception:
                                        pass
                    except Exception as e:
                        log.warning("update %d failed: %s", cid, e)

            except Exception as e:
                log.error("loop: %s", e)

            await asyncio.sleep(INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
