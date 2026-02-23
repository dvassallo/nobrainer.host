# nobrainer.host

**Zero-config deployment for web apps with automatic subdomain routing and SSL.**

Each folder in your repo becomes a subdomain. Supports both static sites and Docker Compose apps.

```
/myapp/index.html        →  https://myapp.yourdomain.com  (static)
/blog/index.html         →  https://blog.yourdomain.com   (static)
/api/docker-compose.yml  →  https://api.yourdomain.com    (docker)
```

## Quick Start

### Option 1: Deploy directly from your machine

```bash
npx nobrainer.host deploy --domain yourdomain.com
```

Deploys immediately via SSH. Great for solo devs or quick testing.

### Option 2: Set up GitHub Actions

```bash
npx nobrainer.host gh --domain yourdomain.com
```

Creates a workflow that deploys on every push to `main`. Then:

1. **Add `DEPLOY_KEY` secret** to your GitHub repo (your SSH private key)
2. **Push to main** — your apps deploy automatically!

## Prerequisites

- A domain name with DNS pointing to your server (A records for `@` and `*`)
- A Linux server (Ubuntu 20.04+ or Debian 11+) with root SSH access
- Ports 80 and 443 open
- SSH key set up (`ssh root@yourdomain.com` should work)

## Features

- **Zero-config subdomains**: Add a folder, deploy, it's live
- **Automatic SSL**: Let's Encrypt certificates for each subdomain
- **Static & Docker apps**: Mix static sites and Docker Compose apps
- **Two deploy modes**: Direct from laptop, or via GitHub Actions
- **No vendor lock-in**: Works with any DNS provider, any VPS

## Commands

### `deploy` — Direct Deploy

```bash
npx nobrainer.host deploy --domain example.com [--email you@email.com]
```

Deploys directly from your current directory to your server. Uses your system SSH (ssh-agent or default keys).

### `gh` — GitHub Actions Setup

```bash
npx nobrainer.host gh --domain example.com [--email you@email.com]
```

Creates `.github/workflows/deploy.yml` for automated deploys on push.

The `--email` flag is optional. If provided, Let's Encrypt will send certificate expiration notices.

## DNS Setup

Add these records at your DNS provider:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `your.server.ip` |
| A | `*` | `your.server.ip` |

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
          letsencrypt_email: admin@example.com  # optional
```

### Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `domain` | Yes | Your domain name |
| `deploy_key` | Yes | SSH private key for server access |
| `letsencrypt_email` | No | Email for SSL certificate notifications |

## Root Domain

The root domain (`https://yourdomain.com`) automatically shows an index of all your apps.

### Custom Landing Page

To fully customize, create `_root/index.html`:

```
_root/
└── index.html    →   https://yourdomain.com
```

### Custom Template

To customize the design while keeping auto-generated app links, create `_root/index.template.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Apps</title>
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

**SSH connection failed**: Make sure you can `ssh root@yourdomain.com` from your machine.

**SSL errors**: Make sure DNS is configured and propagated. Both `@` and `*` A records must point to your server.

**App not showing**: Check that folder has an `index.html` (for static) or `docker-compose.yml` (for Docker).

## License

MIT

## Author

[Daniel Vassallo](https://twitter.com/dvassallo)
