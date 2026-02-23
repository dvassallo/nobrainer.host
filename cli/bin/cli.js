#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const WORKFLOW_PATH = '.github/workflows/deploy.yml';

function parseArgs(args) {
  const result = { command: null, domain: null, server: null, email: null };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'setup' || arg === 'deploy' || arg === 'github-workflow' || arg === 'gh' || arg === 'automate') {
      result.command = (arg === 'gh' || arg === 'automate') ? 'github-workflow' : arg;
    } else if (arg === '--domain' && args[i + 1]) {
      result.domain = args[++i];
    } else if (arg === '--server' && args[i + 1]) {
      result.server = args[++i];
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
nobrainer.host - Zero-config deployment for web apps

Commands:
  setup            Set up a new server (install nginx, Docker, etc.)
  deploy           Deploy apps from your local machine
  github-workflow  Set up GitHub Actions for automated deploys

Usage:
  npx nobrainer.host setup --domain <domain> --server <ip> [--email <email>]
  npx nobrainer.host deploy --domain <domain> [--server <ip>] [--email <email>]
  npx nobrainer.host github-workflow --domain <domain> [--server <ip>] [--email <email>]

Options:
  --domain  Your domain name (e.g., example.com) [required]
  --server  Server IP for SSH (defaults to domain if not set)
  --email   Email for Let's Encrypt notifications [optional]
  --help    Show this help message

Examples:
  npx nobrainer.host setup --domain mysite.com --server 123.45.67.89
  npx nobrainer.host deploy --domain mysite.com
  npx nobrainer.host github-workflow --domain mysite.com --email admin@mysite.com

Learn more: https://github.com/dvassallo/nobrainer.host
`);
}

// ============================================
// GitHub Actions Setup (gh command)
// ============================================

function generateWorkflow(domain, server, email) {
  const serverLine = server 
    ? `server: \${{ secrets.SERVER || '${server}' }}`
    : `server: \${{ secrets.SERVER || '' }}`;
  const emailLine = email 
    ? `letsencrypt_email: \${{ secrets.LETSENCRYPT_EMAIL || '${email}' }}`
    : `letsencrypt_email: \${{ secrets.LETSENCRYPT_EMAIL || '' }}`;
  
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
          ${serverLine}
          deploy_key: \${{ secrets.DEPLOY_KEY }}
          ${emailLine}
`;
}

function githubWorkflowCommand(domain, server, email) {
  if (!domain) {
    console.error('Error: --domain is required\n');
    console.log('Usage: npx nobrainer.host github-workflow --domain <domain> [--server <ip>] [--email <email>]');
    process.exit(1);
  }

  const sshHost = server || domain;

  // Create .github/workflows directory if it doesn't exist
  const workflowDir = path.dirname(WORKFLOW_PATH);
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
    console.log(`✓ Created ${workflowDir}/`);
  }

  // Check if workflow already exists
  const exists = fs.existsSync(WORKFLOW_PATH);
  
  // Generate and write workflow
  const workflow = generateWorkflow(domain, server, email);
  fs.writeFileSync(WORKFLOW_PATH, workflow);
  
  if (exists) {
    console.log(`✓ Updated ${WORKFLOW_PATH}`);
  } else {
    console.log(`✓ Created ${WORKFLOW_PATH}`);
  }

  console.log(`
Configuration:
  Domain: ${domain}
  Server: ${server || '(using domain)'}
  Email:  ${email || '(not set)'}

Next steps:
  1. Add DEPLOY_KEY secret to your GitHub repo (required)
     (Settings → Secrets → Actions → New repository secret)
     
     Generate a key: ssh-keygen -t ed25519 -f ~/.ssh/nobrainer_deploy -N ""
     Add public key to server: ssh-copy-id -i ~/.ssh/nobrainer_deploy.pub root@${sshHost}
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

// ============================================
// Direct Deploy (deploy command)
// ============================================

function run(cmd, options = {}) {
  const { silent = false, allowFail = false } = options;
  try {
    if (!silent) console.log(`  → ${cmd}`);
    return execSync(cmd, { encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' });
  } catch (e) {
    if (!allowFail) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return '';
  }
}

function runSSH(sshHost, remoteCmd, options = {}) {
  const cmd = `ssh -o StrictHostKeyChecking=no root@${sshHost} "${remoteCmd.replace(/"/g, '\\"')}"`;
  return run(cmd, options);
}

