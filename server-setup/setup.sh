#!/bin/bash
#
# VibeHost Server Setup Script
# Idempotent setup for deploying multiple static web apps with automatic subdomain routing
# Safe to run multiple times - skips steps that are already complete
#
# Usage: ./setup.sh <domain> <email>
# Example: ./setup.sh example.com admin@example.com

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script as root"
    exit 1
fi

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <domain> <email>"
    echo ""
    echo "Arguments:"
    echo "  domain    Your domain name (e.g., example.com)"
    echo "  email     Email for Let's Encrypt notifications"
    echo ""
    echo "Example:"
    echo "  $0 example.com admin@example.com"
    exit 1
fi

DOMAIN=$1
EMAIL=$2

log_info "Starting VibeHost server setup for domain: $DOMAIN"

# ============================================
# Step 1: Install packages (idempotent)
# ============================================
if ! command -v nginx &> /dev/null; then
    log_info "Installing Nginx..."
    apt-get update -qq
    apt-get install -y -qq nginx
else
    log_skip "Nginx already installed"
fi

if ! command -v certbot &> /dev/null; then
    log_info "Installing Certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot
else
    log_skip "Certbot already installed"
fi

# ============================================
# Step 1b: Install Docker (idempotent)
# ============================================
if ! command -v docker &> /dev/null; then
    log_info "Installing Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
else
    log_skip "Docker already installed"
fi

# ============================================
# Step 2: Create directory structure (idempotent)
# ============================================
if [ ! -d "/var/www/apps" ]; then
    log_info "Creating directory structure..."
    mkdir -p /var/www/apps
    mkdir -p /var/www/apps/_root
else
    log_skip "Directory structure already exists"
    mkdir -p /var/www/apps/_root
fi

