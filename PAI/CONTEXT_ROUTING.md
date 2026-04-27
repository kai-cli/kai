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

## YourCompany / Firmware — Local Knowledge (CHECK FIRST before web research)

| Topic | Path |
|-------|------|
| **Knowledge base index** | `~/Projects/Knowledge/INDEX.md` |
| Firmware index | `~/Projects/Knowledge/firmware/INDEX.md` |
| Standards index | `~/Projects/Knowledge/standards/INDEX.md` |
| GitHub reference index | `~/Projects/Knowledge/github/INDEX.md` |
| Releases index | `~/Projects/Knowledge/releases/INDEX.md` |
| Security tools index | `~/Projects/Knowledge/security-tools/INDEX.md` |
| AI infrastructure index | `~/Projects/Knowledge/ai-infrastructure/INDEX.md` |
| Speedtest reference | `~/Projects/Knowledge/firmware/speedtest/README.md` |
| Build system configs | `~/Projects/Knowledge/firmware/build-system/` |
| **3rd-party vendor docs** | `gh api repos/yourcompany/FWDEV/contents/docs/3rd%20party/` |
| Product bugs / issues | `gh issue list --repo yourcompany/ExampleWRT` |
| FW dev tasks | `gh issue list --repo yourcompany/FWDEV` |
| Product management | `gh issue list --repo yourcompany/ExampleWRT` |
| OpenWRT project agents | See Agents skill (`~/.claude/skills/Agents/`) |
| TR-069/TR-369 knowledge base | `~/Projects/TR-069_TR-369/tr-repo/` (24 files) |
| DU certification tracking | `~/Projects/Du_tracking/` (deliverables, issues, ATP docs) |

## PAI / KAI Development

| Topic | Path |
|-------|------|
| PAI config repo (personal, v4.9.0) | `~/Projects/kai/` |
| KAI public fork (v5.0.0) | `~/Projects/kai/` |
| PAI live installation | `~/.claude/` |
| KAI pre-fork checklist | `{MEM}kai/memory/project_kai_prefork.md` |
| KAI Board (Kanban) | `~/Projects/kai/scripts/board.ts` (localhost:3333) |

## Cross-Project Memory (accumulated knowledge from other project sessions)

Knowledge accumulated in one project's memory is available to all projects via these paths. Read on-demand when context is needed — not auto-injected.

**Shorthand:** `{MEM}` = `~/.claude/projects/-Users-your.name-Projects-`

### Learning-YourCompany-Repo (17 files — deepest firmware knowledge, ARCHIVED project)

