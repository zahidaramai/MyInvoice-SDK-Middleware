# HashLHDN MyInvois Gateway - Deployment Guide

This guide covers deploying the HashLHDN MyInvois Gateway to AWS.

---

## Prerequisites

Before deployment, ensure you have:

1. **AWS Account** with appropriate permissions
2. **SSH Access** to the target EC2 instance
3. **Domain Name** (optional, for SSL)
4. **P12 Certificate** from LHDN for document signing
5. **MyInvois Credentials** for each company

---

## Quick Start (Docker Compose)

The fastest way to deploy is using Docker Compose on an EC2 instance.

### Step 1: Launch EC2 Instance

Recommended specifications:
- **Instance Type:** t3.small (2 vCPU, 2 GB RAM) minimum
- **OS:** Amazon Linux 2023 or Ubuntu 22.04
- **Storage:** 20 GB gp3 SSD
- **Security Group Ports:**
  - 22 (SSH)
  - 80 (HTTP)
  - 443 (HTTPS)
  - 3000 (API - optional, if not using nginx)

### Step 2: Install Docker

```bash
# Amazon Linux 2023
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Re-login for group changes
exit
# SSH back in
```

### Step 3: Clone Repository

```bash
git clone https://github.com/shmoulana/duitlhdn.git
cd duitlhdn
```

### Step 4: Configure Environment

```bash
# Copy template
cp .env.production.template .env

# Edit configuration
nano .env
```

**Required settings to configure:**

```bash
# Generate secure JWT secrets
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

# Set strong database password
POSTGRES_PASSWORD=your_secure_password_here

# Set P12 certificate passphrase
SIGNING_PKCS12_PASSPHRASE=your_p12_passphrase
```

### Step 5: Upload P12 Certificate

```bash
# Create certs directory
mkdir -p docker/certs

# Upload certificate (from local machine)
scp /path/to/your/certificate.p12 user@ec2-ip:~/duitlhdn/docker/certs/signing.p12

# Secure permissions
chmod 600 docker/certs/signing.p12
```

### Step 6: Deploy

```bash
cd docker

# Build and start services
docker-compose -f docker-compose.prod.yml up -d --build

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f gateway
```

### Step 7: Run Database Migrations

```bash
# Run Prisma migrations
docker-compose -f docker-compose.prod.yml exec gateway npx prisma migrate deploy --schema=/app/packages/storage/prisma/schema.prisma
```

### Step 8: Create Initial Admin User

```bash
# Access the container
docker-compose -f docker-compose.prod.yml exec gateway sh

# Run seed script (if available) or use Prisma Studio
npx prisma studio --schema=/app/packages/storage/prisma/schema.prisma
```

### Step 9: Verify Deployment

```bash
# Health check
curl http://localhost:3000/healthz

# Version check
curl http://localhost:3000/version

# Expected response
# {"status":"healthy"}
# {"version":"0.3.0","environment":"production"}
```

---

## AWS Managed Services (Production Recommended)

For production workloads, use AWS managed services:

### Architecture

```
                         ┌─────────────────┐
                         │   Route 53      │
                         │   (DNS)         │
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │   CloudFront    │
                         │   (CDN + SSL)   │
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │   ALB           │
                         │   (Load Balancer)│
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼─────────┐ ┌──────▼──────┐  ┌────────▼────────┐
    │   ECS Fargate     │ │  RDS        │  │   ElastiCache   │
    │   (Gateway)       │ │ (PostgreSQL)│  │   (Redis)       │
    └───────────────────┘ └─────────────┘  └─────────────────┘
```

### RDS PostgreSQL Setup

1. Create RDS instance:
   - Engine: PostgreSQL 16
   - Instance: db.t3.micro (dev) or db.t3.small (prod)
   - Storage: 20 GB gp3
   - Multi-AZ: Enable for production

2. Update `.env`:
   ```bash
   DATABASE_URL=postgresql://hashlhdn:password@your-rds-endpoint.region.rds.amazonaws.com:5432/hashlhdn
   ```

### ElastiCache Redis Setup

1. Create ElastiCache cluster:
   - Engine: Redis 7
   - Node type: cache.t3.micro (dev) or cache.t3.small (prod)
   - Replicas: 1 for production

2. Update `.env`:
   ```bash
   REDIS_URL=redis://your-elasticache-endpoint.region.cache.amazonaws.com:6379
   ```

---

## SSL/TLS Configuration

### Option 1: AWS Certificate Manager (Recommended)

1. Request certificate in ACM for your domain
2. Attach to ALB or CloudFront
3. ALB handles SSL termination

### Option 2: Let's Encrypt with Nginx

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

### Nginx Configuration

Create `docker/nginx/nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream gateway {
        server gateway:3000;
    }

    server {
        listen 80;
        server_name api.yourdomain.com;

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl http2;
        server_name api.yourdomain.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;

        location / {
            proxy_pass http://gateway;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

Deploy with nginx:
```bash
docker-compose -f docker-compose.prod.yml --profile with-nginx up -d
```

---

## Database Migrations

### Running Migrations

```bash
# Connect to gateway container
docker-compose -f docker-compose.prod.yml exec gateway sh