# Create default landing page only if it doesn't exist
if [ ! -f "/var/www/apps/_root/index.html" ]; then
    log_info "Creating default landing page..."
    cat > /var/www/apps/_root/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VibeHost</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        p {
            font-size: 1.2rem;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>VibeHost</h1>
        <p>Your apps are deployed and ready.</p>
    </div>
</body>
</html>
EOF
else
    log_skip "Landing page already exists"
fi

# Create ACME challenge directory for HTTP-01 validation
mkdir -p /var/www/acme-challenge

# Set permissions
chown -R www-data:www-data /var/www/apps
chmod -R 755 /var/www/apps
chown -R www-data:www-data /var/www/acme-challenge
chmod -R 755 /var/www/acme-challenge

# ============================================
# Step 3: Create ensure-cert.sh helper script
# ============================================
log_info "Creating certificate helper script..."
cat > /usr/local/bin/ensure-cert.sh << 'CERTSCRIPT'
#!/bin/bash
#
# Ensure SSL certificate exists for a subdomain
# Usage: ensure-cert.sh <subdomain> <domain> <email>
# Example: ensure-cert.sh myapp example.com admin@example.com
#
# Returns 0 if cert exists or was successfully created
# Returns 1 on error

set -e

SUBDOMAIN=$1
DOMAIN=$2
EMAIL=$3

if [ -z "$SUBDOMAIN" ] || [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: ensure-cert.sh <subdomain> <domain> <email>"
    exit 1
fi

FQDN="${SUBDOMAIN}.${DOMAIN}"
CERT_PATH="/etc/letsencrypt/live/${FQDN}"

# Check if cert already exists
if [ -d "$CERT_PATH" ]; then
    echo "Certificate already exists for ${FQDN}"
    exit 0
fi

echo "Obtaining certificate for ${FQDN}..."

# Use webroot authentication with the ACME challenge directory
certbot certonly \
    --webroot \
    --webroot-path /var/www/acme-challenge \
    -d "$FQDN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --quiet

if [ $? -eq 0 ]; then
    echo "Certificate obtained successfully for ${FQDN}"
    # Fix permissions so nginx workers can read certs
    chmod 755 /etc/letsencrypt/live/
    chmod 755 /etc/letsencrypt/archive/
    chmod 644 /etc/letsencrypt/archive/${FQDN}/*.pem 2>/dev/null || true
    exit 0
else
    echo "Failed to obtain certificate for ${FQDN}"
    exit 1
fi
CERTSCRIPT

chmod +x /usr/local/bin/ensure-cert.sh

# ============================================
# Step 3b: Create docker app helper script
# ============================================
log_info "Creating docker app helper script..."
cat > /usr/local/bin/start-docker-app.sh << 'DOCKERSCRIPT'
#!/bin/bash
#
# Start a docker-compose app with a specific port
# Usage: start-docker-app.sh <app_path> <port>
# Example: start-docker-app.sh /var/www/apps/myapi 3001
#

set -e

APP_PATH=$1
PORT=$2

if [ -z "$APP_PATH" ] || [ -z "$PORT" ]; then
    echo "Usage: start-docker-app.sh <app_path> <port>"
    exit 1
fi

if [ ! -f "$APP_PATH/docker-compose.yml" ]; then
    echo "No docker-compose.yml found in $APP_PATH"
    exit 1
fi

APP_NAME=$(basename "$APP_PATH")
echo "Starting docker app: $APP_NAME on port $PORT"

cd "$APP_PATH"

# Export PORT for docker-compose to use
export PORT=$PORT

# Pull latest images and restart
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build --remove-orphans

echo "Docker app $APP_NAME started on port $PORT"
DOCKERSCRIPT

chmod +x /usr/local/bin/start-docker-app.sh

# ============================================
# Step 4: Get certificate for root domain
# ============================================
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"
if [ ! -d "$CERT_PATH" ]; then
    log_info "Obtaining certificate for root domain: $DOMAIN"
    
    # First, set up a temporary nginx config for ACME challenges
    cat > /etc/nginx/sites-available/acme-temp << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN *.$DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/acme-challenge;
    }
    
    location / {
        return 444;
    }
}
EOF
    
    ln -sf /etc/nginx/sites-available/acme-temp /etc/nginx/sites-enabled/acme-temp
    rm -f /etc/nginx/sites-enabled/default
    rm -f /etc/nginx/sites-enabled/apps
    nginx -t && systemctl reload nginx
    
    certbot certonly \
        --webroot \
        --webroot-path /var/www/acme-challenge \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --non-interactive
    
    if [ $? -ne 0 ]; then
        log_error "Failed to obtain certificate for root domain"
        exit 1
    fi
    
    log_info "Certificate obtained for root domain"
else
    log_skip "Root domain certificate already exists"
fi

# Fix permissions so nginx workers can read certs (needed for dynamic SSL cert loading)
log_info "Setting certificate permissions..."
chmod 755 /etc/letsencrypt/live/
chmod 755 /etc/letsencrypt/archive/
find /etc/letsencrypt/archive/ -name "*.pem" -exec chmod 644 {} \; 2>/dev/null || true

# ============================================
# Step 5: Configure Nginx
# ============================================
log_info "Configuring Nginx..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if nginx config template exists
if [ -f "$SCRIPT_DIR/nginx-apps.conf" ]; then
    sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$SCRIPT_DIR/nginx-apps.conf" > /etc/nginx/sites-available/apps
else
    log_error "nginx-apps.conf template not found!"
    exit 1
fi

# Enable the site
ln -sf /etc/nginx/sites-available/apps /etc/nginx/sites-enabled/apps

# Remove temporary ACME config if it exists
rm -f /etc/nginx/sites-enabled/acme-temp
rm -f /etc/nginx/sites-available/acme-temp
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
log_info "Testing Nginx configuration..."
nginx -t

if [ $? -ne 0 ]; then
    log_error "Nginx configuration test failed!"
    exit 1
fi

# Reload Nginx
log_info "Reloading Nginx..."
systemctl reload nginx
systemctl enable nginx

# ============================================
# Step 6: Set up automatic certificate renewal (idempotent)
# ============================================
if ! systemctl is-enabled certbot.timer &>/dev/null 2>&1; then
    log_info "Setting up automatic certificate renewal..."
    systemctl enable certbot.timer
    systemctl start certbot.timer
else
    log_skip "Certificate auto-renewal already configured"
fi

# Add a post-renewal hook to fix permissions and reload Nginx
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/fix-permissions-and-reload.sh << 'EOF'
#!/bin/bash
# Fix permissions so nginx workers can read certs (needed for dynamic SSL)
chmod 755 /etc/letsencrypt/live/
chmod 755 /etc/letsencrypt/archive/
find /etc/letsencrypt/archive/ -name "*.pem" -exec chmod 644 {} \;
# Reload nginx to pick up renewed certs
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/fix-permissions-and-reload.sh

# Remove old hook if it exists
rm -f /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# ============================================
# Done!
# ============================================
echo ""
echo "============================================"
log_info "VibeHost setup complete!"
echo "============================================"
echo ""
echo "Server IP: $(hostname -I | awk '{print $1}')"
echo "Domain: $DOMAIN"
echo ""
echo "Your server is ready to receive deployments."
echo ""
echo "Example:"
echo "   /myapp/index.html  →  https://myapp.$DOMAIN"
echo "   /blog/index.html   →  https://blog.$DOMAIN"
echo ""
echo "Root domain: https://$DOMAIN"
echo ""
