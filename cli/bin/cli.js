#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = '.github/workflows/deploy.yml';

function parseArgs(args) {
  const result = { command: null, domain: null, email: null };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'init') {
      result.command = 'init';
    } else if (arg === '--domain' && args[i + 1]) {
      result.domain = args[++i];
    } else if (arg === '--email' && args[i + 1]) {
      result.email = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      result.command = 'help';
    }
  }
  
  return result;
}

function showHelp() {
  console.log(`
nobrainer.host - Zero-config deployment for static web apps

Usage:
  npx nobrainer.host init --domain <domain> --email <email>

Options:
  --domain  Your domain name (e.g., example.com)
  --email   Email for Let's Encrypt SSL notifications
  --help    Show this help message

Example:
  npx nobrainer.host init --domain mysite.com --email admin@mysite.com

This will create (or update) .github/workflows/deploy.yml in your repo.

After running this command:
  1. Add DEPLOY_KEY secret to your GitHub repo (SSH private key)
  2. Configure DNS: A records for @ and * pointing to your server
  3. Push to main branch to deploy!

Learn more: https://github.com/dvassallo/nobrainer.host
`);
}

function generateWorkflow(domain, email) {
  return `name: Deploy
on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dvassallo/nobrainer.host@v1
        with:
          domain: \${{ secrets.DOMAIN || '${domain}' }}
          deploy_key: \${{ secrets.DEPLOY_KEY }}
          letsencrypt_email: \${{ secrets.LETSENCRYPT_EMAIL || '${email}' }}
`;
}

function init(domain, email) {
  if (!domain || !email) {
    console.error('Error: --domain and --email are required\n');
    console.log('Usage: npx nobrainer.host init --domain <domain> --email <email>');
    process.exit(1);
  }

  // Create .github/workflows directory if it doesn't exist
  const workflowDir = path.dirname(WORKFLOW_PATH);
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
    console.log(`✓ Created ${workflowDir}/`);
  }

  // Check if workflow already exists
  const exists = fs.existsSync(WORKFLOW_PATH);
  
  // Generate and write workflow
  const workflow = generateWorkflow(domain, email);
  fs.writeFileSync(WORKFLOW_PATH, workflow);
  
  if (exists) {
    console.log(`✓ Updated ${WORKFLOW_PATH}`);
  } else {
    console.log(`✓ Created ${WORKFLOW_PATH}`);
  }

  console.log(`
Configuration:
  Domain: ${domain}
  Email:  ${email}

These values are set as defaults. You can override them by adding
DOMAIN and LETSENCRYPT_EMAIL secrets to your GitHub repo.

Next steps:
  1. Add DEPLOY_KEY secret to your GitHub repo (required)
     (Settings → Secrets → Actions → New repository secret)
     
     Generate a key: ssh-keygen -t ed25519 -f ~/.ssh/nobrainer_deploy -N ""
     Add public key to server: ssh-copy-id -i ~/.ssh/nobrainer_deploy.pub root@${domain}
     Paste private key (~/.ssh/nobrainer_deploy) as the DEPLOY_KEY secret

  2. Configure DNS (A records pointing to your server):
     @  →  your.server.ip
     *  →  your.server.ip

  3. Commit and push:
     git add .github/workflows/deploy.yml
     git commit -m "Add nobrainer.host deployment"
     git push

Your apps will be live at https://<folder>.${domain}
`);
}

// Main
const args = parseArgs(process.argv.slice(2));

if (args.command === 'help' || !args.command) {
  showHelp();
} else if (args.command === 'init') {
  init(args.domain, args.email);
} else {
  console.error(`Unknown command: ${args.command}`);
  showHelp();
  process.exit(1);
}