// ============================================
// Server Setup (setup command)
// ============================================

function setupCommand(domain, server, email) {
  if (!domain) {
    console.error('Error: --domain is required\n');
    console.log('Usage: npx nobrainer.host setup --domain <domain> --server <ip> [--email <email>]');
    process.exit(1);
  }
  
  if (!server) {
    console.error('Error: --server is required for setup\n');
    console.log('Usage: npx nobrainer.host setup --domain <domain> --server <ip> [--email <email>]');
    process.exit(1);
  }

  const emailArg = email || '';
  
  // Get the path to the server-setup files (relative to this script)
  const cliDir = __dirname;
  const moduleRoot = path.resolve(cliDir, '..', '..');
  const setupScript = path.join(moduleRoot, 'server-setup', 'setup.sh');
  const nginxConf = path.join(moduleRoot, 'server-setup', 'nginx-apps.conf');
  
  if (!fs.existsSync(setupScript)) {
    console.error(`Error: Cannot find setup.sh at ${setupScript}`);
    console.error('Make sure you have the full nobrainer.host package installed.');
    process.exit(1);
  }

  console.log(`\n🔧 Setting up server at ${server} for ${domain}...\n`);

  // Copy setup files and run setup
  console.log('1. Copying setup files...');
  run(`scp -o StrictHostKeyChecking=no "${setupScript}" "${nginxConf}" root@${server}:/tmp/`);
  
  console.log('\n2. Running server setup...');
  runSSH(server, `chmod +x /tmp/setup.sh && /tmp/setup.sh ${domain} ${emailArg}`);

  console.log(`
✅ Server setup complete!

Next steps:
  1. Configure DNS (A records pointing to your server):
     @  →  ${server}
     *  →  ${server}

  2. Deploy your apps:
     npx nobrainer.host deploy --domain ${domain}${server !== domain ? ` --server ${server}` : ''}
`);
}

// ============================================
// Deploy (deploy command)
// ============================================

