# Passive Reconnaissance Workflow

**Report Generated:** 2025-11-11 04:15:00 PST
**Methodology:** Passive reconnaissance only (no target interaction)
**Tools Used:** WHOIS, dig, crt.sh, IPInfo API
**Authorization:** Not required for passive techniques
```

## Integration Points

### Called by OSINT

```typescript
// OSINT discovers company
const company = await osintInvestigate("Acme Corp");

// Calls passive recon on discovered domains
for (const domain of company.domains) {
  const reconReport = await passiveRecon(domain);
  company.infrastructure.push(reconReport);
}
```

### Calls webassessment

```typescript
// After passive recon discovers subdomains
const interestingSubdomains = report.subdomains.filter(s =>
  s.includes('admin') ||
  s.includes('api') ||
  s.includes('internal')
);

// Can pass to web assessment (with authorization)
if (authorized) {
  await webAssessment(interestingSubdomains);
}
```

## Best Practices

**Data Collection:**
1. Start broad (WHOIS, DNS)
2. Discover assets (cert transparency, IPInfo)
3. Map relationships (ASN, netblocks, reverse DNS)
4. Compile comprehensive view

**Stealth Considerations:**
- Even passive recon can be logged (WHOIS queries, DNS lookups)
- Use VPN if stealth required
- Space out queries to avoid pattern detection
- Some passive sources rate-limit (respect limits)

**Documentation:**
- Save all raw output (WHOIS, dig, curl responses)
- Timestamp all findings
- Note data sources
- Preserve for future comparison

**Legal:**
- Passive recon is generally legal (public data)
- Still respect ToS of data sources
- Don't abuse APIs or scrape aggressively
- Be aware some jurisdictions may have restrictions

## Troubleshooting

**WHOIS not returning data:**
- Try different WHOIS servers
- Some registrars privacy-protect aggressively
- Use RDAP (successor to WHOIS) for some TLDs

**DNS queries timing out:**
- Check DNS resolver configuration
- Try different DNS servers (8.8.8.8, 1.1.1.1)
- Target may have aggressive rate limiting

**Certificate transparency no results:**
- Domain may be very new
- May not have TLS certificate
- Try alternate CT log search tools

**IPInfo rate limits:**
- Check API plan limits
- Implement request throttling
- Use batch API for multiple IPs

## Success Criteria

**Minimum viable recon:**
- ✅ WHOIS data retrieved
- ✅ Core DNS records enumerated (A, MX, NS)
- ✅ At least one IP address identified
- ✅ ASN determined
- ✅ Report generated

**Comprehensive recon:**
- ✅ All DNS record types queried
- ✅ Certificate transparency searched
- ✅ All subdomains enumerated
- ✅ All IPs analyzed with IPInfo
- ✅ Email security assessed
- ✅ Netblock ownership mapped
- ✅ ASN relationships documented
- ✅ Recommendations generated
- ✅ Report saved to scratchpad or history

---

**Remember:** Passive recon is about gathering intelligence without touching the target. If you need to send packets to the target, that's active recon and requires authorization.
