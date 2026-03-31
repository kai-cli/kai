# IP Address Reconnaissance Workflow

## Network Information

### IP Details
- **IP Address:** 1.2.3.4
- **IP Type:** IPv4 Public
- **Reverse DNS:** server.example.com
- **Hostname Verified:** ✅ Forward/reverse match

### Geolocation
- **City:** San Francisco
- **Region:** California
- **Country:** United States (US)
- **Coordinates:** 37.7749, -122.4194
- **Postal Code:** 94102
- **Timezone:** America/Los_Angeles (PST/PDT)

### Network Ownership
- **Organization:** Example Hosting Inc
- **ASN:** AS12345
- **ASN Name:** EXAMPLE-HOSTING
- **Provider Type:** Hosting/Data Center
- **CIDR Block:** 1.2.3.0/24
- **NetRange:** 1.2.3.0 - 1.2.3.255
- **Total IPs in Block:** 256

### Contact Information
- **Abuse Email:** abuse@examplehosting.com
- **Abuse Phone:** +1-415-555-0100
- **Technical Contact:** noc@examplehosting.com
- **Organization URL:** examplehosting.com

### Privacy & Proxy Detection
- **VPN:** ❌ No
- **Proxy:** ❌ No
- **Tor Exit Node:** ❌ No
- **Hosting:** ✅ Yes (Data Center IP)
- **Relay:** ❌ No

---

## Associated Domains & Certificates

### Domains Hosted on This IP
1. example.com
2. www.example.com
3. api.example.com
4. mail.example.com

### Certificate Information
**Current Certificate:**
- **Common Name (CN):** example.com
- **Subject Alternative Names (SANs):**
  - example.com
  - www.example.com
  - api.example.com
  - (15 total domains)
- **Issuer:** Let's Encrypt Authority X3
- **Valid From:** 2025-10-15
- **Valid To:** 2026-01-15 (85 days remaining)
- **Serial:** 04:3f:8a:... [truncated]
- **Signature Algorithm:** SHA256-RSA

**Historical Certificates:** 8 previous certificates found
- Previous issuer: DigiCert (2020-2025)
- Migration to Let's Encrypt observed October 2025

---

## Services & Ports (Active Scan)

### Open Ports
| Port | Service | State | Version |
|------|---------|-------|---------|
| 22   | SSH     | Open  | OpenSSH 8.2p1 Ubuntu |
| 80   | HTTP    | Open  | nginx 1.20.1 |
| 443  | HTTPS   | Open  | nginx 1.20.1 |

### Closed/Filtered Ports
- 21 (FTP): Closed
- 25 (SMTP): Filtered
- 3306 (MySQL): Closed
- 5432 (PostgreSQL): Closed

### Service Details

**SSH (Port 22)**
- Banner: `SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.5`
- Version: OpenSSH 8.2p1
- OS Hint: Ubuntu Linux
- Authentication: publickey,password

**HTTP (Port 80)**
- Status: 301 Moved Permanently
- Server: nginx/1.20.1
- Redirect: https://example.com/
- Headers: [see below]

**HTTPS (Port 443)**
- Status: 200 OK
- Server: nginx/1.20.1
- Title: Example Website - Home
- Content-Type: text/html; charset=UTF-8
- Headers: [see below]

---

## HTTP/HTTPS Analysis

### HTTP Headers
```
Server: nginx/1.20.1
Date: Mon, 11 Nov 2025 12:30:00 GMT
Content-Type: text/html; charset=UTF-8
Connection: keep-alive
X-Powered-By: PHP/8.1.12
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000
```

### Technology Stack
- **Web Server:** nginx 1.20.1
- **Backend:** PHP 8.1.12
- **Framework:** Laravel (detected via headers/cookies)
- **CDN:** Cloudflare (detected)
- **Analytics:** Google Analytics
- **Security Headers:** Partial (missing CSP)

### Security Headers Assessment
- ✅ X-Frame-Options: SAMEORIGIN
- ✅ X-Content-Type-Options: nosniff
- ✅ Strict-Transport-Security: Present (HSTS)
- ⚠️ Content-Security-Policy: Missing
- ⚠️ X-XSS-Protection: Not set (deprecated but still used)
- ✅ Referrer-Policy: Implicitly strict

---

## SSL/TLS Configuration

### TLS Versions Supported
- ✅ TLS 1.3
- ✅ TLS 1.2
- ❌ TLS 1.1 (disabled)
- ❌ TLS 1.0 (disabled)
- ❌ SSL 3.0 (disabled)
- ❌ SSL 2.0 (disabled)

### Cipher Suites (TLS 1.3)
- TLS_AES_256_GCM_SHA384
- TLS_CHACHA20_POLY1305_SHA256
- TLS_AES_128_GCM_SHA256

### Cipher Suites (TLS 1.2)
- ECDHE-RSA-AES256-GCM-SHA384
- ECDHE-RSA-AES128-GCM-SHA256
- ECDHE-RSA-CHACHA20-POLY1305

