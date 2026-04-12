#!/bin/bash
# Fix executable permission on the Trading AI shortcut
chmod +x "$HOME/Desktop/Trading AI.app/Contents/MacOS/launch"
echo "Fixed: launch script is now executable"
# Verify
ls -la "$HOME/Desktop/Trading AI.app/Contents/MacOS/launch"
echo ""
echo "Script content:"
cat "$HOME/Desktop/Trading AI.app/Contents/MacOS/launch"
