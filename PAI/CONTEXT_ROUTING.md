# Context Routing

Load context on-demand by reading the file at the path listed. Only load what the current task requires.

## PAI System

| Topic | Path |
|-------|------|
| PAI system overview | `PAI/README.md` |
| System architecture | `PAI/PAISYSTEMARCHITECTURE.md` |
| Memory system | `PAI/MEMORYSYSTEM.md` |
| Skill system | `PAI/SKILLSYSTEM.md` |
| Hook system | `PAI/THEHOOKSYSTEM.md` |
| Agent system | `PAI/PAIAGENTSYSTEM.md` |
| Delegation system | `PAI/THEDELEGATIONSYSTEM.md` |
| Notification system | `PAI/THENOTIFICATIONSYSTEM.md` |
| CLI architecture | `PAI/CLIFIRSTARCHITECTURE.md` |
| Tools reference | `PAI/TOOLS.md` |
| Actions & pipelines | `PAI/ACTIONS.md`, `PAI/PIPELINES.md` |
| Flows | `PAI/FLOWS.md` |
| Behavioral rules | `PAI/AISTEERINGRULES.md` |
| PRD format spec | `PAI/PRDFORMAT.md` |

## {PRINCIPAL.NAME} — Personal Context

| Topic | Path |
|-------|------|
| All USER context index | `PAI/USER/README.md` |
| Projects registry | `PAI/USER/PROJECTS/PROJECTS.md` |
| Business context | `PAI/USER/BUSINESS/README.md` |
| Telos (life goals) | `PAI/USER/TELOS/README.md` |

## Your Company / Firmware — Local Knowledge (CHECK FIRST before web research)

| Topic | Path |
|-------|------|
| **Knowledge base index** | `~/Projects/Knowledge/INDEX.md` |
| Firmware index | `~/Projects/Knowledge/firmware/INDEX.md` |
| Standards index | `~/Projects/Knowledge/standards/INDEX.md` |
| GitHub reference index | `~/Projects/Knowledge/github/INDEX.md` |
| Releases index | `~/Projects/Knowledge/releases/INDEX.md` |
| Security tools index | `~/Projects/Knowledge/security-tools/INDEX.md` |
| AI infrastructure index | `~/Projects/Knowledge/ai-infrastructure/INDEX.md` |
| Speedtest architecture | `~/Projects/Knowledge/firmware/speedtest/architecture/` |
| Speedtest implementation | `~/Projects/Knowledge/firmware/speedtest/implementation/` |
| Build system configs | `~/Projects/Learning_Your Company_Repo/targets/` |
| Customer preconfigs | `~/Projects/Learning_Your Company_Repo/targets/config/preconfig/` |
| **3rd-party vendor docs** | `gh api repos/your-company/FWDEV/contents/docs/3rd%20party/` |
| Product bugs / issues | `gh issue list --repo your-company/Your CompanyWRT` |
| FW dev tasks | `gh issue list --repo your-company/FWDEV` |
| Product management | `gh issue list --repo your-company/PRODUCT_MANAGEMENT` |
| **OpenWRT project agents** | `~/.claude/custom-agents/OpenWRT-*.md` (9 domain agents) |
| TR-069/TR-369 knowledge base | `~/Projects/TR-069_TR-369/tr-repo/` (24 files) |
| DU certification tracking | `~/Projects/Du_tracking/` (deliverables, issues, ATP docs) |

## Cross-Project Memory (accumulated knowledge from other project sessions)

Knowledge accumulated in one project's memory is available to all projects via these paths. Read on-demand when context is needed — not auto-injected.

**Shorthand:** `{MEM}` = `~/.claude/projects/-Users-user-Projects-`

### Learning-Your Company-Repo (17 files — deepest firmware knowledge)

