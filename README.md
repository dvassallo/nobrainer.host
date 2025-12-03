# nobrainer.host

**Zero-config deployment for web apps with automatic subdomain routing and SSL.**

Each folder in your repo becomes a subdomain. Supports both static sites and Docker Compose apps.

```
/myapp/index.html        →  https://myapp.yourdomain.com  (static)
/blog/index.html         →  https://blog.yourdomain.com   (static)
/api/docker-compose.yml  →  https://api.yourdomain.com    (docker)
```

## Quick Start

```bash
npx nobrainer.host init --domain yourdomain.com --email you@email.com
```

This creates a GitHub Actions workflow. Then:

1. **Add `DEPLOY_KEY` secret** to your GitHub repo (your SSH private key)
2. **Configure DNS** (A records for `@` and `*` pointing to your server)
3. **Push to main** — your apps are live!

## Features

- **Zero-config subdomains**: Add a folder, push, it's live
- **Automatic SSL**: Let's Encrypt certificates for each subdomain
- **Static & Docker apps**: Mix static sites and Docker Compose apps
- **Auto-generated index**: Root domain lists all your apps
- **No vendor lock-in**: Works with any DNS provider, any VPS

## Prerequisites

- A domain name
- A Linux server (Ubuntu 20.04+ or Debian 11+) with root SSH access
- Ports 80 and 443 open

## Setup Guide

### 1. Initialize your repo

```bash
cd your-project
npx nobrainer.host init --domain example.com --email admin@example.com
```

### 2. Generate SSH key and add to server

```bash
# Generate a deployment key
ssh-keygen -t ed25519 -f ~/.ssh/nobrainer_deploy -N ""

# Add public key to your server
ssh-copy-id -i ~/.ssh/nobrainer_deploy.pub root@your.server.ip
```

### 3. Add GitHub Secret

Go to your repo → Settings → Secrets → Actions → New repository secret

- Name: `DEPLOY_KEY`
- Value: Contents of `~/.ssh/nobrainer_deploy` (the private key)

### 4. Configure DNS

Add these records at your DNS provider:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `your.server.ip` |
| A | `*` | `your.server.ip` |

### 5. Deploy!

```bash
mkdir myapp
echo "<h1>Hello!</h1>" > myapp/index.html
git add .
git commit -m "Add myapp"
git push
```

Visit `https://myapp.example.com` — it just works!

## How It Works

On every push to `main`:

1. First deploy: Installs Nginx + Certbot on your server
2. Syncs your app folders to the server via rsync
3. Issues SSL certificates for any new subdomains
4. Cleans up certificates for deleted apps
5. Reloads Nginx

For static apps, Nginx serves files directly. For Docker apps, Nginx proxies to the container.

## Docker Compose Apps

To deploy a Docker app, add a `docker-compose.yml` to your app folder:

```
/myapi/
├── docker-compose.yml
├── Dockerfile
└── src/
```

### Port Assignment

Ports are auto-assigned alphabetically starting at 3000. Your app must read the `PORT` environment variable:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - PORT=${PORT:-3000}
```

Example port assignments:
```
abc/    → port 3000
blog/   → static (no port, no docker-compose.yml)
myapi/  → port 3001
xyz/    → port 3002
```

### Cleanup

When you delete a Docker app folder, its container is automatically stopped on the next deploy.

## Using as a GitHub Action

If you prefer to write the workflow manually:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dvassallo/nobrainer.host@v1
        with:
          domain: example.com
          deploy_key: ${{ secrets.DEPLOY_KEY }}
          letsencrypt_email: admin@example.com
```

### Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `domain` | Yes | Your domain name |
| `deploy_key` | Yes | SSH private key for server access |
| `letsencrypt_email` | Yes | Email for SSL certificate notifications |
| `force_setup` | No | Force re-run server setup (default: false) |

## Updating Domain/Email

Just run the init command again:

```bash
npx nobrainer.host init --domain newdomain.com --email new@email.com
```

This updates your existing workflow file.

## Root Domain

The root domain (`https://yourdomain.com`) automatically shows an index of all your apps.

### Custom Landing Page

To fully customize, create `_root/index.html`:

```
_root/
└── index.html    →   https://yourdomain.com
```

### Custom Template (recommended)

To customize the design while keeping auto-generated app links, create `_root/index.template.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Apps</title>
    <style>
        /* Your custom styles */
    </style>
</head>
<body>
    <h1>My Apps ({{APP_COUNT}} total)</h1>
    <div class="apps">
        {{APPS}}
    </div>
    <p>Hosted on {{DOMAIN}}</p>
</body>
</html>
```

**Available placeholders:**
- `{{APPS}}` — Generated `<a>` links for each app
- `{{APP_COUNT}}` — Number of apps
- `{{DOMAIN}}` — Your domain name

## Troubleshooting

**SSL errors**: Make sure DNS is configured and propagated. Both `@` and `*` A records must point to your server.

**Permission denied**: Verify `DEPLOY_KEY` secret contains the full private key including `-----BEGIN` and `-----END` lines.

**App not showing**: Check that folder has an `index.html` and the folder name matches the subdomain.

## License

MIT

## Author

[Daniel Vassallo](https://twitter.com/dvassallo)

