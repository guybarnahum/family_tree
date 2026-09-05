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

echo "1. Creating D1 database (skip if already created)..."
npx wrangler d1 create family_tree_db

echo ""
echo "=========================================================="
echo "🚨 ACTION REQUIRED: Copy the 'database_id' from the output above"
echo "and paste it into your wrangler.toml file."
echo "=========================================================="
read -p "Press [Enter] once you have updated wrangler.toml..."

echo "2. Applying schema to local and remote D1 databases..."
npx wrangler d1 execute family_tree_db --local --file=./schema.sql
npx wrangler d1 execute family_tree_db --remote --file=./schema.sql

echo "Setup complete! You can now run ./deploy.sh"
