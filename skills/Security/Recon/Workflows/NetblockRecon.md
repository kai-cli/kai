# Netblock Reconnaissance Workflow

## Network Block Information

### CIDR Details
- **Network:** 192.168.1.0/24
- **First IP:** 192.168.1.1
- **Last IP:** 192.168.1.254
- **Broadcast:** 192.168.1.255
- **Mask:** /24 (255.255.255.0)
- **Total Addresses:** 256
- **Usable Addresses:** 254

### Ownership (WHOIS)
- **Organization:** Example Corporation
- **ASN:** AS54321
- **NetRange:** 192.168.0.0 - 192.168.15.255
- **CIDR Blocks:** 192.168.0.0/20
- **Allocation Date:** 2015-03-20
- **Country:** United States
- **State:** California

### Contact Information
- **Abuse Email:** abuse@example.com
- **Abuse Phone:** +1-555-0100
- **NOC Email:** noc@example.com
- **Technical Contact:** netops@example.com

---

## Sample IP Analysis (Passive)

### Sample IP: 192.168.1.1
- **Reverse DNS:** gateway.example.com
- **Type:** Gateway/Router (inferred)
- **Organization:** Example Corporation
- **Location:** San Francisco, CA

### Sample IP: 192.168.1.10
- **Reverse DNS:** mail.example.com
- **Type:** Mail Server
- **Services (passive):** SMTP (inferred from DNS)

### Sample IP: 192.168.1.50
- **Reverse DNS:** db-01.example.com
- **Type:** Database Server
- **Services (passive):** Database (inferred from hostname)

### Sample IP: 192.168.1.100
- **Reverse DNS:** web-prod-01.example.com
- **Type:** Web Server
- **Services (passive):** HTTP/HTTPS (inferred)

---

## Live Host Discovery (Active Scan)

### Discovery Summary
- **Total IPs Scanned:** 254
- **Live Hosts Found:** 47
- **Utilization Rate:** 18.5%
- **Response Times:** 0.1ms - 50ms (all local network)

### Live Hosts by IP Range
- **192.168.1.1-10:** 10 hosts (100% - Infrastructure)
- **192.168.1.11-50:** 15 hosts (37.5% - Servers)
- **192.168.1.51-100:** 12 hosts (24% - Mixed)
- **192.168.1.101-200:** 8 hosts (8% - Workstations)
- **192.168.1.201-254:** 2 hosts (3.7% - Printers/IoT)

### Categorized Hosts

**Infrastructure (10 hosts):**
- 192.168.1.1 - gateway.example.com (Router)
- 192.168.1.2 - fw-01.example.com (Firewall)
- 192.168.1.3 - fw-02.example.com (Firewall)
- 192.168.1.5 - switch-core-01.example.com (Switch)
- 192.168.1.10 - dns-01.example.com (DNS Server)
- [... 5 more]

**Servers (15 hosts):**
- 192.168.1.20 - mail-01.example.com (Mail Server)
- 192.168.1.25 - web-prod-01.example.com (Web Server)
- 192.168.1.26 - web-prod-02.example.com (Web Server)
- 192.168.1.30 - api-prod-01.example.com (API Server)
- 192.168.1.50 - db-01.example.com (Database Server)
- 192.168.1.51 - db-02.example.com (Database Server)
- 192.168.1.60 - app-01.example.com (Application Server)
- [... 8 more]

**Workstations (12 hosts):**
- 192.168.1.101-112 (Developer workstations - inferred)

**IoT/Other (2 hosts):**
- 192.168.1.250 - printer-01.example.com
- 192.168.1.251 - printer-02.example.com

**Unknown/No rDNS (8 hosts):**
- 192.168.1.75, 192.168.1.80, ... (no reverse DNS)

---

## Port Scan Results

### Top Open Ports Across Range
| Port | Service | Count | % of Live Hosts |
|------|---------|-------|-----------------|
| 22 | SSH | 42 | 89.4% |
| 80 | HTTP | 18 | 38.3% |
| 443 | HTTPS | 18 | 38.3% |
| 3306 | MySQL | 2 | 4.3% |
| 5432 | PostgreSQL | 2 | 4.3% |
| 25 | SMTP | 1 | 2.1% |
| 53 | DNS | 1 | 2.1% |

### Hosts by Port Count
- **1-3 open ports:** 20 hosts (likely workstations)
- **4-10 open ports:** 15 hosts (likely servers)
- **11+ open ports:** 12 hosts (infrastructure devices)

### Interesting Services

**Database Servers:**
- 192.168.1.50:3306 (MySQL)
- 192.168.1.51:3306 (MySQL)
- 192.168.1.55:5432 (PostgreSQL)

**Web Servers:**
- 192.168.1.25:80,443 (nginx 1.20.1)
- 192.168.1.26:80,443 (nginx 1.20.1)

**Mail Server:**
- 192.168.1.20:25,587,993,995 (Postfix, Dovecot)

---

## Service Detection

### Web Applications
**Total:** 18 HTTP/HTTPS services

| Host | URL | Status | Server | Title |
|------|-----|--------|--------|-------|
| 192.168.1.25 | https://192.168.1.25 | 200 | nginx/1.20.1 | Example Production |
| 192.168.1.26 | https://192.168.1.26 | 200 | nginx/1.20.1 | Example Production |
| 192.168.1.30 | https://192.168.1.30 | 401 | Express.js | API Unauthorized |

