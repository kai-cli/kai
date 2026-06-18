# FirmwareBuildSearch Workflow

Search Jenkins build artifacts, OpenWrt package feeds, and linksys-mcp build tools.

## Steps

1. Use `mcp__jenkins__jenkins_build_status` to query recent builds for the relevant branch
2. Use `mcp__build__build_package_check` to verify package availability
3. Cross-reference with `~/Projects/Linksys-Wiki/` for known build issues
4. Summarize findings with build numbers and artifact links
