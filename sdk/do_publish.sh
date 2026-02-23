#!/bin/bash
cd "$(dirname "$0")"
export NPM_TOKEN=$(grep NPM_TOKEN ../.env | cut -d= -f2)
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc
npm publish --access public
