#!/bin/bash
# Generate test certificates for @myinvois/signing package tests
# DO NOT use these certificates in production!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Generating test certificates..."

# 1. Generate valid RSA certificate and key
echo "1. Generating valid RSA certificate..."
openssl genrsa -out valid-key.pem 2048 2>/dev/null
openssl req -new -key valid-key.pem -out valid-csr.pem \
  -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=Test Organization/OU=Test Unit/CN=Test Certificate" \
  2>/dev/null
openssl x509 -req -days 365 -in valid-csr.pem -signkey valid-key.pem -out valid-cert.pem 2>/dev/null
rm valid-csr.pem

# 2. Generate expired certificate
echo "2. Generating expired certificate..."
openssl genrsa -out expired-key.pem 2048 2>/dev/null
openssl req -new -key expired-key.pem -out expired-csr.pem \
  -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=Expired Org/CN=Expired Certificate" \
  2>/dev/null
# Create certificate that expired yesterday
openssl x509 -req -days 1 -in expired-csr.pem -signkey expired-key.pem -out expired-cert.pem \
  -set_serial 1 2>/dev/null
# Backdate the certificate to make it expired
faketime -f '-2d' openssl x509 -req -days 1 -in expired-csr.pem -signkey expired-key.pem \
  -out expired-cert.pem -set_serial 1 2>/dev/null || {
    # If faketime is not available, use a workaround
    openssl req -new -key expired-key.pem -out expired-csr.pem \
      -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=Expired Org/CN=Expired Certificate" \
      2>/dev/null
    openssl x509 -req -days -1 -in expired-csr.pem -signkey expired-key.pem \
      -out expired-cert.pem 2>/dev/null || true
  }
rm -f expired-csr.pem

# 3. Generate future-dated certificate (not yet valid)
echo "3. Generating future-dated certificate..."
openssl genrsa -out future-key.pem 2048 2>/dev/null
openssl req -new -key future-key.pem -out future-csr.pem \
  -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=Future Org/CN=Future Certificate" \
  2>/dev/null
# Create a certificate valid starting tomorrow
openssl ca -selfsign -keyfile future-key.pem -in future-csr.pem -out future-cert.pem \
  -startdate $(date -v+1d +%Y%m%d000000Z 2>/dev/null || date -d '+1 day' +%Y%m%d000000Z) \
  -days 365 2>/dev/null || {
    # Fallback: just create a regular cert (we'll simulate future validation in tests)
    openssl x509 -req -days 365 -in future-csr.pem -signkey future-key.pem \
      -out future-cert.pem 2>/dev/null
  }
rm -f future-csr.pem

# 4. Generate encrypted private key
echo "4. Generating encrypted private key..."
openssl genrsa -aes256 -passout pass:testpassword -out encrypted-key.pem 2048 2>/dev/null
openssl req -new -key encrypted-key.pem -passin pass:testpassword -out encrypted-csr.pem \
  -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=Encrypted Org/CN=Encrypted Key Certificate" \
  2>/dev/null
openssl x509 -req -days 365 -in encrypted-csr.pem -signkey encrypted-key.pem \
  -passin pass:testpassword -out encrypted-cert.pem 2>/dev/null
rm encrypted-csr.pem

# 5. Generate mismatched key (different key that doesn't match valid-cert.pem)
echo "5. Generating mismatched key..."
openssl genrsa -out mismatched-key.pem 2048 2>/dev/null

# 6. Generate EC certificate
echo "6. Generating EC certificate..."
openssl ecparam -genkey -name prime256v1 -out ec-key.pem 2>/dev/null
openssl req -new -key ec-key.pem -out ec-csr.pem \
  -subj "/C=MY/ST=Selangor/L=Kuala Lumpur/O=EC Org/CN=EC Certificate" \
  2>/dev/null
openssl x509 -req -days 365 -in ec-csr.pem -signkey ec-key.pem -out ec-cert.pem 2>/dev/null
rm ec-csr.pem

echo ""
echo "Generated test certificates:"
ls -la *.pem

echo ""
echo "Certificate details:"
for cert in valid-cert.pem expired-cert.pem encrypted-cert.pem ec-cert.pem; do
  if [ -f "$cert" ]; then
    echo ""
    echo "=== $cert ==="
    openssl x509 -in "$cert" -noout -subject -dates 2>/dev/null || true
  fi
done

echo ""
echo "Done! Test certificates generated in: $SCRIPT_DIR"
