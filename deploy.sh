#!/bin/bash
set -e

# Load and export variables from .env if the file exists
if [ -f .env ]; then
  echo "Loading credentials from .env..."
  set -o allexport
  source .env
  set +o allexport
else
  echo "Warning: .env file not found."
fi

BUILD_SHA="$(git rev-parse --short=8 HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Deploying application to Cloudflare..."
echo "Build: ${BUILD_SHA} (${BUILD_TIME})"

npx wrangler deploy \
  --var "BUILD_SHA:${BUILD_SHA}" \
  --var "BUILD_TIME:${BUILD_TIME}"

echo "Deployment complete: ${BUILD_SHA}"