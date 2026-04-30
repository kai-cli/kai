# PAI Development & Architecture Documentation

> This directory contains architecture reviews, system maps, and improvement tracking for PAI development. It is the canonical location for understanding the system's structure, known issues, and planned changes.

## Documents

| File | Purpose |
|------|---------|
| `ARCHITECTURAL-UNDERSTANDING.md` | Architectural index — what the system is, design decisions, improvement paths |
| `IMPROVEMENT-INDEX.md` | Master tracker of all identified issues, fixes, and open items |
| `ARCHITECTURE-REVIEW-v4.4.1.md` | Holistic architecture review — design flaws, bugs, improvement paths |
| `HOOK-SYSTEM-AUDIT.md` | Deep audit of the hook system — registration map, execution flow, bugs |
| `THEHOOKSYSTEM-Reference.md` | Hook system reference documentation |
| `SKILLSYSTEM-Reference.md` | Skill system reference documentation |
| `ARCHITECTURAL-UNDERSTANDING.md` | Original comprehensive reference (architecture, decomposition blueprints, future vision) |
| `AUDIT-STATUS.md` | Current audit progress and next steps |

## How to Use

- **Starting a cleanup session?** Read IMPROVEMENT-INDEX.md first — it tracks what's done and what's open.
- **Need to understand the system?** Read ARCHITECTURAL-UNDERSTANDING.md for structure and design decisions.
- **Working on hooks?** Read HOOK-SYSTEM-AUDIT.md for the detailed execution map and known bugs.
- **Adding a new document?** Keep it focused. One doc per concern. Update this README.

## Conventions

- Files are versioned by the KAI version they describe (e.g., `ARCHITECTURE-REVIEW-v4.4.1.md`)
- IMPROVEMENT-INDEX.md uses priority levels: P0 (runtime bugs), P1 (critical), P2 (high), P3 (medium), P4 (low), P5 (repo-level)
- Status markers: ✅ FIXED, ⏳ DEFERRED, 📦 NEEDS DECISION, 🔴 OPEN
