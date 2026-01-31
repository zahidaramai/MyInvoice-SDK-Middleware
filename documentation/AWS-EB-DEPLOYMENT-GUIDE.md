# AWS Elastic Beanstalk Deployment Guide

Complete step-by-step guide for deploying HashLHDN MyInvois Gateway to AWS Elastic Beanstalk.

**Difficulty:** Beginner-friendly | **Time:** 45-60 minutes | **Cost:** ~$50-100/month

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [AWS Account Setup](#2-aws-account-setup)
3. [Install Required Tools](#3-install-required-tools)
4. [Create AWS Infrastructure](#4-create-aws-infrastructure)
5. [Build Deployment Package](#5-build-deployment-package)
6. [Deploy to Elastic Beanstalk](#6-deploy-to-elastic-beanstalk)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Verify Deployment](#8-verify-deployment)
9. [Post-Deployment Setup](#9-post-deployment-setup)
10. [Updating Your Deployment](#10-updating-your-deployment)
11. [Monitoring & Logs](#11-monitoring--logs)
12. [Troubleshooting](#12-troubleshooting)
13. [Cost Optimization](#13-cost-optimization)
14. [Security Checklist](#14-security-checklist)

---

## 1. Prerequisites

Before starting, ensure you have:

| Requirement | Description |
|-------------|-------------|
| **AWS Account** | Create at [aws.amazon.com](https://aws.amazon.com) |
| **P12 Certificate** | Digital signing certificate from LHDN |
| **MyInvois Credentials** | Client ID and Secret from LHDN Portal |
| **Node.js 22+** | Install from [nodejs.org](https://nodejs.org) |
| **pnpm 9+** | Install: `npm install -g pnpm` |
| **Git** | Install from [git-scm.com](https://git-scm.com) |

### Verify Prerequisites

```bash
# Check Node.js version (must be 22+)
node --version

# Check pnpm version (must be 9+)
pnpm --version

# Check Git
git --version
```

---

## 2. AWS Account Setup

### 2.1 Create AWS Account

1. Go to [aws.amazon.com](https://aws.amazon.com)
2. Click **Create an AWS Account**
3. Enter email and password
4. Choose **Personal** or **Business** account
5. Enter payment information (required, but free tier available)
6. Verify phone number
7. Select **Basic Support** (free)

### 2.2 Set Up IAM User (Recommended)

Never use root account for deployments:

1. Go to **IAM** → **Users** → **Create User**
2. Username: `hashlhdn-deploy`
3. Check **Provide user access to AWS Management Console**
4. Click **Next**
5. Select **Attach policies directly**
6. Search and select these policies:
   - `AWSElasticBeanstalkFullAccess`
   - `AmazonRDSFullAccess`
   - `AmazonElastiCacheFullAccess`
   - `AmazonS3FullAccess`
   - `CloudWatchFullAccess`
7. Click **Create User**
8. Save the console sign-in URL, username, and password

### 2.3 Create Access Keys

1. Go to **IAM** → **Users** → `hashlhdn-deploy`
2. Click **Security credentials** tab
3. Click **Create access key**
4. Select **Command Line Interface (CLI)**
5. Click **Create access key**
6. **SAVE** the Access Key ID and Secret Access Key (shown only once!)

---

## 3. Install Required Tools

### 3.1 Install AWS CLI

**macOS:**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Windows:**
Download from: https://awscli.amazonaws.com/AWSCLIV2.msi

**Linux:**
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

### 3.2 Configure AWS CLI

```bash
aws configure
```

Enter when prompted:
```
AWS Access Key ID: YOUR_ACCESS_KEY_ID
AWS Secret Access Key: YOUR_SECRET_ACCESS_KEY
Default region name: ap-southeast-2
Default output format: json
```

### 3.3 Verify AWS CLI

```bash
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/hashlhdn-deploy"
}
```

### 3.4 Install EB CLI (Optional)

```bash
pip install awsebcli --upgrade
```

Verify:
```bash
eb --version
```

---

## 4. Create AWS Infrastructure

### 4.1 Choose Your Region

We recommend **ap-southeast-2** (Sydney) for Malaysia deployments.

All resources must be in the **same region**.

### 4.2 Create RDS PostgreSQL Database

#### Step-by-Step:

1. Go to **RDS** → **Create database**
2. Choose **Standard create**
3. Engine: **PostgreSQL**
4. Version: **16.x** (latest)
5. Templates: **Free tier** (for testing) or **Production**
6. Settings:
   - DB instance identifier: `hashlhdn-db`
   - Master username: `postgres`
   - Master password: Generate and **SAVE IT**
7. Instance configuration:
   - **Free tier:** db.t3.micro
   - **Production:** db.t3.small or larger
8. Storage: 20 GB gp3
9. Connectivity:
   - VPC: Default VPC
   - Public access: **Yes** (for initial setup, disable later)
   - Security group: Create new → `hashlhdn-db-sg`
10. Database authentication: **Password authentication**
11. Additional configuration:
    - Initial database name: `hashlhdn`
12. Click **Create database**

**Wait 5-10 minutes** for database to become available.

#### Get Database Endpoint:

1. Go to **RDS** → **Databases** → `hashlhdn-db`
2. Copy the **Endpoint** (e.g., `hashlhdn-db.xxxxx.ap-southeast-2.rds.amazonaws.com`)

### 4.3 Create ElastiCache Redis

#### Step-by-Step:

1. Go to **ElastiCache** → **Redis OSS caches** → **Create**
2. Deployment option: **Design your own cache**
3. Creation method: **Cluster cache**
4. Cluster mode: **Disabled**
5. Cluster info:
   - Name: `hashlhdn-redis`
6. Location: **AWS Cloud**
7. Node type:
   - **Free tier:** cache.t3.micro
   - **Production:** cache.t3.small
8. Number of replicas: 0 (for cost savings) or 1 (for HA)
9. Subnet group: Create new or use default
10. Click **Create**

**Wait 5-10 minutes** for cluster to become available.

#### Get Redis Endpoint:

1. Go to **ElastiCache** → **Redis OSS caches** → `hashlhdn-redis`
2. Copy the **Primary endpoint** (remove the `:6379` port)

### 4.4 Create S3 Bucket for Certificate

```bash
# Create bucket (use unique name)
aws s3 mb s3://hashlhdn-certs-YOUR_ACCOUNT_ID --region ap-southeast-2

# Upload P12 certificate
aws s3 cp /path/to/your/certificate.p12 s3://hashlhdn-certs-YOUR_ACCOUNT_ID/signing.p12
```

### 4.5 Create Security Group Rules

Allow EB instances to access RDS and ElastiCache:

1. Go to **EC2** → **Security Groups**
2. Find `hashlhdn-db-sg` → **Inbound rules** → **Edit**
3. Add rule:
   - Type: PostgreSQL
   - Source: `0.0.0.0/0` (or EB security group for better security)
4. Save

Repeat for ElastiCache security group with Redis port (6379).

---

## 5. Build Deployment Package

### 5.1 Clone Repository

```bash
git clone https://github.com/shmoulana/duitlhdn.git
cd duitlhdn
```

### 5.2 Install Dependencies

```bash
pnpm install
```

### 5.3 Build Deployment Package

```bash
# Build with version label
./scripts/deploy-eb.sh v1.2.0

# Or auto-generate timestamp version
./scripts/deploy-eb.sh
```

This creates: `.deploy/hashlhdn-v1.2.0.zip`

### 5.4 What the Script Does

1. ✅ Builds all packages (`pnpm build`)
2. ✅ Bundles workspace dependencies
3. ✅ Converts pnpm workspace to npm-compatible format
4. ✅ Installs production dependencies
5. ✅ Generates Prisma client for Linux
6. ✅ Copies configuration files (.ebextensions, Procfile)
7. ✅ Creates optimized ZIP archive

---

## 6. Deploy to Elastic Beanstalk

### Method A: AWS CLI (Recommended)

#### Step 1: Upload to S3

```bash
# Create S3 bucket for deployments (one-time)
aws s3 mb s3://elasticbeanstalk-ap-southeast-2-YOUR_ACCOUNT_ID

# Upload deployment package
aws s3 cp .deploy/hashlhdn-v1.2.0.zip \
  s3://elasticbeanstalk-ap-southeast-2-YOUR_ACCOUNT_ID/hashlhdn-middleware/v1.2.0.zip
```

#### Step 2: Create Application

```bash
aws elasticbeanstalk create-application \
  --application-name hashlhdn-middleware \
  --description "HashLHDN MyInvois Gateway" \
  --region ap-southeast-2
```

#### Step 3: Create Application Version

```bash
aws elasticbeanstalk create-application-version \
  --application-name hashlhdn-middleware \
  --version-label "v1.2.0" \
  --source-bundle S3Bucket=elasticbeanstalk-ap-southeast-2-YOUR_ACCOUNT_ID,S3Key=hashlhdn-middleware/v1.2.0.zip \
  --region ap-southeast-2
```

#### Step 4: Create Environment

```bash
aws elasticbeanstalk create-environment \
  --application-name hashlhdn-middleware \
  --environment-name hashlhdn-prod \
  --solution-stack-name "64bit Amazon Linux 2023 v6.4.1 running Node.js 22" \
  --option-settings file://eb-options.json \
  --region ap-southeast-2
```

Create `eb-options.json`:
```json
[
  {
    "Namespace": "aws:autoscaling:launchconfiguration",
    "OptionName": "InstanceType",
    "Value": "t3.small"
  },
  {
    "Namespace": "aws:elasticbeanstalk:environment",
    "OptionName": "EnvironmentType",
    "Value": "SingleInstance"
  }
]
```

### Method B: EB CLI

```bash
cd .deploy/hashlhdn-v1.2.0

# Initialize EB (first time)
eb init -p "Node.js 22" hashlhdn-middleware --region ap-southeast-2

# Create environment
eb create hashlhdn-prod --single --instance_type t3.small

# Or deploy to existing environment
eb deploy hashlhdn-prod
```

### Method C: AWS Console (Visual)

1. Go to **Elastic Beanstalk** → **Create Application**
2. Application name: `hashlhdn-middleware`
3. Platform: **Node.js 22**
4. Application code: **Upload your code**
5. Upload: `.deploy/hashlhdn-v1.2.0.zip`
6. Click **Configure more options**
7. Configure as needed (see next section)
8. Click **Create application**

---

## 7. Configure Environment Variables

### Via AWS Console

1. Go to **Elastic Beanstalk** → **hashlhdn-prod**
2. Click **Configuration** → **Software** → **Edit**
3. Add environment properties:

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `8080` | Server port (EB default) |
| `DATABASE_URL` | `postgresql://postgres:PASSWORD@hashlhdn-db.xxxxx.ap-southeast-2.rds.amazonaws.com:5432/hashlhdn` | RDS connection |
| `REDIS_URL` | `redis://hashlhdn-redis.xxxxx.cache.amazonaws.com:6379` | ElastiCache connection |
| `JWT_SECRET` | Generate with `openssl rand -hex 32` | Access token secret |
| `JWT_REFRESH_SECRET` | Generate with `openssl rand -hex 32` | Refresh token secret |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token expiry |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token expiry |
| `SIGNING_ENABLED` | `true` | Enable document signing |
| `SIGNING_DEFAULT_VERSION` | `1.1` | Default document version |
| `SIGNING_PKCS12_PATH` | `s3://hashlhdn-certs-YOUR_ACCOUNT_ID/signing.p12` | S3 path to certificate |
| `SIGNING_PKCS12_PASSPHRASE` | `your-p12-password` | Certificate passphrase |
| `MYINVOIS_ENV` | `PROD` | MyInvois environment |
| `LOG_LEVEL` | `info` | Logging level |

4. Click **Apply**

### Via AWS CLI

```bash
aws elasticbeanstalk update-environment \
  --application-name hashlhdn-middleware \
  --environment-name hashlhdn-prod \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_ENV,Value=production" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value=postgresql://..." \
  --region ap-southeast-2
```

### Generate Secure Secrets

```bash
# Generate JWT secrets (run these locally)
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CACHE_HASH_SALT=$(openssl rand -hex 16)"
```

---

## 8. Verify Deployment

### 8.1 Check Environment Status

```bash
aws elasticbeanstalk describe-environments \
  --environment-names hashlhdn-prod \
  --query 'Environments[0].{Status:Status,Health:Health,URL:CNAME}' \
  --region ap-southeast-2
```

Expected output:
```json
{
    "Status": "Ready",
    "Health": "Green",
    "URL": "hashlhdn-prod.eba-xxxxx.ap-southeast-2.elasticbeanstalk.com"
}
```

### 8.2 Test Endpoints

```bash
# Get environment URL
EB_URL="http://hashlhdn-prod.eba-xxxxx.ap-southeast-2.elasticbeanstalk.com"

# Health check
curl $EB_URL/health
# Expected: {"status":"ok"}

# Version check
curl $EB_URL/version
# Expected: {"version":"1.2.0"}

# Login test
curl -X POST $EB_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hashlhdn.com","password":"admin123"}'
```

---

## 9. Post-Deployment Setup

### 9.1 Run Database Seed (First Time Only)

The seeder creates initial admin user and roles.

**Option 1: SSH into EB instance**
```bash
# Get instance ID
aws elasticbeanstalk describe-environment-resources \
  --environment-name hashlhdn-prod \
  --query 'EnvironmentResources.Instances[0].Id' \
  --region ap-southeast-2

# SSH via EC2 Instance Connect or Session Manager
aws ssm start-session --target i-xxxxxxxxxx

# Run seeder
cd /var/app/current
node prisma/seed.cjs
```

**Option 2: Use EB CLI**
```bash
eb ssh hashlhdn-prod
cd /var/app/current
node prisma/seed.cjs
```

### 9.2 Create Company with MyInvois Credentials

```bash
# Login to get token
TOKEN=$(curl -s -X POST $EB_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hashlhdn.com","password":"admin123"}' \
  | jq -r '.accessToken')

# Create company
curl -X POST $EB_URL/api/v1/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Your Company Sdn Bhd",
    "tin": "C12345678901",
    "idValue": "201901234567",
    "idType": "BRN"
  }'

# Set MyInvois credentials
curl -X PUT $EB_URL/api/v1/companies/COMPANY_ID/credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "myinvoisClientId": "YOUR_CLIENT_ID",
    "myinvoisClientSecret": "YOUR_CLIENT_SECRET"
  }'
```

### 9.3 Set Up CloudFront (Optional)

For HTTPS and better performance:

1. Go to **CloudFront** → **Create Distribution**
2. Origin domain: Your EB URL
3. Protocol: **HTTPS only**
4. Click **Create Distribution**
5. Use the CloudFront URL for your API

---

## 10. Updating Your Deployment

### Standard Update Workflow

```bash
# 1. Pull latest code
git pull origin main

# 2. Build new deployment package
./scripts/deploy-eb.sh v1.2.1

# 3. Upload to S3
aws s3 cp .deploy/hashlhdn-v1.2.1.zip \
  s3://elasticbeanstalk-ap-southeast-2-YOUR_ACCOUNT_ID/hashlhdn-middleware/v1.2.1.zip

# 4. Create new version
aws elasticbeanstalk create-application-version \
  --application-name hashlhdn-middleware \
  --version-label "v1.2.1" \
  --source-bundle S3Bucket=elasticbeanstalk-ap-southeast-2-YOUR_ACCOUNT_ID,S3Key=hashlhdn-middleware/v1.2.1.zip \
  --region ap-southeast-2

# 5. Deploy new version
aws elasticbeanstalk update-environment \
  --application-name hashlhdn-middleware \
  --environment-name hashlhdn-prod \
  --version-label "v1.2.1" \
  --region ap-southeast-2

# 6. Monitor deployment
aws elasticbeanstalk describe-environments \
  --environment-names hashlhdn-prod \
  --query 'Environments[0].Status' \
  --region ap-southeast-2
```

### Rollback to Previous Version

```bash
# List available versions
aws elasticbeanstalk describe-application-versions \
  --application-name hashlhdn-middleware \
  --query 'ApplicationVersions[*].VersionLabel' \
  --region ap-southeast-2

# Rollback
aws elasticbeanstalk update-environment \
  --application-name hashlhdn-middleware \
  --environment-name hashlhdn-prod \
  --version-label "v1.2.0" \
  --region ap-southeast-2
```

---

## 11. Monitoring & Logs

### View Logs

```bash
# Request logs
aws elasticbeanstalk request-environment-info \
  --environment-name hashlhdn-prod \
  --info-type tail \
  --region ap-southeast-2

# Wait a few seconds, then retrieve
aws elasticbeanstalk retrieve-environment-info \
  --environment-name hashlhdn-prod \
  --info-type tail \
  --region ap-southeast-2
```

### Via EB CLI

```bash
eb logs hashlhdn-prod
```

### CloudWatch Logs

Logs are automatically streamed to CloudWatch:
- `/aws/elasticbeanstalk/hashlhdn-prod/var/log/web.stdout.log`

### Health Dashboard

1. Go to **Elastic Beanstalk** → **hashlhdn-prod**
2. Click **Health** in left menu
3. View overall health, recent events, and instance status

---

## 12. Troubleshooting

### Common Issues

#### 502 Bad Gateway

**Cause:** Application failed to start

**Solution:**
```bash
# Check logs
eb logs hashlhdn-prod | grep -i error

# Common fixes:
# - Missing environment variables
# - Database connection failed
# - Certificate not found
```

#### Database Connection Failed

**Cause:** Security group or credentials issue

**Solution:**
1. Check RDS security group allows EB security group
2. Verify DATABASE_URL is correct
3. Check RDS instance is running

```bash
# Test from EB instance
eb ssh hashlhdn-prod
psql -h YOUR_RDS_ENDPOINT -U postgres -d hashlhdn
```

#### Certificate Not Found

**Cause:** S3 path or permissions issue

**Solution:**
1. Verify S3 path is correct
2. Check EB instance role has S3 read permissions

```bash
# Check if certificate exists
aws s3 ls s3://hashlhdn-certs-YOUR_ACCOUNT_ID/signing.p12
```

#### Deployment Timeout

**Cause:** Package too large or instance underpowered

**Solution:**
1. Use larger instance type (t3.medium)
2. Check package size (should be < 500MB)

### Debug Commands

```bash
# Environment health
aws elasticbeanstalk describe-environment-health \
  --environment-name hashlhdn-prod \
  --attribute-names All \
  --region ap-southeast-2

# Recent events
aws elasticbeanstalk describe-events \
  --environment-name hashlhdn-prod \
  --max-records 20 \
  --region ap-southeast-2

# SSH into instance
eb ssh hashlhdn-prod

# Inside instance:
cd /var/app/current
cat /var/log/web.stdout.log | tail -100
```

---

## 13. Cost Optimization

### Estimated Monthly Costs

| Resource | Free Tier | Production |
|----------|-----------|------------|
| EB (t3.small) | $0 (first year) | ~$15/month |
| RDS (db.t3.micro) | $0 (first year) | ~$15/month |
| ElastiCache (cache.t3.micro) | $0 (first year) | ~$12/month |
| Data Transfer | 15 GB free | ~$5/month |
| **Total** | **$0** | **~$50/month** |

### Cost Saving Tips

1. **Use Free Tier** for first 12 months
2. **Single Instance** instead of Load Balanced
3. **Reserved Instances** for long-term (up to 72% savings)
4. **Stop RDS** when not needed (dev environments)
5. **Use Spot Instances** for non-production

---

## 14. Security Checklist

### Before Going Live

- [ ] Change all default passwords
- [ ] Generate strong JWT secrets (64+ hex chars)
- [ ] Enable HTTPS via CloudFront or ALB
- [ ] Restrict security groups to minimum required
- [ ] Enable RDS encryption at rest
- [ ] Enable RDS automated backups
- [ ] Set up CloudWatch alarms
- [ ] Review IAM permissions (least privilege)
- [ ] Disable RDS public access
- [ ] Store secrets in AWS Secrets Manager (optional)

### Regular Maintenance

- [ ] Update dependencies monthly
- [ ] Review CloudWatch logs weekly
- [ ] Test backups quarterly
- [ ] Rotate secrets annually
- [ ] Apply security patches promptly

---

## Quick Reference

### Important URLs

| Resource | URL |
|----------|-----|
| AWS Console | https://console.aws.amazon.com |
| EB Console | https://ap-southeast-2.console.aws.amazon.com/elasticbeanstalk |
| RDS Console | https://ap-southeast-2.console.aws.amazon.com/rds |
| CloudWatch | https://ap-southeast-2.console.aws.amazon.com/cloudwatch |

### Key Commands

```bash
# Build package
./scripts/deploy-eb.sh v1.x.x

# Deploy
aws s3 cp .deploy/hashlhdn-v1.x.x.zip s3://BUCKET/hashlhdn-middleware/v1.x.x.zip
aws elasticbeanstalk create-application-version ...
aws elasticbeanstalk update-environment ...

# Check status
aws elasticbeanstalk describe-environments --environment-names hashlhdn-prod

# View logs
eb logs hashlhdn-prod

# Rollback
aws elasticbeanstalk update-environment --version-label "v1.x.x"
```

### Environment Variables Template

```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://user:pass@host:5432/hashlhdn
REDIS_URL=redis://host:6379
JWT_SECRET=<64-char-hex>
JWT_REFRESH_SECRET=<64-char-hex>
SIGNING_ENABLED=true
SIGNING_DEFAULT_VERSION=1.1
SIGNING_PKCS12_PATH=s3://bucket/signing.p12
SIGNING_PKCS12_PASSPHRASE=<password>
MYINVOIS_ENV=PROD
```

---

## Support

- **GitHub Issues:** https://github.com/shmoulana/duitlhdn/issues
- **Documentation:** See `/documentation` folder
- **API Reference:** Import `HashLHDN-API-v1.1.2.postman_collection.json` to Postman

---

**Last Updated:** January 21, 2026 | **Version:** 1.2.0
