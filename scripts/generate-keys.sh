#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="$ROOT_DIR/infrastructure/keys"
PRIVATE_KEY="$KEY_DIR/jwt-private.pem"
PUBLIC_KEY="$KEY_DIR/jwt-public.pem"

mkdir -p "$KEY_DIR"

if [[ -f "$PRIVATE_KEY" && "${FORCE:-false}" != "true" ]]; then
  echo "Key pair already exists at $KEY_DIR (set FORCE=true to regenerate)."
else
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$PRIVATE_KEY" 2>/dev/null
  openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
  chmod 600 "$PRIVATE_KEY"
  chmod 644 "$PUBLIC_KEY"
  echo "Generated a new RS256 key pair in $KEY_DIR"
fi

PRIVATE_B64="$(base64 -w0 < "$PRIVATE_KEY")"
PUBLIC_B64="$(base64 -w0 < "$PUBLIC_KEY")"

cat <<INFO

Add these to your .env file (values are base64 encoded so they survive dotenv parsing):

JWT_PRIVATE_KEY=$PRIVATE_B64
JWT_PUBLIC_KEY=$PUBLIC_B64

INFO

if [[ -f "$ROOT_DIR/.env" && "${WRITE_ENV:-false}" == "true" ]]; then
  tmp="$(mktemp)"
  grep -v -E '^(JWT_PRIVATE_KEY|JWT_PUBLIC_KEY)=' "$ROOT_DIR/.env" > "$tmp" || true
  {
    echo "JWT_PRIVATE_KEY=$PRIVATE_B64"
    echo "JWT_PUBLIC_KEY=$PUBLIC_B64"
  } >> "$tmp"
  mv "$tmp" "$ROOT_DIR/.env"
  chmod 600 "$ROOT_DIR/.env"
  echo "Updated $ROOT_DIR/.env in place."
fi
