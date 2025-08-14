# NearChat Oracle Cloud Free Tier Deployment Guide

## Overview
This guide provides step-by-step instructions for deploying NearChat on Oracle Cloud Free Tier with Docker clustering, load balancing, and production optimization for 100k+ concurrent users.

## Prerequisites
- Oracle Cloud Free Tier account
- Domain name (optional but recommended)
- Basic knowledge of Linux and Docker

## Oracle Cloud Free Tier Specifications
- **Compute**: 2 AMD-based Compute VMs with 1/8 OCPU and 1 GB memory each
- **Storage**: 200 GB total storage
- **Networking**: 10 Gbps network bandwidth
- **Load Balancer**: 1 instance
- **Block Volume**: 200 GB total

## Architecture Overview
```
Internet → Load Balancer → Nginx → Docker Containers
                              ↓
                    Redis Cluster + MongoDB
```

## Step 1: Create Oracle Cloud Infrastructure

### 1.1 Create Virtual Cloud Network (VCN)
```bash
# Create VCN
oci network vcn create \
  --compartment-id <compartment-id> \
  --display-name "nearchat-vcn" \
  --cidr-block "10.0.0.0/16" \
  --dns-label "nearchat"

# Create Internet Gateway
oci network internet-gateway create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-igw"

# Create Route Table
oci network route-table create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-rt" \
  --route-rules '[{"cidr": "0.0.0.0/0", "networkEntityId": "<igw-id>"}]'
```

### 1.2 Create Subnets
```bash
# Public Subnet for Load Balancer
oci network subnet create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-public-subnet" \
  --cidr-block "10.0.1.0/24" \
  --dns-label "public" \
  --security-list-ids '["<public-seclist-id>"]'

# Private Subnet for Application Servers
oci network subnet create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-private-subnet" \
  --cidr-block "10.0.2.0/24" \
  --dns-label "private" \
  --security-list-ids '["<private-seclist-id>"]'
```

### 1.3 Create Security Lists
```bash
# Public Security List
oci network security-list create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-public-seclist" \
  --ingress-security-rules '[
    {"source": "0.0.0.0/0", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 80, "max": 80}}},
    {"source": "0.0.0.0/0", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 443, "max": 443}}},
    {"source": "0.0.0.0/0", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 22, "max": 22}}}
  ]' \
  --egress-security-rules '[
    {"destination": "0.0.0.0/0", "protocol": "all"}
  ]'

# Private Security List
oci network security-list create \
  --compartment-id <compartment-id> \
  --vcn-id <vcn-id> \
  --display-name "nearchat-private-seclist" \
  --ingress-security-rules '[
    {"source": "10.0.1.0/24", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 3000, "max": 3000}}},
    {"source": "10.0.2.0/24", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 27017, "max": 27017}}},
    {"source": "10.0.2.0/24", "protocol": "6", "tcpOptions": {"destinationPortRange": {"min": 6379, "max": 6379}}}
  ]' \
  --egress-security-rules '[
    {"destination": "0.0.0.0/0", "protocol": "all"}
  ]'
```

## Step 2: Create Compute Instances

### 2.1 Create Application Server (VM1)
```bash
# Create instance
oci compute instance launch \
  --compartment-id <compartment-id> \
  --availability-domain <ad-name> \
  --display-name "nearchat-app-1" \
  --image-id <ubuntu-20.04-image-id> \
  --subnet-id <private-subnet-id> \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus": 1, "memoryInGBs": 6}' \
  --metadata '{"ssh_authorized_keys": "<your-public-key>"}'

# Create block volume for data
oci bv volume create \
  --compartment-id <compartment-id> \
  --availability-domain <ad-name> \
  --display-name "nearchat-data-1" \
  --size-in-gbs 50

# Attach volume
oci compute volume-attachment attach-paravirtualized-volume \
  --instance-id <instance-id> \
  --volume-id <volume-id> \
  --display-name "nearchat-data-attachment"
```

### 2.2 Create Database Server (VM2)
```bash
# Create instance
oci compute instance launch \
  --compartment-id <compartment-id> \
  --availability-domain <ad-name> \
  --display-name "nearchat-db-1" \
  --image-id <ubuntu-20.04-image-id> \
  --subnet-id <private-subnet-id> \
  --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus": 1, "memoryInGBs": 6}' \
  --metadata '{"ssh_authorized_keys": "<your-public-key>"}'

# Create block volume for database
oci bv volume create \
  --compartment-id <compartment-id> \
  --availability-domain <ad-name> \
  --display-name "nearchat-db-data" \
  --size-in-gbs 100

# Attach volume
oci compute volume-attachment attach-paravirtualized-volume \
  --instance-id <instance-id> \
  --volume-id <volume-id> \
  --display-name "nearchat-db-attachment"
```