function deployCommand(domain, server, email) {
  if (!domain) {
    console.error('Error: --domain is required\n');
    console.log('Usage: npx nobrainer.host deploy --domain <domain> [--server <ip>] [--email <email>]');
    process.exit(1);
  }

  const sshHost = server || domain;
  const cwd = process.cwd();
  const emailArg = email || '';

  console.log(`\n🚀 Deploying to ${domain}${server ? ` (via ${server})` : ''}...\n`);

  // Step 1: Rsync files
  console.log('1. Syncing files...');
  run(`rsync -avz --delete \\
    --exclude '.git' \\
    --exclude '.github' \\
    --exclude 'node_modules' \\
    --exclude '.env' \\
    --exclude '.DS_Store' \\
    -e "ssh -o StrictHostKeyChecking=no" \\
    "${cwd}/" root@${sshHost}:/var/www/apps/`);

  // Step 2: Detect apps and Docker apps
  console.log('\n2. Detecting apps...');
  
  // Find all app directories (exclude system folders)
  const allApps = fs.readdirSync(cwd)
    .filter(f => {
      const stat = fs.statSync(path.join(cwd, f));
      return stat.isDirectory() && 
        !f.startsWith('.') && 
        !['node_modules', 'server-setup', '_root'].includes(f);
    })
    .sort();

  // Find Docker apps
  const dockerApps = allApps.filter(app => 
    fs.existsSync(path.join(cwd, app, 'docker-compose.yml'))
  );

  const staticApps = allApps.filter(app => !dockerApps.includes(app));

  console.log(`  Found ${allApps.length} apps: ${staticApps.length} static, ${dockerApps.length} Docker`);

  // Step 3: Start Docker apps
  if (dockerApps.length > 0) {
    console.log('\n3. Starting Docker apps...');
    let port = 3000;
    for (const app of dockerApps) {
      console.log(`  Starting ${app} on port ${port}...`);
      runSSH(sshHost, `cd /var/www/apps/${app} && PORT=${port} docker compose up -d --build --remove-orphans`, { allowFail: true });
      port++;
    }
  }

  // Step 4: Stop orphaned Docker containers
  console.log('\n4. Cleaning up orphaned containers...');
  runSSH(sshHost, `
    PROJECTS=$(docker ps --format '{{.Labels}}' 2>/dev/null | grep -oP 'com.docker.compose.project=\\K[^,]+' | sort -u || true)
    for project in $PROJECTS; do
      if [ ! -d "/var/www/apps/$project" ]; then
        echo "Stopping orphaned: $project"
        docker compose -p "$project" down --remove-orphans 2>/dev/null || true
      fi
    done
  `, { allowFail: true });

  // Step 5: Issue SSL certificates
  console.log('\n5. Issuing SSL certificates...');
  for (const app of allApps) {
    console.log(`  Certificate for ${app}.${domain}...`);
    runSSH(sshHost, `/usr/local/bin/ensure-cert.sh ${app} ${domain} ${emailArg}`, { allowFail: true });
  }

  // Step 6: Fix certificate permissions
  console.log('\n6. Fixing certificate permissions...');
  runSSH(sshHost, `
    chmod 755 /etc/letsencrypt/live/ 2>/dev/null || true
    chmod 755 /etc/letsencrypt/archive/ 2>/dev/null || true
    find /etc/letsencrypt/archive/ -name "*.pem" -exec chmod 644 {} \\; 2>/dev/null || true
  `);

  // Step 7: Generate nginx config
  console.log('\n7. Generating nginx config...');
  
  let nginxConfig = `# HTTP - ACME challenges and redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name *.${domain} ${domain};
    location /.well-known/acme-challenge/ { root /var/www/acme-challenge; }
    location / { return 301 https://\\$host\\$request_uri; }
}
# Root domain
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain};
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    root /var/www/apps/_root;
    index index.html;
    location / { try_files \\$uri \\$uri/ =404; }
}
`;

  let port = 3000;
  for (const app of allApps) {
    if (dockerApps.includes(app)) {
      // Docker app - proxy
      nginxConfig += `
# Docker app - ${app} -> port ${port}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${app}.${domain};
    ssl_certificate /etc/letsencrypt/live/${app}.${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${app}.${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_cache_bypass \\$http_upgrade;
    }
}
`;
      port++;
    } else {
      // Static app
      nginxConfig += `
# Static app - ${app}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${app}.${domain};
    ssl_certificate /etc/letsencrypt/live/${app}.${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${app}.${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    root /var/www/apps/${app};
    index index.html index.htm;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    location / { try_files \\$uri \\$uri/ /index.html =404; }
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`;
    }
  }

  // Write config to server
  const tmpConfigPath = '/tmp/nginx-apps-' + Date.now() + '.conf';
  fs.writeFileSync(tmpConfigPath, nginxConfig);
  run(`scp -o StrictHostKeyChecking=no "${tmpConfigPath}" root@${sshHost}:/etc/nginx/sites-available/apps`);
  fs.unlinkSync(tmpConfigPath);
  
  runSSH(sshHost, 'ln -sf /etc/nginx/sites-available/apps /etc/nginx/sites-enabled/apps && nginx -t && systemctl reload nginx');

  console.log(`
✅ Deploy complete!

Your apps are live:
${allApps.map(app => `  https://${app}.${domain}`).join('\n')}

Root domain: https://${domain}
`);
}

// ============================================
// Main
// ============================================

const args = parseArgs(process.argv.slice(2));

if (args.command === 'help' || !args.command) {
  showHelp();
} else if (args.command === 'setup') {
  setupCommand(args.domain, args.server, args.email);
} else if (args.command === 'deploy') {
  deployCommand(args.domain, args.server, args.email);
} else if (args.command === 'github-workflow') {
  githubWorkflowCommand(args.domain, args.server, args.email);
} else {
  console.error(`Unknown command: ${args.command}`);
  showHelp();
  process.exit(1);
}