### SSH Banners
**OpenSSH Versions:**
- OpenSSH 8.2p1 Ubuntu: 30 hosts
- OpenSSH 7.9p1 Debian: 10 hosts
- OpenSSH 9.0p1 Ubuntu: 2 hosts

**Observation:** Mix of SSH versions - potential patching inconsistency

---

## Network Segmentation Analysis

### Observed Patterns

**Subnet Organization:**
- .1-.10: Infrastructure (routers, firewalls, DNS)
- .11-.50: Production servers
- .51-.100: Databases and backend services
- .101-.200: Workstations
- .201-.254: IoT devices and printers

**Segmentation Assessment:**
- ⚠️ **Poor Segmentation:** All devices in single /24
- ⚠️ **Security Concern:** Databases accessible from workstation range
- ✅ **Logical Organization:** IP assignment follows pattern

**Recommendations:**
1. Implement VLANs to separate:
   - Production servers (/25)
   - Databases (/26 with strict ACLs)
   - Workstations (/25)
   - Guest/IoT (/26)

2. Apply firewall rules:
   - Database access only from application tier
   - Workstations cannot reach production directly
   - Segment by function, not just IP range

---

## Security Observations

### Positive Indicators
- ✅ SSH enabled on most systems (remote management)
- ✅ HTTPS used on web services
- ✅ Consistent naming convention (aids management)

### Security Concerns
⚠️ **High Priority:**
1. **Database Exposure:** MySQL/PostgreSQL accessible from workstation range
2. **Flat Network:** No network segmentation (single broadcast domain)
3. **SSH Version Mix:** Inconsistent patching (security risk)
4. **Unknown Hosts:** 8 hosts without rDNS (shadow IT?)

⚠️ **Medium Priority:**
1. **IoT Devices:** Printers on same network as production
2. **No Apparent Monitoring:** No IDS/IPS detected
3. **Reverse DNS:** Not all hosts have rDNS entries

---

## Recommendations

### Immediate Actions
1. **Network Segmentation:**
   - Implement VLANs for production, databases, workstations
   - Apply strict firewall rules between segments
   - Isolate IoT devices on separate network

2. **Database Security:**
   - Move databases to isolated VLAN
   - Restrict access to application tier only
   - Implement bastion hosts for admin access

3. **Patch Management:**
   - Standardize SSH versions
   - Create patching schedule
   - Prioritize internet-facing systems

4. **Asset Inventory:**
   - Identify 8 unknown hosts (no rDNS)
   - Create CMDB (Configuration Management Database)
   - Implement IPAM (IP Address Management)

### Further Investigation (if authorized)
1. **Vulnerability Scanning:**
   - Run Nessus/OpenVAS on identified systems
   - Focus on database servers and web applications
   - Check for missing patches

2. **Web Application Testing:**
   - Assess 18 web applications for vulnerabilities
   - Test authentication mechanisms
   - Check for OWASP Top 10

3. **Configuration Audits:**
   - Review SSH configurations
   - Check for default credentials
   - Assess service hardening

---

## Tools Used
- whois - Netblock information
- nmap - Host discovery and port scanning
- naabu - Fast port scanning
- httpx - Web service detection
- IPInfo API - IP metadata

**Authorization:** Active reconnaissance authorized - Pentest Engagement SOW-2025-001
**Scan Window:** 2025-11-11 06:00-08:00 PST
**Contact:** security@example.com, +1-555-0199

**Analyst:** {DAIDENTITY.NAME} (recon skill)

**Report End**
```

## Rate Limiting and Respectful Scanning

```typescript
// Implement rate limiting to avoid DoS
async function scanWithRateLimit(
  ips: string[],
  scanFunc: (ip: string) => Promise<any>,
  rateLimit: number = 10 // requests per second
): Promise<any[]> {
  const results = [];
  const delayMs = 1000 / rateLimit;

  for (const ip of ips) {
    const result = await scanFunc(ip);
    results.push(result);

    // Rate limit
    await sleep(delayMs);

    // Progress indication
    if (results.length % 10 === 0) {
      console.log(`Progress: ${results.length}/${ips.length} (${(results.length/ips.length*100).toFixed(1)}%)`);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## Integration Examples

### Called by ip-recon

```typescript
// IP recon discovers this IP is in a netblock
const ipInfo = await ipRecon("192.168.1.50");

// Get the netblock
const netblock = ipInfo.cidr; // "192.168.1.0/24"

// Call netblock recon on the entire range
const netblockReport = await netblockRecon(netblock, { passive: true });
```

### Called by domain-recon

```typescript
// Domain recon discovers multiple IPs in same netblock
const domainIPs = await getDomainIPs("example.com");

// Extract common netblocks
const netblocks = findCommonNetblocks(domainIPs);

// Recon each netblock
for (const netblock of netblocks) {
  await netblockRecon(netblock);
}
```

## Success Criteria

### Passive Recon Complete
- ✅ CIDR parsed and validated
- ✅ WHOIS netblock info retrieved
- ✅ ASN identified
- ✅ Sample IPs investigated
- ✅ BGP prefixes identified
- ✅ Report generated

### Active Recon Complete (if authorized)
- ✅ Authorization documented
- ✅ Live hosts discovered
- ✅ Port scans completed
- ✅ Services detected
- ✅ Patterns identified
- ✅ Rate limiting applied (no DoS)
- ✅ Coordination maintained (if required)

---

**Critical Reminder:** Never scan networks you don't own. Always get written authorization. Respect rate limits. Coordinate with network owners.
