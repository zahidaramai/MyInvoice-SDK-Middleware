#!/bin/bash
#
# Generate SDKs from OpenAPI specification
# Uses Docker for reproducible, deterministic output
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OPENAPI_SPEC="openapi/openapi.yaml"
GENERATOR_VERSION="v7.10.0"  # Pin to specific version for reproducibility
GENERATOR_IMAGE="openapitools/openapi-generator-cli:${GENERATOR_VERSION}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required but not installed. Please install Docker."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
}

# Generate SDK for a specific language
generate_sdk() {
    local generator=$1
    local output_dir=$2
    local config_file=$3

    log_info "Generating ${generator} SDK..."

    # Clean output directory (but keep .gitignore if exists)
    if [ -d "${PROJECT_ROOT}/${output_dir}" ]; then
        # Preserve .gitignore
        if [ -f "${PROJECT_ROOT}/${output_dir}/.gitignore" ]; then
            cp "${PROJECT_ROOT}/${output_dir}/.gitignore" /tmp/sdk-gitignore-backup
        fi
        rm -rf "${PROJECT_ROOT}/${output_dir}"
        mkdir -p "${PROJECT_ROOT}/${output_dir}"
        if [ -f /tmp/sdk-gitignore-backup ]; then
            mv /tmp/sdk-gitignore-backup "${PROJECT_ROOT}/${output_dir}/.gitignore"
        fi
    else
        mkdir -p "${PROJECT_ROOT}/${output_dir}"
    fi

    # Run OpenAPI Generator in Docker
    docker run --rm \
        -v "${PROJECT_ROOT}:/local" \
        "${GENERATOR_IMAGE}" generate \
        -i "/local/${OPENAPI_SPEC}" \
        -g "${generator}" \
        -o "/local/${output_dir}" \
        -c "/local/openapi-generator/${config_file}" \
        --additional-properties=hideGenerationTimestamp=true

    log_info "Generated ${generator} SDK in ${output_dir}"
}

# Add .gitignore to SDK directories
add_gitignores() {
    # TypeScript
    cat > "${PROJECT_ROOT}/sdks/typescript/.gitignore" << 'EOF'
# Build artifacts
dist/
node_modules/
*.tgz

# IDE
.idea/
.vscode/
*.swp
EOF

    # Python
    cat > "${PROJECT_ROOT}/sdks/python/.gitignore" << 'EOF'
# Byte-compiled / optimized
__pycache__/
*.py[cod]
*$py.class

# Distribution / packaging
dist/
build/
*.egg-info/
.eggs/

# Virtual environments
venv/
.venv/
ENV/

# IDE
.idea/
.vscode/
*.swp
EOF

    # C#
    cat > "${PROJECT_ROOT}/sdks/dotnet/.gitignore" << 'EOF'
# Build results
bin/
obj/
*.nupkg

# IDE
.vs/
.idea/
*.user
*.suo
EOF

    # Java
    cat > "${PROJECT_ROOT}/sdks/java/.gitignore" << 'EOF'
# Build results
target/
build/
*.jar

# IDE
.idea/
.gradle/
*.iml

# Maven
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
EOF
}

main() {
    log_info "Starting SDK generation..."
    log_info "OpenAPI spec: ${OPENAPI_SPEC}"
    log_info "Generator version: ${GENERATOR_VERSION}"

    check_docker

    cd "${PROJECT_ROOT}"

    # Verify spec exists
    if [ ! -f "${OPENAPI_SPEC}" ]; then
        log_error "OpenAPI spec not found at ${OPENAPI_SPEC}"
        exit 1
    fi

    # Generate all SDKs
    generate_sdk "typescript-axios" "sdks/typescript" "typescript-axios.config.json"
    generate_sdk "python" "sdks/python" "python.config.json"
    generate_sdk "csharp" "sdks/dotnet" "csharp.config.json"
    generate_sdk "java" "sdks/java" "java.config.json"

    # Add .gitignore files
    add_gitignores

    log_info "SDK generation complete!"
    log_info ""
    log_info "Generated SDKs:"
    log_info "  - TypeScript (Axios): sdks/typescript/"
    log_info "  - Python: sdks/python/"
    log_info "  - C# (.NET): sdks/dotnet/"
    log_info "  - Java: sdks/java/"
}

main "$@"