### TLS Security Assessment
- ✅ Modern TLS only (1.2+)
- ✅ Strong cipher suites
- ✅ Forward secrecy (ECDHE)
- ✅ No known vulnerabilities
- **Grade:** A (Strong)

---

## Related Infrastructure

### Same Netblock IPs
**Sampled IPs in 1.2.3.0/24:**
- 1.2.3.1 - gateway.example.com (Router)
- 1.2.3.2 - ns1.example.com (DNS Server)
- 1.2.3.4 - **TARGET** server.example.com
- 1.2.3.10 - mail.example.com (Mail Server)
- 1.2.3.50 - db.example.com (Database Server)

All belong to same organization (Example Hosting Inc)

### ASN Prefixes (AS12345)
- 1.2.3.0/24
- 5.6.7.0/24
- 10.20.30.0/24
- **Total:** 15 IPv4 prefixes, 3 IPv6 prefixes

---

## Historical Data

### DNS History
- IP has hosted example.com since 2020-03-15
- Previous IP for example.com: 9.10.11.12 (2015-2020)
- Migration observed March 2020

### Certificate History
- 8 certificates issued for this IP since 2020
- Issuer change: DigiCert → Let's Encrypt (Oct 2025)
- No expired/revoked certificates found

---

## Risk Assessment

### Indicators
- ✅ Legitimate hosting provider (Example Hosting Inc)
- ✅ Clean IP reputation (no blocklists)
- ✅ Valid SSL certificate
- ✅ Modern security configurations
- ⚠️ Database server in same subnet (1.2.3.50)
- ⚠️ Multiple services on single IP (segmentation)

### Security Observations
1. **Positive:**
   - Strong TLS configuration
   - Security headers present
   - Updated software (nginx 1.20.1, PHP 8.1)
   - HSTS enabled

2. **Areas for Improvement:**
   - Missing Content-Security-Policy header
   - Database server discoverable in same subnet
   - Consider service segmentation across IPs

3. **Suspicious Indicators:** None detected

### Threat Intelligence
- **Blocklist Status:** Not listed on any major blocklists
- **Malware Associations:** None found
- **Spam Reports:** None found
- **Abuse Reports:** None found
- **Reputation:** Clean

---

## Recommendations

### Immediate Actions
None required - IP appears legitimate with good security posture

### Further Investigation (if authorized)
1. **Web Application Testing:**
   - Test example.com, api.example.com for vulnerabilities
   - Assess authentication mechanisms
   - Check for common web vulnerabilities (XSS, SQLi, CSRF)

2. **Infrastructure Mapping:**
   - Enumerate all 256 IPs in 1.2.3.0/24 netblock
   - Identify critical infrastructure (db.example.com)
   - Map network segmentation

3. **Monitoring:**
   - Watch for certificate changes
   - Monitor DNS record modifications
   - Track new subdomains via cert transparency

### Security Hardening (if owned asset)
1. Add Content-Security-Policy header
2. Consider IP-based service segmentation
3. Review database server exposure (1.2.3.50)
4. Implement network-level access controls

---

## Raw Data

### IPInfo JSON
```json
[Full IPInfo response here]
```

### WHOIS Output
```
[Full WHOIS output here]
```

### Port Scan Results
```
[Full naabu output here]
```

---

**Report End**

**Tools Used:**
- IPInfo API
- whois
- dig
- crt.sh
- naabu (port scan)
- httpx (service detection)
- openssl (SSL analysis)

**Authorization:** Active reconnaissance authorized - Pentest Engagement SOW-2025-11-01

**Analyst:** {DAIDENTITY.NAME} (recon skill)
```

## Integration Examples

### Called by domain-recon

```typescript
// domain-recon discovers IPs
const ips = await getDomainIPs("example.com");

// For each IP, call ip-recon
for (const ip of ips) {
  const ipReport = await ipRecon(ip, { passive: true });
  domainReport.infrastructure.push(ipReport);
}
```

### Called by OSINT

```typescript
// OSINT finds company infrastructure
const company = await osintInvestigate("Acme Corp");

// Recon all discovered IPs
for (const ip of company.ipAddresses) {
  const ipReport = await ipRecon(ip);
  company.technicalIntel.push(ipReport);
}
```

### Calling webassessment

```typescript
// After ip-recon finds web services
if (ipReport.ports.includes(80) || ipReport.ports.includes(443)) {
  const webApps = ipReport.domains;

  if (authorized) {
    await webAssessment(webApps);
  }
}
```

## Success Criteria

### Passive Recon Complete
- ✅ IPInfo data retrieved
- ✅ Reverse DNS checked
- ✅ WHOIS netblock info gathered
- ✅ Certificate search performed
- ✅ Related IPs identified
- ✅ Report generated

### Active Recon Complete (if authorized)
- ✅ Authorization documented
- ✅ Port scan completed
- ✅ Service detection performed
- ✅ Technology fingerprinting done
- ✅ SSL/TLS analyzed
- ✅ Security assessment included
- ✅ No DoS or destructive techniques used

---

**Key Principle:** Always start passive. Only go active with explicit authorization and documentation.
