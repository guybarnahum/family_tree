#!/bin/bash

# Load and export variables from .env if the file exists
if [ -f .env ]; then
  echo "Loading credentials from .env..."
  set -o allexport
  source .env
  set +o allexport
else
  echo "Warning: .env file not found."
fi

echo "Deploying application to Cloudflare..."
npx wrangler deploy

echo "Deployment complete!"