# Run pending migrations
npx prisma migrate deploy --schema=/app/packages/storage/prisma/schema.prisma
```

### Creating Admin User

After initial deployment, create the first admin user:

```bash
# Option 1: Use Prisma Studio
npx prisma studio --schema=/app/packages/storage/prisma/schema.prisma

# Option 2: Direct SQL
docker-compose -f docker-compose.prod.yml exec postgres psql -U hashlhdn -d hashlhdn

-- Create admin role
INSERT INTO "Role" (id, name, permissions, description)
VALUES (
  'clxxx...',
  'Admin',
  '["submit:invoice","read:documents","cancel:documents","manage:users","manage:roles","manage:companies"]'::jsonb,
  'Full system administrator'
);

-- Create admin user (password: admin123 - CHANGE THIS!)
INSERT INTO "User" (id, email, "passwordHash", name, "roleId", "isActive")
VALUES (
  'clyyy...',
  'admin@hashmato.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y5Z6...',  -- bcrypt hash
  'Admin',
  'clxxx...',
  true
);
```

---

## Monitoring & Logs

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Gateway only
docker-compose -f docker-compose.prod.yml logs -f gateway

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 gateway
```

### Health Checks

```bash
# Gateway health
curl http://localhost:3000/healthz

# Ready check (database connected)
curl http://localhost:3000/readyz

# Metrics (Prometheus format)
curl http://localhost:3000/metrics
```

### Prometheus Metrics

The gateway exposes Prometheus metrics at `/metrics`:

- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request latency
- `myinvois_submissions_total` - Document submissions
- `myinvois_rate_limit_hits_total` - Rate limit events

---

## Backup & Recovery

### Database Backup

```bash
# Manual backup
docker-compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U hashlhdn hashlhdn > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20240115.sql | docker-compose -f docker-compose.prod.yml exec -T postgres \
  psql -U hashlhdn hashlhdn
```

### Automated Backups with AWS RDS

1. Enable automated backups in RDS console
2. Set retention period (7-35 days)
3. Configure backup window during low-traffic hours

---

## Updating the Application

```bash
cd ~/duitlhdn

# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose -f docker/docker-compose.prod.yml up -d --build

# Run any new migrations
docker-compose -f docker/docker-compose.prod.yml exec gateway \
  npx prisma migrate deploy --schema=/app/packages/storage/prisma/schema.prisma

# Verify health
curl http://localhost:3000/healthz
```

---

## Troubleshooting

### Gateway Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs gateway

# Common issues:
# - Database not ready: Wait for postgres healthcheck
# - Missing env vars: Verify .env file
# - P12 certificate: Check path and permissions
```

### Database Connection Failed

```bash
# Test database connectivity
docker-compose -f docker-compose.prod.yml exec postgres \
  pg_isready -U hashlhdn

# Check DATABASE_URL format
# Should be: postgresql://user:pass@host:5432/dbname
```

### Redis Connection Failed

```bash
# Test Redis connectivity
docker-compose -f docker-compose.prod.yml exec redis redis-cli ping

# Expected: PONG
```

### Certificate Issues

```bash
# Verify P12 certificate
openssl pkcs12 -info -in docker/certs/signing.p12 -nodes

# Check file permissions
ls -la docker/certs/signing.p12
# Should be: -rw------- (600)
```

---

## AWS Elastic Beanstalk Deployment

For a fully managed deployment experience, use AWS Elastic Beanstalk with Node.js 22.

### Architecture

```
                         ┌─────────────────┐
                         │   Route 53      │
                         │   (DNS)         │
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │   ALB           │
                         │   (via EB)      │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼─────────┐ ┌──────▼──────┐  ┌────────▼────────┐
    │  Elastic Beanstalk│ │  RDS        │  │   ElastiCache   │
    │  (Node.js 22)     │ │ (PostgreSQL)│  │   (Redis)       │
    └───────────────────┘ └─────────────┘  └─────────────────┘
```

### Prerequisites

1. **AWS CLI** installed and configured
2. **EB CLI** (optional, for CLI deployment): `pip install awsebcli`
3. **pnpm** v9+ installed
4. **AWS Resources** created:
   - RDS PostgreSQL instance
   - ElastiCache Redis cluster
   - S3 bucket for P12 certificate
   - IAM role for EB instances with S3 read access

### Step 1: Create Deployment Package

```bash
# From project root
./scripts/deploy-eb.sh

