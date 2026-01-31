#!/bin/bash
set -e

# Always overwrite plugin JARs and server.properties from image (IaC)
mkdir -p /data/plugins
cp -f /opt/minecraft/plugins/*.jar /data/plugins/
cp -f /opt/minecraft/server.properties /data/server.properties

# First run only
[ -f /data/eula.txt ] || echo "eula=true" > /data/eula.txt

# Derive heap from container cgroup limit (75%, leaves room for off-heap + OS).
# Falls back to MEMORY_MAX env var or 4G if cgroup is unavailable.
CGROUP_LIMIT=$(cat /sys/fs/cgroup/memory.max 2>/dev/null \
            || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null \
            || echo 0)
if [ "$CGROUP_LIMIT" != "max" ] && [ "$CGROUP_LIMIT" -gt 0 ] 2>/dev/null; then
    HEAP_BYTES=$(( CGROUP_LIMIT * 75 / 100 ))
    HEAP_MB=$(( HEAP_BYTES / 1048576 ))
    JVM_HEAP="${HEAP_MB}m"
else
    JVM_HEAP="${MEMORY_MAX:-4G}"
fi

echo "Container memory limit: ${CGROUP_LIMIT} bytes, JVM heap: ${JVM_HEAP}"

# Aikar's flags for >12 GB heaps (G1HeapRegionSize=16M, adjusted percentages).
# https://docs.papermc.io/paper/aikars-flags
# Run Paper inside tmux so we can attach to console later
# Send commands:  kubectl exec -it -n minecraft <pod> -- tmux attach
# Or one-shot:    kubectl exec -n minecraft <pod> -- tmux send-keys "op Player" Enter
exec tmux new-session -s mc \
    java \
    -Xms${JVM_HEAP} \
    -Xmx${JVM_HEAP} \
    -XX:+UseG1GC \
    -XX:+ParallelRefProcEnabled \
    -XX:MaxGCPauseMillis=200 \
    -XX:+UnlockExperimentalVMOptions \
    -XX:+DisableExplicitGC \
    -XX:+AlwaysPreTouch \
    -XX:G1NewSizePercent=40 \
    -XX:G1MaxNewSizePercent=50 \
    -XX:G1HeapRegionSize=16M \
    -XX:G1ReservePercent=15 \
    -XX:G1HeapWastePercent=5 \
    -XX:G1MixedGCCountTarget=4 \
    -XX:InitiatingHeapOccupancyPercent=20 \
    -XX:G1MixedGCLiveThresholdPercent=90 \
    -XX:G1RSetUpdatingPauseTimePercent=5 \
    -XX:SurvivorRatio=32 \
    -XX:+PerfDisableSharedMem \
    -XX:MaxTenuringThreshold=1 \
    -Dusing.aikars.flags=https://mcflags.emc.gs \
    -Daikars.new.flags=true \
    -jar /opt/minecraft/paper.jar --nogui
