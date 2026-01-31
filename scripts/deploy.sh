#!/bin/bash
# HashLHDN MyInvois Gateway - Deployment Script
# Usage: ./scripts/deploy.sh [setup|deploy|migrate|logs|status]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE=".env"
CERTS_DIR="docker/certs"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_requirements() {
    log_info "Checking requirements..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found. Copy .env.production.template to .env and configure it."
        exit 1
    fi

    log_info "Requirements check passed!"
}

setup() {
    log_info "Setting up HashLHDN Gateway..."

    check_requirements

    # Create directories
    mkdir -p "$CERTS_DIR"
    mkdir -p "docker/nginx/ssl"

    # Generate JWT secrets if not set
    if ! grep -q "JWT_SECRET=" "$ENV_FILE" || grep -q "JWT_SECRET=GENERATE" "$ENV_FILE"; then
        log_info "Generating JWT secrets..."
        JWT_SECRET=$(openssl rand -hex 32)
        JWT_REFRESH_SECRET=$(openssl rand -hex 32)

        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
            sed -i '' "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" "$ENV_FILE"
        else
            sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
            sed -i "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" "$ENV_FILE"
        fi

        log_info "JWT secrets generated and saved to .env"
    fi

    # Check for P12 certificate
    if [ ! -f "$CERTS_DIR/signing.p12" ]; then
        log_warn "P12 certificate not found at $CERTS_DIR/signing.p12"
        log_warn "Please upload your LHDN certificate before deploying."
    else
        chmod 600 "$CERTS_DIR/signing.p12"
        log_info "P12 certificate found and permissions set."
    fi

    log_info "Setup complete! Run './scripts/deploy.sh deploy' to start services."
}

deploy() {
    log_info "Deploying HashLHDN Gateway..."

    check_requirements

    # Build and start services
    log_info "Building Docker images..."
    docker-compose -f "$COMPOSE_FILE" build

    log_info "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d

    # Wait for services to be healthy
    log_info "Waiting for services to be ready..."
    sleep 10

    # Check health
    if curl -s http://localhost:3000/healthz | grep -q "healthy"; then
        log_info "Gateway is healthy!"
    else
        log_warn "Gateway health check failed. Check logs with: ./scripts/deploy.sh logs"
    fi

    log_info "Deployment complete!"
    log_info "Gateway running at: http://localhost:3000"
    log_info ""
    log_info "Next steps:"
    log_info "  1. Run migrations: ./scripts/deploy.sh migrate"
    log_info "  2. Create admin user via Prisma Studio or direct SQL"
    log_info "  3. Configure SSL/domain (optional)"
}

migrate() {
    log_info "Running database migrations..."

    docker-compose -f "$COMPOSE_FILE" exec -T gateway \
        npx prisma migrate deploy --schema=/app/packages/storage/prisma/schema.prisma

    log_info "Migrations complete!"
}

logs() {
    local service="${1:-gateway}"
    log_info "Showing logs for $service..."
    docker-compose -f "$COMPOSE_FILE" logs -f "$service"
}

status() {
    log_info "Service status:"
    docker-compose -f "$COMPOSE_FILE" ps

    echo ""
    log_info "Health checks:"

    # Gateway health
    if curl -s http://localhost:3000/healthz 2>/dev/null | grep -q "healthy"; then
        echo -e "  Gateway: ${GREEN}✓ Healthy${NC}"
    else
        echo -e "  Gateway: ${RED}✗ Unhealthy${NC}"
    fi

    # Database health
    if docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U hashlhdn &>/dev/null; then
        echo -e "  PostgreSQL: ${GREEN}✓ Ready${NC}"
    else
        echo -e "  PostgreSQL: ${RED}✗ Not ready${NC}"
    fi

    # Redis health
    if docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
        echo -e "  Redis: ${GREEN}✓ Ready${NC}"
    else
        echo -e "  Redis: ${RED}✗ Not ready${NC}"
    fi
}

stop() {
    log_info "Stopping services..."
    docker-compose -f "$COMPOSE_FILE" down
    log_info "Services stopped."
}

restart() {
    log_info "Restarting services..."
    docker-compose -f "$COMPOSE_FILE" restart
    log_info "Services restarted."
}

update() {
    log_info "Updating HashLHDN Gateway..."

    # Pull latest code
    log_info "Pulling latest changes..."
    git pull origin main

    # Rebuild and restart
    log_info "Rebuilding services..."
    docker-compose -f "$COMPOSE_FILE" up -d --build

    # Run migrations
    log_info "Running migrations..."
    sleep 10
    migrate

    log_info "Update complete!"
}

backup_db() {
    local backup_file="backup_$(date +%Y%m%d_%H%M%S).sql"
    log_info "Creating database backup: $backup_file"

    docker-compose -f "$COMPOSE_FILE" exec -T postgres \
        pg_dump -U hashlhdn hashlhdn > "$backup_file"

    log_info "Backup saved to: $backup_file"
}

# Main command handler
case "$1" in
    setup)
        setup
        ;;
    deploy)
        deploy
        ;;
    migrate)
        migrate
        ;;
    logs)
        logs "$2"
        ;;
    status)
        status
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    update)
        update
        ;;
    backup)
        backup_db
        ;;
    *)
        echo "HashLHDN MyInvois Gateway - Deployment Script"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  setup    - Initial setup (create directories, generate secrets)"
        echo "  deploy   - Build and start all services"
        echo "  migrate  - Run database migrations"
        echo "  logs     - View service logs (default: gateway)"
        echo "  status   - Show service status and health checks"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  update   - Pull latest code and redeploy"
        echo "  backup   - Create database backup"
        echo ""
        echo "Examples:"
        echo "  $0 setup"
        echo "  $0 deploy"
        echo "  $0 logs postgres"
        exit 1
        ;;
esac
