#!/bin/bash
set -e

echo "Installing pi-agent-config..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if PI_CONFIG_DIR is set, default to ~/.pi/agent
PI_CONFIG_DIR="${PI_CONFIG_DIR:-$HOME/.pi/agent}"

echo "Installing to: $PI_CONFIG_DIR"

# Create .pi/agent directory if it doesn't exist
mkdir -p "$PI_CONFIG_DIR"

# Backup existing config if present
if [ -d "$PI_CONFIG_DIR" ] && [ "$(ls -A $PI_CONFIG_DIR)" ]; then
    BACKUP_DIR="$HOME/.pi/agent.backup.$(date +%Y%m%d-%H%M%S)"
    echo "Backing up existing config to: $BACKUP_DIR"
    cp -r "$PI_CONFIG_DIR" "$BACKUP_DIR"
fi

# Symlink this directory to PI_CONFIG_DIR
# Remove existing symlink or directory first
if [ -L "$PI_CONFIG_DIR" ]; then
    rm "$PI_CONFIG_DIR"
elif [ -d "$PI_CONFIG_DIR" ]; then
    rm -rf "$PI_CONFIG_DIR"
fi

# Create symlink
ln -sf "$SCRIPT_DIR" "$PI_CONFIG_DIR"
echo "✅ Config linked: $PI_CONFIG_DIR -> $SCRIPT_DIR"

# Create agent directory if not exists
mkdir -p "$SCRIPT_DIR/agent"

# Check for auth.json
if [ ! -f "$SCRIPT_DIR/agent/auth.json" ]; then
    echo "⚠️  Warning: No auth.json found in agent/"
    echo "   Please add your LLM API keys to: $SCRIPT_DIR/agent/auth.json"
    
    # Create template
    cat > "$SCRIPT_DIR/agent/auth.json.example" << 'EOF'
{
  "kimi": {
    "apiKey": "your-kimi-api-key"
  },
  "anthropic": {
    "apiKey": "your-anthropic-api-key"
  },
  "openai": {
    "apiKey": "your-openai-api-key"
  }
}
EOF
    echo "   Template created at: $SCRIPT_DIR/agent/auth.json.example"
fi

# Install as pi package (if pi is installed)
if command -v pi &> /dev/null; then
    echo "Installing as pi package..."
    cd "$SCRIPT_DIR"
    pi install . || echo "⚠️  Could not install as pi package (pi may not support local installs)"
fi

echo ""
echo "✅ pi-agent-config installed successfully!"
echo ""
echo "Next steps:"
echo "1. Ensure agent/auth.json has your API keys"
echo "2. Restart pi to load the new configuration"
echo "3. Run 'pi list' to verify packages are loaded"
