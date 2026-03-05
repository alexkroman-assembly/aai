import { Hono } from "@hono/hono";

const INSTALL_SCRIPT = `#!/bin/sh
set -e

REPO="alexkroman/aai"
INSTALL_DIR="\${AAI_INSTALL_DIR:-\$HOME/.aai/bin}"

# Detect OS and architecture
OS="\$(uname -s)"
ARCH="\$(uname -m)"

case "\$OS" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "Unsupported OS: \$OS" >&2; exit 1 ;;
esac

case "\$ARCH" in
  arm64|aarch64) arch="arm64" ;;
  x86_64)        arch="x64" ;;
  *) echo "Unsupported architecture: \$ARCH" >&2; exit 1 ;;
esac

ARTIFACT="aai-\${os}-\${arch}"

# Get latest version from GitHub
VERSION="\$(curl -fsSL "https://api.github.com/repos/\$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\\(.*\\)".*/\\1/')"

if [ -z "\$VERSION" ]; then
  echo "Failed to get latest version" >&2
  exit 1
fi

URL="https://github.com/\$REPO/releases/download/v\${VERSION}/\${ARTIFACT}.tar.gz"

echo "Installing aai v\$VERSION (\$os/\$arch)..."

# Download and extract
mkdir -p "\$INSTALL_DIR"
TMP="\$(mktemp -d)"
trap 'rm -rf "\$TMP"' EXIT

curl -fsSL "\$URL" | tar xz -C "\$TMP"
mv "\$TMP/aai" "\$INSTALL_DIR/aai"
chmod +x "\$INSTALL_DIR/aai"

echo "Installed aai to \$INSTALL_DIR/aai"

# Check if INSTALL_DIR is in PATH
case ":\$PATH:" in
  *":\$INSTALL_DIR:"*) ;;
  *)
    SHELL_NAME="\$(basename "\$SHELL")"
    case "\$SHELL_NAME" in
      zsh)  RC="\$HOME/.zshrc" ;;
      bash) RC="\$HOME/.bashrc" ;;
      fish) RC="\$HOME/.config/fish/config.fish" ;;
      *)    RC="" ;;
    esac
    if [ -n "\$RC" ]; then
      echo "" >> "\$RC"
      echo "export PATH=\\"\\\$HOME/.aai/bin:\\\$PATH\\"" >> "\$RC"
      echo "Added \$INSTALL_DIR to PATH in \$RC"
      echo "Run: source \$RC"
    else
      echo "Add \$INSTALL_DIR to your PATH"
    fi
    ;;
esac

echo "Run 'aai' to get started"
`;

export function installRoute(): Hono {
  const routes = new Hono();
  routes.get("/install", (c) => {
    return c.body(INSTALL_SCRIPT, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });
  return routes;
}
