#!/bin/bash
cd "$(dirname "$0")"
echo "Starting tracker + proxy..."
node server/server.js &
TRACKER_PID=$!
node server/proxy.js &
PROXY_PID=$!
trap "kill $TRACKER_PID $PROXY_PID 2>/dev/null" EXIT
wait