# Or with custom version label
./scripts/deploy-eb.sh v1.0.0
```

This creates a ZIP file at `.deploy/hashlhdn-<version>.zip` with:
- Bundled workspace dependencies (via pnpm deploy)
- Procfile for EB
- .ebextensions configuration
- Prisma schema for migrations

### Step 2: Create AWS Infrastructure

#### RDS PostgreSQL

1. Create RDS instance:
   - **Engine:** PostgreSQL 16
   - **Instance:** db.t3.small (or larger for production)
   - **Storage:** 20+ GB gp3
   - **VPC:** Same VPC as EB environment
   - **Security Group:** Allow inbound from EB security group

2. Create database:
   ```sql
   CREATE DATABASE hashlhdn;
   ```

#### ElastiCache Redis

1. Create Redis cluster:
   - **Engine:** Redis 7.x
   - **Node type:** cache.t3.small
   - **VPC:** Same VPC as EB environment
   - **Security Group:** Allow inbound from EB security group

#### S3 Bucket for P12 Certificate

1. Create S3 bucket in ap-southeast-1
2. Upload P12 certificate:
   ```bash
   aws s3 cp /path/to/signing.p12 s3://YOUR_BUCKET/hashlhdn/signing.p12
   ```
3. Create IAM policy for EB instance role:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject"],
       "Resource": "arn:aws:s3:::YOUR_BUCKET/hashlhdn/*"
     }]
   }
   ```
4. Attach policy to `aws-elasticbeanstalk-ec2-role`

### Step 3: Deploy to Elastic Beanstalk

#### Option A: AWS Console (Recommended for first deployment)

1. Go to **Elastic Beanstalk** console
2. Click **Create Application**
3. Application name: `hashlhdn`
4. Platform: **Node.js 22**
5. Application code: **Upload your code** → Upload `.deploy/hashlhdn-<version>.zip`
6. Click **Configure more options**:
   - **Software**: Add environment variables (see below)
   - **Capacity**: Single instance or Load balanced
   - **Network**: Select VPC with RDS/ElastiCache access
7. Click **Create application**

#### Option B: EB CLI

```bash
# Navigate to deployment directory
cd .deploy/hashlhdn-<version>

# Initialize EB (first time only)
eb init -p node.js-22 hashlhdn --region ap-southeast-1

# Create environment
eb create hashlhdn-prod --single --instance_type t3.small

# Or deploy to existing environment
eb deploy hashlhdn-prod
```

### Step 4: Configure Environment Variables

In EB Console → Environment → Configuration → Software → Environment properties:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port (EB uses 8080) | `8080` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/hashlhdn` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `JWT_SECRET` | Access token secret (64 hex) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Refresh token secret (64 hex) | `openssl rand -hex 32` |
| `CACHE_HASH_SALT` | TIN cache salt (32 hex) | `openssl rand -hex 16` |
| `SIGNING_ENABLED` | Enable document signing | `true` |
| `SIGNING_DEFAULT_VERSION` | Default doc version | `1.1` |
| `SIGNING_PKCS12_PATH` | P12 certificate path | `/var/app/staging/certs/signing.p12` |
| `SIGNING_PKCS12_PASSPHRASE` | P12 passphrase | `your-passphrase` |

### Step 5: Run Migrations and Seed

After deployment:

```bash
# SSH into EB instance
eb ssh hashlhdn-prod

# Navigate to app directory
cd /var/app/current

# Run migrations
npx prisma migrate deploy

# Seed admin user
node scripts/seed-admin.js
```

Or use EB console → Logs to verify migrations ran automatically via `.ebextensions/02-migrations.config`.

### Step 6: Verify Deployment

```bash
# Get environment URL
eb status

# Health check
curl https://your-eb-url.elasticbeanstalk.com/healthz

# Expected response
{"status":"healthy"}
```

### Updating Deployments

1. Create new deployment package:
   ```bash
   ./scripts/deploy-eb.sh v1.0.1
   ```

2. Deploy via console or CLI:
   ```bash
   eb deploy hashlhdn-prod
   ```

3. Migrations run automatically via `.ebextensions`

### Rollback

```bash
# List recent versions
eb appversion

# Rollback to previous version
eb deploy hashlhdn-prod --version <version-label>
```

### Troubleshooting EB Deployments

```bash
# View logs
eb logs

# SSH into instance
eb ssh

# Check app logs
tail -f /var/log/web.stdout.log

# Check EB logs
cat /var/log/eb-engine.log
```

Common issues:
- **502 Bad Gateway**: App failed to start. Check `/var/log/web.stdout.log`
- **Migrations failed**: Check `DATABASE_URL` and security groups
- **Certificate not found**: Verify S3 bucket and IAM permissions

---

## Security Checklist

- [ ] Change default database password
- [ ] Generate strong JWT secrets (64+ hex chars)
- [ ] Enable SSL/TLS for all endpoints
- [ ] Configure firewall (security groups)
- [ ] Set up VPC with private subnets for RDS/ElastiCache
- [ ] Enable RDS encryption at rest
- [ ] Configure IAM roles (least privilege)
- [ ] Set up CloudWatch alarms for errors
- [ ] Enable AWS CloudTrail for audit logging
- [ ] Review CORS settings for production domains

---

## Support

For deployment assistance:
- GitHub Issues: https://github.com/shmoulana/duitlhdn/issues
- Documentation: See `docs/` folder
