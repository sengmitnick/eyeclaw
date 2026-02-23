#!/bin/bash
# Quick Publish Script for @eyeclaw/eyeclaw v2.0.2
# This script helps you publish the updated version to npm

set -e

echo "📦 Publishing @eyeclaw/eyeclaw v2.0.2"
echo "======================================="
echo ""

# Check current directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    echo "Please run this script from the sdk directory:"
    echo "  cd sdk && bash PUBLISH_v2.0.2.sh"
    exit 1
fi

# Verify version
VERSION=$(node -p "require('./package.json').version")
if [ "$VERSION" != "2.0.2" ]; then
    echo "❌ Error: Version mismatch!"
    echo "Expected: 2.0.2"
    echo "Found: $VERSION"
    exit 1
fi

echo "✅ Version verified: $VERSION"
echo ""

# Check if .env exists
if [ ! -f "../.env" ]; then
    echo "❌ Error: .env file not found in project root"
    echo "Please create .env file with NPM_TOKEN"
    exit 1
fi

# Load NPM_TOKEN from .env
export $(grep NPM_TOKEN ../.env | xargs)

if [ -z "$NPM_TOKEN" ]; then
    echo "❌ Error: NPM_TOKEN not set in .env"
    exit 1
fi

echo "✅ NPM_TOKEN loaded from .env"
echo ""

# Configure npm
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

# Dry run first to show what will be published
echo "📋 Dry run - checking what will be published:"
echo "----------------------------------------------"
npm pack --dry-run 2>&1 | grep -E "(npm notice|index\.ts|src/|README|LICENSE|openclaw\.plugin\.json)" || true
echo ""

# Ask for confirmation
read -p "🤔 Do you want to proceed with publishing? (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Publishing cancelled"
    exit 0
fi

# Publish to npm
echo "📦 Publishing to npm..."
echo "----------------------------------------------"

if [ -n "$NPM_OTP" ]; then
    npm publish --access public --otp="$NPM_OTP"
else
    npm publish --access public
fi

echo ""
echo "✅ Successfully published @eyeclaw/eyeclaw@2.0.2"
echo ""
echo "🔗 Next Steps:"
echo "----------------------------------------------"
echo "1. Verify on npm:"
echo "   npm view @eyeclaw/eyeclaw version"
echo ""
echo "2. Test installation:"
echo "   openclaw plugins install @eyeclaw/eyeclaw"
echo ""
echo "3. Create GitHub Release:"
echo "   - Tag: v2.0.2"
echo "   - Title: Release v2.0.2"
echo "   - Copy content from ../RELEASE_NOTES_v2.0.2.md"
echo ""
echo "4. Update documentation at https://eyeclaw.io/docs"
echo ""
