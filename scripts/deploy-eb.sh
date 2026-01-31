#!/bin/bash
# HashLHDN MyInvois Gateway - AWS Elastic Beanstalk Deployment Script
# Usage: ./scripts/deploy-eb.sh [package|version]
#
# This script creates a deployment package for AWS Elastic Beanstalk.
# For a pnpm monorepo, it uses 'pnpm deploy' to bundle workspace dependencies.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$PROJECT_ROOT/apps/gateway"
VERSION=${1:-$(date +%Y%m%d%H%M%S)}
DEPLOY_DIR="$PROJECT_ROOT/.deploy/hashlhdn-$VERSION"
ZIP_NAME="hashlhdn-$VERSION.zip"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

check_requirements() {
    log_step "Checking requirements..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Install with: npm install -g pnpm"
        exit 1
    fi

    if ! command -v zip &> /dev/null; then
        log_error "zip is not installed."
        exit 1
    fi

    log_info "Requirements check passed!"
}

build_project() {
    log_step "Building project..."
    cd "$PROJECT_ROOT"

    # Clean previous build
    pnpm build

    log_info "Build complete!"
}

create_package() {
    log_step "Creating deployment package..."

    # Clean previous deploy directory
    rm -rf "$PROJECT_ROOT/.deploy"
    mkdir -p "$DEPLOY_DIR"

    # Use pnpm deploy to create a pruned deployment
    # This bundles all workspace dependencies into node_modules
    log_info "Running pnpm deploy to bundle workspace dependencies..."
    cd "$PROJECT_ROOT"
    pnpm --filter @myinvois/gateway deploy "$DEPLOY_DIR" --prod

    # Copy additional required files
    log_info "Copying deployment configuration files..."

    # Copy Procfile
    if [ -f "$GATEWAY_DIR/Procfile" ]; then
        cp "$GATEWAY_DIR/Procfile" "$DEPLOY_DIR/"
    else
        echo "web: node dist/server.js" > "$DEPLOY_DIR/Procfile"
    fi

    # Copy .ebextensions
    if [ -d "$GATEWAY_DIR/.ebextensions" ]; then
        cp -r "$GATEWAY_DIR/.ebextensions" "$DEPLOY_DIR/"
    fi

    # Copy .npmrc if exists
    if [ -f "$GATEWAY_DIR/.npmrc" ]; then
        cp "$GATEWAY_DIR/.npmrc" "$DEPLOY_DIR/"
    fi

    # Copy Prisma schema (needed for migrations)
    if [ -d "$PROJECT_ROOT/packages/storage/prisma" ]; then
        mkdir -p "$DEPLOY_DIR/prisma"
        cp -r "$PROJECT_ROOT/packages/storage/prisma"/* "$DEPLOY_DIR/prisma/"
    fi

    # pnpm deploy bundles workspace packages but npm can't work with pnpm's structure
    # Strategy: Save workspace packages, delete node_modules, npm install fresh, restore workspace packages
    log_info "Resolving all dependencies..."
    cd "$DEPLOY_DIR"

    # Step 1: Remove workspace: references from package.json
    log_info "Fixing package.json..."
    node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const [name, ver] of Object.entries(pkg.dependencies || {})) {
  if (ver && ver.startsWith('workspace:')) {
    delete pkg.dependencies[name];
  }
}
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

    # Step 2: Delete pnpm's node_modules and npm install fresh
    log_info "Running fresh npm install..."
    rm -rf node_modules package-lock.json
    npm install --omit=dev 2>&1 | tail -5

    # Step 3: Install additional dependencies BEFORE copying workspace packages
    # (npm prunes "extraneous" packages, so workspace packages must be copied AFTER all npm commands)
    log_info "Installing workspace package dependencies..."
    npm install node-forge@^1.3.3 --save --silent 2>/dev/null || true

    # Fix @opentelemetry/api ESM compatibility issue with Node.js 22
    log_info "Installing @opentelemetry/api for prom-client compatibility..."
    npm install @opentelemetry/api@^1.9.0 --save --silent 2>/dev/null || true

    # Patch @opentelemetry/api package.json to add proper ESM "import" condition
    if [ -f "node_modules/@opentelemetry/api/package.json" ]; then
        log_info "Patching @opentelemetry/api exports for Node.js 22 ESM compatibility..."
        node -e "
const fs = require('fs');
const pkgPath = 'node_modules/@opentelemetry/api/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
// Add import condition for ESM compatibility
if (pkg.exports && pkg.exports['.']) {
    pkg.exports['.'].import = './build/esm/index.js';
}
if (pkg.exports && pkg.exports['./experimental']) {
    pkg.exports['./experimental'].import = './build/esm/experimental/index.js';
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log('Patched @opentelemetry/api exports');
"
    fi

    # Install prisma CLI and client for generation (must match project version)
    log_info "Installing Prisma..."
    npm install prisma@^5.22.0 @prisma/client@^5.22.0 --silent 2>/dev/null || true

    # Generate Prisma client
    log_info "Generating Prisma client..."
    npx prisma generate --schema=./prisma/schema.prisma 2>&1 | tail -3 || {
        log_warn "Prisma generate failed, copying from source..."
        # Fallback: copy from monorepo
        mkdir -p "$DEPLOY_DIR/node_modules/@prisma"
        cp -rL "$PROJECT_ROOT/node_modules/.pnpm/@prisma+client@"*"/node_modules/@prisma/client" "$DEPLOY_DIR/node_modules/@prisma/" 2>/dev/null || true
        cp -rL "$PROJECT_ROOT/node_modules/.pnpm/@prisma+client@"*"/node_modules/.prisma" "$DEPLOY_DIR/node_modules/" 2>/dev/null || true
    }

    # Save the generated Prisma client before uninstalling CLI
    if [ -d "node_modules/.prisma" ]; then
        cp -r node_modules/.prisma /tmp/prisma-generated
    fi

    # Keep prisma CLI for migrations on EB (container_commands run npx prisma migrate deploy)
    # Don't uninstall prisma - it's needed for production migrations
    rm -rf /tmp/prisma-generated 2>/dev/null || true

    # Step 4: Copy workspace packages AFTER all npm commands (to avoid npm pruning them)
    log_info "Copying workspace packages from source..."
    mkdir -p node_modules/@myinvois
    for pkg in contracts core myinvois-client signing storage; do
        SRC="$PROJECT_ROOT/packages/$pkg"
        if [ -d "$SRC/dist" ]; then
            mkdir -p "node_modules/@myinvois/$pkg"
            cp -r "$SRC/dist" "node_modules/@myinvois/$pkg/"
            cp "$SRC/package.json" "node_modules/@myinvois/$pkg/"
            log_info "  ✓ @myinvois/$pkg"
        fi
    done
    rm -rf /tmp/myinvois-deploy

    cd "$PROJECT_ROOT"

    log_info "Package prepared at: $DEPLOY_DIR"
}

create_zip() {
    log_step "Creating ZIP archive..."

    cd "$DEPLOY_DIR"

    # Create ZIP with all files
    # IMPORTANT: Use anchored patterns to avoid matching inside node_modules
    # e.g., "./src/*" only matches top-level src, not node_modules/*/build/src/*
    zip -r "$PROJECT_ROOT/.deploy/$ZIP_NAME" . \
        -x "*.git*" \
        -x "*.ts" \
        -x "./src/*" \
        -x "./test/*" \
        -x "*.test.js" \
        -x "*.spec.js" \
        -x "./coverage/*" \
        -x ".env*" \
        -x "*.md"

    cd "$PROJECT_ROOT"

    # Get ZIP size
    ZIP_SIZE=$(du -h "$PROJECT_ROOT/.deploy/$ZIP_NAME" | cut -f1)

    log_info "ZIP created: .deploy/$ZIP_NAME ($ZIP_SIZE)"
}

show_next_steps() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Deployment Package Ready!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Package location: $PROJECT_ROOT/.deploy/$ZIP_NAME"
    echo ""
    echo -e "${BLUE}Manual Deployment via AWS Console:${NC}"
    echo "  1. Go to AWS Elastic Beanstalk console"
    echo "  2. Select your environment (or create new)"
    echo "  3. Click 'Upload and deploy'"
    echo "  4. Upload .deploy/$ZIP_NAME"
    echo "  5. Set version label: $VERSION"
    echo ""
    echo -e "${BLUE}Deployment via EB CLI:${NC}"
    echo "  # Initialize EB (first time only)"
    echo "  cd .deploy/hashlhdn-$VERSION"
    echo "  eb init -p node.js-22 hashlhdn --region ap-southeast-1"
    echo ""
    echo "  # Create or deploy to environment"
    echo "  eb create hashlhdn-prod --single --instance_type t3.small"
    echo "  # or"
    echo "  eb deploy hashlhdn-prod"
    echo ""
    echo -e "${BLUE}Required Environment Variables (set in EB console):${NC}"
    echo "  DATABASE_URL         - PostgreSQL connection string"
    echo "  REDIS_URL            - Redis/ElastiCache connection string"
    echo "  JWT_SECRET           - Access token signing key (64 hex chars)"
    echo "  JWT_REFRESH_SECRET   - Refresh token signing key (64 hex chars)"
    echo "  CACHE_HASH_SALT      - TIN cache hash salt"
    echo "  SIGNING_PKCS12_PATH  - Path to P12 certificate"
    echo "  SIGNING_PKCS12_PASS  - P12 certificate passphrase"
    echo ""
    echo -e "${YELLOW}Important Notes:${NC}"
    echo "  - EB Node.js 22 platform required"
    echo "  - RDS PostgreSQL and ElastiCache Redis must be set up first"
    echo "  - P12 certificate can be stored in S3 and downloaded via .ebextensions"
    echo "  - Run migrations after first deploy: npx prisma migrate deploy"
    echo ""
}

# Main command handler
case "$1" in
    --help|-h)
        echo "HashLHDN Elastic Beanstalk Deployment Script"
        echo ""
        echo "Usage: $0 [version]"
        echo ""
        echo "Arguments:"
        echo "  version  - Optional version label (default: timestamp)"
        echo ""
        echo "This script:"
        echo "  1. Builds the project"
        echo "  2. Creates a pruned deployment package using pnpm deploy"
        echo "  3. Bundles all workspace dependencies"
        echo "  4. Creates a ZIP file ready for EB deployment"
        echo ""
        echo "Examples:"
        echo "  $0           # Creates hashlhdn-20260120120000.zip"
        echo "  $0 v1.0.0    # Creates hashlhdn-v1.0.0.zip"
        exit 0
        ;;
    *)
        check_requirements
        build_project
        create_package
        create_zip
        show_next_steps
        ;;
esac