| Topic | Path |
|-------|------|
| **Firmware build system index** | `{MEM}Learning-YourCompany-Repo/memory/MEMORY.md` |
| Repo architecture & orgs | `{MEM}Learning-YourCompany-Repo/memory/architecture-repo.md` |
| Build system (unified) | `{MEM}Learning-YourCompany-Repo/memory/build-system.md` |
| Firmware builds (types, branches) | `{MEM}Learning-YourCompany-Repo/memory/firmware-builds.md` |
| Unified build system (PR #48) | `{MEM}Learning-YourCompany-Repo/memory/unified-build-system.md` |
| JNAP API (core router API) | `{MEM}Learning-YourCompany-Repo/memory/jnap-api.md` |
| sysctx.lua (UCI abstraction) | `{MEM}Learning-YourCompany-Repo/memory/sysctxlua.md` |
| Jenkins CI/CD | `{MEM}Learning-YourCompany-Repo/memory/jenkins.md` |
| SDK patches (156+ catalog) | `{MEM}Learning-YourCompany-Repo/memory/sdk-patches.md` |
| feed_yourcompany (60 packages) | `{MEM}Learning-YourCompany-Repo/memory/feed-yourcompany.md` |
| feed_bbf (TR-069/TR-369) | `{MEM}Learning-YourCompany-Repo/memory/feed-bbf.md` |
| CBT feed (CyberTan ODM) | `{MEM}Learning-YourCompany-Repo/memory/cbt-feed.md` |
| Thirdparty/hardware feeds | `{MEM}Learning-YourCompany-Repo/memory/thirdparty-hardware-feeds.md` |
| UI pipeline (Flutter/React) | `{MEM}Learning-YourCompany-Repo/memory/ui-pipeline.md` |
| DevOps (Jenkins, Docker, ECS) | `{MEM}Learning-YourCompany-Repo/memory/lswf-devops.md` |
| ExampleWRT issues | `{MEM}Learning-YourCompany-Repo/memory/yourcompanywrt-issues.md` |
| Full repo classification | `{MEM}Learning-YourCompany-Repo/memory/repo-index.md` |
| **DU certification status** | `{MEM}Learning-YourCompany-Repo/memory/project_du_certification.md` |

### WiFi-Troubleshooter (8 files — ARCHIVED, succeeded by Instant_Help)

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

### TR-069-TR-369 (10 files — USP cert testing, ACSPlatform, Pinnacle)

| Topic | Path |
|-------|------|
| Index | `{MEM}TR-069-TR-369/memory/MEMORY.md` |
| Pinnacle platform + live USP status | `{MEM}TR-069-TR-369/memory/project_pinnacle_platform.md` |
| Personal ACSPlatform on AWS (10.0.4.31) | `{MEM}TR-069-TR-369/memory/reference_own_oktopus.md` |
| YourCompany team ACSPlatform (10.0.5.0) | `{MEM}TR-069-TR-369/memory/reference_cloud_oktopus.md` |
| M60CF-EU router credentials + CGI | `{MEM}TR-069-TR-369/memory/reference_router_credentials.md` |
| YourCompany GitHub repo map (source fix locations) | `{MEM}TR-069-TR-369/memory/reference_yourcompany_github.md` |
| Bug ticket writing style | `{MEM}TR-069-TR-369/memory/feedback_bug_tickets.md` |
| **Full TR-369 cert roadmap + pre-cert results** | `~/Projects/TR-069_TR-369/tr-repo/reference/BBF369-PINNACLE-EXECUTION-ROADMAP.md` |
| **Firmware verification log** | `~/Projects/TR-069_TR-369/tr-repo/reference/FIRMWARE-VERIFICATION-LOG.md` |
| **YourCompany GitHub repo index (detailed)** | `~/Projects/TR-069_TR-369/tr-repo/reference/YOURCOMPANY-GITHUB-REPO-INDEX.md` |
| **ACSPlatform setup + TLS + patches** | `~/Projects/TR-069_TR-369/handoff/ACS_PLATFORM-SETUP-GUIDE.md` |
| **PKI for CDRouter lab** | `~/Projects/TR-069_TR-369/pki/README.md` |
| DataElements issue #132 status | `~/Projects/TR-069_TR-369/deliverables/DataElements-Issue132-Status-FW1017.md` |

### Steadfast (6 files — moved to ~/Projects-Personal/)

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

### kai (3 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}kai/memory/MEMORY.md` |
| Quality over tokens feedback | `{MEM}kai/memory/feedback_algorithm_quality_over_tokens.md` |
| Memory system overhaul project | `{MEM}kai/memory/project_memory_system_overhaul.md` |

### release-notes (1 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}release-notes/memory/MEMORY.md` |

### feed-bbf (12 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}feed-bbf/memory/MEMORY.md` |
| feedback agent token efficiency | `{MEM}feed-bbf/memory/feedback_agent_token_efficiency.md` |
| feedback confirm pr target branch | `{MEM}feed-bbf/memory/feedback_confirm_pr_target_branch.md` |
| feedback context routing check | `{MEM}feed-bbf/memory/feedback_context_routing_check.md` |
| feedback no fabrication | `{MEM}feed-bbf/memory/feedback_no_fabrication.md` |
| feedback patch target verification | `{MEM}feed-bbf/memory/feedback_patch_target_verification.md` |
| project branch structure | `{MEM}feed-bbf/memory/project_branch_structure.md` |
| project issue248 bbfdm ubus fix | `{MEM}feed-bbf/memory/project_issue248_bbfdm_ubus_fix.md` |
| project issue256 cloud loss | `{MEM}feed-bbf/memory/project_issue256_cloud_loss.md` |
| reference jenkins dev builds | `{MEM}feed-bbf/memory/reference_jenkins_dev_builds.md` |
| reference lab device m62 | `{MEM}feed-bbf/memory/reference_lab_device_m62.md` |
| reference lab devices and tools | `{MEM}feed-bbf/memory/reference_lab_devices_and_tools.md` |

### YourNameGithub (1 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}YourNameGithub/memory/MEMORY.md` |

### Du-tracking (4 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}Du-tracking/memory/MEMORY.md` |
| feedback github issue style | `{MEM}Du-tracking/memory/feedback_github_issue_style.md` |
| feedback ticket formatting | `{MEM}Du-tracking/memory/feedback_ticket_formatting.md` |
| project du tracking | `{MEM}Du-tracking/memory/project_du_tracking.md` |

### Firmware-Inspector (4 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}Firmware-Inspector/memory/MEMORY.md` |
| project feature requests | `{MEM}Firmware-Inspector/memory/project_feature_requests.md` |
| project milestone | `{MEM}Firmware-Inspector/memory/project_milestone.md` |
| user role | `{MEM}Firmware-Inspector/memory/user_role.md` |

### Github-tools (2 files)

| Topic | Path |
|-------|------|
| Index | `{MEM}Github-tools/memory/MEMORY.md` |
| feedback board phases | `{MEM}Github-tools/memory/feedback_board_phases.md` |
