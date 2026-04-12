#!/bin/bash
# ============================================================
# Fix Trading AI Desktop Shortcut
# Points to the LIVE Cloud Run deployment
# Double-click this file to apply the fix.
# ============================================================
set -euo pipefail

APP_PATH="$HOME/Desktop/Trading AI.app"
LAUNCH_SCRIPT="${APP_PATH}/Contents/MacOS/launch"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Trading AI.app not found on Desktop!"
  echo "Expected: $APP_PATH"
  exit 1
fi

echo "Updating Trading AI shortcut..."
echo "Target: https://trade-ai-3rzn6ry36q-ew.a.run.app/crypto-radar"
echo ""

cat > "$LAUNCH_SCRIPT" << 'LAUNCH_EOF'
#!/bin/bash
# ============================================================
# Trading AI — Phoenix V2 (Cloud Run)
# Opens the live Trading AI dashboard on Google Cloud Run
# Project: evident-trees-453923-f9 | Service: antigravity-trade
# URL: https://trade-ai-3rzn6ry36q-ew.a.run.app
# ============================================================
open "https://trade-ai-3rzn6ry36q-ew.a.run.app/crypto-radar"
LAUNCH_EOF

chmod +x "$LAUNCH_SCRIPT"

echo "Done! Launch script updated."
echo ""
echo "Contents of launch script:"
echo "---"
cat "$LAUNCH_SCRIPT"
echo "---"
echo ""
echo "Testing shortcut now..."
open "$APP_PATH"
echo ""
echo "Press Enter to close..."
read
