/**
 * Combined Backend Service Entry Point
 *
 * Choose which service to run by setting the SERVICE env var:
 * - SERVICE=vault       → Run Vault Automation only
 * - SERVICE=lp-registry → Run LP Registry Automation only
 * - SERVICE=both        → Run both (default)
 */

const service = process.env.SERVICE || 'vault'; // Default to vault for testing

console.log(`Starting backend service: ${service}`);

if (service === 'vault' || service === 'both') {
  console.log('Loading Vault Automation...');
  import('./vault-automation.js');
}

if (service === 'lp-registry' || service === 'both') {
  console.log('Loading LP Registry Automation...');
  import('./lp-registry-automation.js');
}
