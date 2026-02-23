#!/bin/bash
# Publish @eyeclaw/eyeclaw to npm
# Usage: ./publish.sh [version]

set -e

# Check if .env exists
if [ ! -f "../.env" ]; then
  echo "❌ Error: .env file not found in project root"
  echo "Please create .env file with NPM_TOKEN"
  echo "See ../.env.example for details"
  exit 1
fi

# Load .env
export $(grep -v '^#' ../.env | xargs)

# Check if NPM_TOKEN is set
if [ -z "$NPM_TOKEN" ]; then
  echo "❌ Error: NPM_TOKEN not set in .env"
  echo "Please add NPM_TOKEN to .env file"
  exit 1
fi

# Configure npm to use token
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

echo "📦 Publishing to npm..."
if [ -n "$NPM_OTP" ]; then
  npm publish --access public --otp="$NPM_OTP"
else
  npm publish --access public
fi

echo "✅ Successfully published @eyeclaw/eyeclaw"
echo ""
echo "Install with:"
echo "  openclaw plugins install @eyeclaw/eyeclaw"