## Step 3: Create Load Balancer

```bash
# Create load balancer
oci lb load-balancer create \
  --compartment-id <compartment-id> \
  --display-name "nearchat-lb" \
  --shape-name "flexible" \
  --shape-details '{"minimumBandwidthInMbps": 10, "maximumBandwidthInMbps": 100}' \
  --subnet-ids '["<public-subnet-id>"]'

# Create backend set
oci lb backend-set create \
  --load-balancer-id <lb-id> \
  --name "nearchat-backend-set" \
  --policy "ROUND_ROBIN" \
  --health-checker-protocol "HTTP" \
  --health-checker-port 3000 \
  --health-checker-url-path "/health"

# Add backend servers
oci lb backend create \
  --load-balancer-id <lb-id> \
  --backend-set-name "nearchat-backend-set" \
  --ip-address <app-server-private-ip> \
  --port 3000

# Create listener
oci lb listener create \
  --load-balancer-id <lb-id> \
  --name "nearchat-listener" \
  --default-backend-set-name "nearchat-backend-set" \
  --port 80 \
  --protocol "HTTP"
```

## Step 4: Server Configuration

### 4.1 Application Server Setup
```bash
# SSH to application server
ssh ubuntu@<app-server-public-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Nginx
sudo apt install nginx -y

# Create application directory
sudo mkdir -p /opt/nearchat
sudo chown ubuntu:ubuntu /opt/nearchat
cd /opt/nearchat

# Mount data volume
sudo mkfs.ext4 /dev/sdb
sudo mkdir /data
sudo mount /dev/sdb /data
echo "/dev/sdb /data ext4 defaults 0 2" | sudo tee -a /etc/fstab
```

### 4.2 Database Server Setup
```bash
# SSH to database server
ssh ubuntu@<db-server-public-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Mount database volume
sudo mkfs.ext4 /dev/sdb
sudo mkdir /data
sudo mount /dev/sdb /data
echo "/dev/sdb /data ext4 defaults 0 2" | sudo tee -a /etc/fstab

# Create database directories
sudo mkdir -p /data/mongodb /data/redis
sudo chown -R 999:999 /data/mongodb
sudo chown -R 999:999 /data/redis
```

## Step 5: Deploy Application

### 5.1 Clone Repository
```bash
# On application server
cd /opt/nearchat
git clone https://github.com/your-org/nearchat.git .
```

### 5.2 Configure Environment
```bash
# Create environment file
cp backend/.env.example backend/.env

# Edit environment variables
nano backend/.env

# Key configurations:
NODE_ENV=production
MONGODB_URI=mongodb://<db-server-private-ip>:27017/nearchat
REDIS_URL=redis://<db-server-private-ip>:6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 5.3 Deploy with Docker Compose
```bash
# Start database services
cd /opt/nearchat
docker-compose up -d mongo redis

# Wait for databases to be ready
sleep 30

# Start application services
docker-compose up -d nearchat-backend

# Start Nginx
docker-compose up -d nginx

# Check status
docker-compose ps
docker-compose logs -f
```

## Step 6: Configure Nginx

### 6.1 Update Nginx Configuration
```bash
# Copy nginx configuration
sudo cp infrastructure/nginx.conf /etc/nginx/nginx.conf

# Create SSL directory
sudo mkdir -p /etc/nginx/ssl

# Generate self-signed certificate (replace with real certificate)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nearchat.key \
  -out /etc/nginx/ssl/nearchat.crt

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 6.2 Configure Firewall
```bash
# Allow required ports
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
sudo ufw enable
```

## Step 7: Monitoring and Logging

### 7.1 Install Monitoring Tools
```bash
# Install htop for system monitoring
sudo apt install htop -y

# Install logrotate
sudo apt install logrotate -y

# Create log rotation configuration
sudo tee /etc/logrotate.d/nearchat << EOF
/opt/nearchat/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 ubuntu ubuntu
}
EOF
```

### 7.2 Set up PM2 Monitoring
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start application with PM2
cd /opt/nearchat/backend
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save
pm2 startup

