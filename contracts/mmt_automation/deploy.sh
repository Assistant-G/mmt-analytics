#!/bin/bash
# MMT Automation Escrow Contracts Deployment Script
# Deploy to Sui Mainnet

set -e

echo "=== MMT Automation Escrow Deployment ==="
echo ""

# Check if sui is available
if ! command -v sui &> /dev/null; then
    echo "ERROR: sui CLI not found. Install from https://docs.sui.io/build/install"
    exit 1
fi

# Check balance
echo "Checking wallet balance..."
sui client gas

# Build first
echo ""
echo "Building contracts..."
cd "$(dirname "$0")"
sui move build

# Deploy
echo ""
echo "Deploying to mainnet..."
DEPLOY_OUTPUT=$(sui client publish --gas-budget 100000000 --json)

echo "$DEPLOY_OUTPUT" | jq .

# Extract package ID
PACKAGE_ID=$(echo "$DEPLOY_OUTPUT" | jq -r '.objectChanges[] | select(.type == "published") | .packageId')
echo ""
echo "==================================="
echo "PACKAGE ID: $PACKAGE_ID"
echo "==================================="

# Extract created objects
echo ""
echo "Created Objects:"
echo "$DEPLOY_OUTPUT" | jq '.objectChanges[] | select(.type == "created") | {objectId, objectType}'

# Save deployment info
echo ""
echo "Saving deployment info..."
cat > deployment.json << EOF
{
  "network": "mainnet",
  "packageId": "$PACKAGE_ID",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "modules": ["escrow_registry", "simple_escrow"]
}
EOF

echo "Deployment info saved to deployment.json"
echo ""
echo "Done! Update frontend with package ID: $PACKAGE_ID"