| Topic | Path |
|-------|------|
| **Firmware build system index** | `{MEM}Learning-Your Company-Repo/memory/MEMORY.md` |
| Repo architecture & orgs | `{MEM}Learning-Your Company-Repo/memory/architecture-repo.md` |
| Build system (unified) | `{MEM}Learning-Your Company-Repo/memory/build-system.md` |
| Firmware builds (types, branches) | `{MEM}Learning-Your Company-Repo/memory/firmware-builds.md` |
| Unified build system (PR #48) | `{MEM}Learning-Your Company-Repo/memory/unified-build-system.md` |
| JNAP API (core router API) | `{MEM}Learning-Your Company-Repo/memory/jnap-api.md` |
| sysctx.lua (UCI abstraction) | `{MEM}Learning-Your Company-Repo/memory/sysctxlua.md` |
| Jenkins CI/CD | `{MEM}Learning-Your Company-Repo/memory/jenkins.md` |
| SDK patches (156+ catalog) | `{MEM}Learning-Your Company-Repo/memory/sdk-patches.md` |
| feed_your-company (60 packages) | `{MEM}Learning-Your Company-Repo/memory/feed-your-company.md` |
| feed_bbf (TR-069/TR-369) | `{MEM}Learning-Your Company-Repo/memory/feed-bbf.md` |
| CBT feed (CyberTan ODM) | `{MEM}Learning-Your Company-Repo/memory/cbt-feed.md` |
| Thirdparty/hardware feeds | `{MEM}Learning-Your Company-Repo/memory/thirdparty-hardware-feeds.md` |
| UI pipeline (Flutter/React) | `{MEM}Learning-Your Company-Repo/memory/ui-pipeline.md` |
| DevOps (Jenkins, Docker, ECS) | `{MEM}Learning-Your Company-Repo/memory/lswf-devops.md` |
| Your CompanyWRT issues | `{MEM}Learning-Your Company-Repo/memory/your-companywrt-issues.md` |
| Full repo classification | `{MEM}Learning-Your Company-Repo/memory/repo-index.md` |
| **DU certification status** | `{MEM}Learning-Your Company-Repo/memory/project_du_certification.md` |

### WiFi-Troubleshooter (8 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}WiFi-Troubleshooter/memory/MEMORY.md` |
| Firmware architecture notes | `{MEM}WiFi-Troubleshooter/memory/feedback_fw_architecture.md` |
| Instant test PRD | `{MEM}WiFi-Troubleshooter/memory/project_instant_test_prd.md` |
| Architecture audit | `{MEM}WiFi-Troubleshooter/memory/project_architecture_audit.md` |
| Jenkins build reference | `{MEM}WiFi-Troubleshooter/memory/reference_jenkins_build.md` |
| GitHub repos reference | `{MEM}WiFi-Troubleshooter/memory/reference_github_repos.md` |
| Austin dev notes | `{MEM}WiFi-Troubleshooter/memory/reference_austin_dev_notes.md` |

### Research-Agent (4 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}Research-Agent/memory/MEMORY.md` |
| OpenWRT agent architecture | `{MEM}Research-Agent/memory/project_agent_architecture.md` |
| Device access tooling | `{MEM}Research-Agent/memory/project_device_access.md` |
| Knowledge sources reference | `{MEM}Research-Agent/memory/reference_knowledge_sources.md` |

### TR-069-TR-369 (2 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}TR-069-TR-369/memory/MEMORY.md` |
| Pinnacle platform context | `{MEM}TR-069-TR-369/memory/project_pinnacle_platform.md` |

### Steadfast (6 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}Steadfast/memory/MEMORY.md` |
| Project context | `{MEM}Steadfast/memory/project_steadfast.md` |
| Launch readiness | `{MEM}Steadfast/memory/project_launch_readiness.md` |

### AIrouter (3 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}AIrouter/memory/MEMORY.md` |
| AI router MSDM project | `{MEM}AIrouter/memory/project_ai_router_msdm.md` |

### pai-config (3 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}pai-config/memory/MEMORY.md` |
| Quality over tokens feedback | `{MEM}pai-config/memory/feedback_algorithm_quality_over_tokens.md` |
| Memory system overhaul project | `{MEM}pai-config/memory/project_memory_system_overhaul.md` |