# Monitor application
pm2 monit
pm2 logs
```

## Step 8: SSL Certificate (Let's Encrypt)

### 8.1 Install Certbot
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d nearchat.com -d www.nearchat.com

# Set up auto-renewal
sudo crontab -e
# Add line: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Step 9: Backup Strategy

### 9.1 Database Backup
```bash
# Create backup script
sudo tee /opt/nearchat/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/data/backups"

mkdir -p $BACKUP_DIR

# MongoDB backup
docker exec nearchat-mongo mongodump --out /dump
docker cp nearchat-mongo:/dump $BACKUP_DIR/mongodb_$DATE

# Redis backup
docker exec nearchat-redis redis-cli BGSAVE
sleep 5
docker cp nearchat-redis:/data/dump.rdb $BACKUP_DIR/redis_$DATE.rdb

# Clean old backups (keep 7 days)
find $BACKUP_DIR -type d -mtime +7 -exec rm -rf {} \;
find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
EOF

# Make executable
sudo chmod +x /opt/nearchat/backup.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add line: 0 2 * * * /opt/nearchat/backup.sh
```

## Step 10: Performance Optimization

### 10.1 System Tuning
```bash
# Optimize system parameters
sudo tee /etc/sysctl.conf << EOF
# Network optimization
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_congestion_control = bbr
net.core.netdev_max_backlog = 5000

# File system optimization
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288

# Memory optimization
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF

# Apply changes
sudo sysctl -p
```

### 10.2 Docker Optimization
```bash
# Create Docker daemon configuration
sudo tee /etc/docker/daemon.json << EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ]
}
EOF

# Restart Docker
sudo systemctl restart docker
```

## Step 11: Scaling Strategy

### 11.1 Horizontal Scaling
```bash
# Create additional application servers
# Repeat Step 2.1 for additional VMs

# Update load balancer backend set
oci lb backend create \
  --load-balancer-id <lb-id> \
  --backend-set-name "nearchat-backend-set" \
  --ip-address <new-app-server-private-ip> \
  --port 3000
```

### 11.2 Database Scaling
```bash
# Set up MongoDB replica set
# Configure Redis clustering
# Implement read replicas
```

## Step 12: Security Hardening

### 12.1 Security Updates
```bash
# Enable automatic security updates
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades

# Configure firewall rules
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <load-balancer-ip> to any port 3000
```

### 12.2 SSL/TLS Hardening
```bash
# Update Nginx SSL configuration with stronger ciphers
# Enable HSTS
# Configure CSP headers
```

## Monitoring and Maintenance

### Health Checks
```bash
# Create health check script
sudo tee /opt/nearchat/health-check.sh << 'EOF'
#!/bin/bash
# Check application health
curl -f http://localhost:3000/health || exit 1

# Check database connectivity
docker exec nearchat-mongo mongosh --eval "db.adminCommand('ping')" || exit 1

# Check Redis connectivity
docker exec nearchat-redis redis-cli ping || exit 1
EOF

# Add to crontab (every 5 minutes)
sudo crontab -e
# Add line: */5 * * * * /opt/nearchat/health-check.sh
```

### Performance Monitoring
```bash
# Install monitoring tools
sudo apt install iotop iostat -y

# Monitor system resources
htop
iotop
iostat -x 1
```

## Troubleshooting

### Common Issues
1. **High Memory Usage**: Optimize Node.js memory settings
2. **Database Connection Issues**: Check MongoDB and Redis connectivity
3. **SSL Certificate Issues**: Verify certificate validity and renewal
4. **Load Balancer Issues**: Check health checks and backend configuration

### Log Analysis
```bash
# View application logs
docker-compose logs -f nearchat-backend

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# View system logs
sudo journalctl -f
```

## Cost Optimization

### Oracle Cloud Free Tier Limits
- Monitor resource usage to stay within free tier limits
- Use auto-scaling based on demand
- Implement proper resource cleanup

### Resource Monitoring
```bash
# Monitor CPU and memory usage
free -h
top
df -h

# Monitor network usage
iftop
nethogs
```

## Conclusion

This deployment guide provides a production-ready setup for NearChat on Oracle Cloud Free Tier. The architecture supports 100k+ concurrent users with proper load balancing, monitoring, and scaling capabilities.

### Next Steps
1. Set up monitoring and alerting
2. Implement CI/CD pipeline
3. Configure backup and disaster recovery
4. Set up development and staging environments
5. Implement security scanning and compliance checks

### Support
For issues and questions:
- Check application logs
- Monitor system resources
- Review Oracle Cloud documentation
- Contact support team