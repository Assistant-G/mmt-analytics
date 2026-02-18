#!/bin/bash

# Backend Verification Script
# This script helps diagnose why xSUI rewards aren't being tracked

echo "======================================"
echo "Backend Configuration Verification"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Expected values
NEW_PACKAGE="0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50"
NEW_CONFIG="0xc1dcb5fc12e9eea1763f8a8ef5c3b22c1869c62d7d03d599f060cbba4691bfdb"
OLD_PACKAGE="0x781c1aa586d9e938bbc07c2d030f8f29f7058c29c8c533fc86670d2c21b4c595"

echo "1. Checking local .env file..."
if [ -f "/home/user/mmtanal/contracts/mmt_automation/backend/.env" ]; then
    VAULT_PKG=$(grep "VAULT_PACKAGE_ID=" /home/user/mmtanal/contracts/mmt_automation/backend/.env | cut -d'=' -f2)
    VAULT_CFG=$(grep "VAULT_CONFIG_ID=" /home/user/mmtanal/contracts/mmt_automation/backend/.env | cut -d'=' -f2)

    if [ "$VAULT_PKG" == "$NEW_PACKAGE" ]; then
        echo -e "${GREEN}✓ Local .env has NEW package ID${NC}"
    elif [ "$VAULT_PKG" == "$OLD_PACKAGE" ]; then
        echo -e "${RED}✗ Local .env has OLD package ID${NC}"
        echo "  Fix: Update VAULT_PACKAGE_ID in .env to $NEW_PACKAGE"
    else
        echo -e "${YELLOW}⚠ Unknown package ID: $VAULT_PKG${NC}"
    fi
else
    echo -e "${RED}✗ .env file not found${NC}"
fi
echo ""

echo "2. Checking local code..."
CODE_PKG=$(grep -A1 "VAULT_PACKAGE_ID =" /home/user/mmtanal/contracts/mmt_automation/backend/vault-service.ts | grep "0x" | grep -o "0x[a-f0-9]\{64\}" | head -1)
if [ "$CODE_PKG" == "$NEW_PACKAGE" ]; then
    echo -e "${GREEN}✓ Local code has NEW package ID${NC}"
elif [ "$CODE_PKG" == "$OLD_PACKAGE" ]; then
    echo -e "${RED}✗ Local code has OLD package ID${NC}"
else
    echo -e "${YELLOW}⚠ Found package: $CODE_PKG${NC}"
fi
echo ""

echo "3. Checking if deposit_reward function exists in code..."
if grep -q "deposit_reward" /home/user/mmtanal/contracts/mmt_automation/backend/vault-service.ts; then
    echo -e "${GREEN}✓ Code calls deposit_reward()${NC}"
else
    echo -e "${RED}✗ Code does NOT call deposit_reward()${NC}"
    echo "  This means the backend is using old code!"
fi
echo ""

echo "4. Checking for running Node.js processes..."
if pgrep -f "vault-service" > /dev/null; then
    echo -e "${YELLOW}⚠ vault-service is running locally${NC}"
    echo "  PID: $(pgrep -f vault-service)"
    echo "  You should restart it to use new code"
else
    echo -e "${YELLOW}⚠ No local vault-service process found${NC}"
    echo "  Your backend is likely running on Railway or a remote server"
fi
echo ""

echo "5. Checking contract deployment..."
echo "  Verifying new package exists on-chain..."
if sui client object $NEW_PACKAGE --json >/dev/null 2>&1; then
    echo -e "${GREEN}✓ New contract package exists on-chain${NC}"
    echo "  PackageID: $NEW_PACKAGE"
else
    echo -e "${RED}✗ Cannot find new package on-chain${NC}"
    echo "  This might mean sui client is not configured"
fi
echo ""

echo "======================================"
echo "Diagnosis Summary"
echo "======================================"
echo ""

echo "Your Issue: xSUI rewards are going to wallet but NOT being tracked"
echo ""
echo -e "${YELLOW}Most Likely Cause:${NC}"
echo "  Your backend service (Railway/VPS) is running OLD code with OLD package IDs"
echo ""
echo -e "${GREEN}Solution:${NC}"
echo "  1. Find where your backend is deployed (Railway/VPS)"
echo "  2. Update environment variables:"
echo "     VAULT_PACKAGE_ID=$NEW_PACKAGE"
echo "     VAULT_CONFIG_ID=$NEW_CONFIG"
echo "  3. Redeploy or restart the backend service"
echo "  4. Wait for next vault cycle"
echo "  5. Check for RewardsCollected events"
echo ""
echo "For detailed instructions, see: BACKEND_DEPLOYMENT.md"
echo ""

# Check recent transaction
echo "======================================"
echo "Want to check what package a recent transaction used?"
echo "======================================"
echo ""
echo "Run this command with a transaction digest from your wallet:"
echo '  sui client transaction-block <DIGEST> --json | jq ".transaction.data.transaction.transactions[] | select(.MoveCall) | .MoveCall.package" | sort -u'
echo ""
echo "Expected output:"
echo "  \"$NEW_PACKAGE\"  (if using NEW contract)"
echo "  \"$OLD_PACKAGE\"  (if using OLD contract - PROBLEM!)"
echo ""
