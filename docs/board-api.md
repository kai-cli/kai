# PAI Board API Contract

REST API and SSE event protocol for the PAI Board dashboard.

## Server Configuration

- **Default Port**: 3333
- **Override**: `bun run board.ts --port 8080`
- **Config File**: `scripts/board-config.json`

## REST Endpoints

### Work Items

#### GET /api/work
Get all work items, archived items, sessions, and running processes.

**Response:**
```json
{
  "items": [
    {
      "slug": "20260527-1530-implement-feature",
      "task": "Implement user authentication",
      "effort": "standard",
      "phase": "execute",
      "passed": 3,
      "total": 8,
      "mode": "interactive",
      "started": "2026-05-27T15:30:00Z",
      "updated": "2026-05-27T16:45:00Z",
      "criteria": [
        { "id": "ISC-C1", "text": "User can log in with email/password", "passed": true },
        { "id": "ISC-C2", "text": "Session persists across page reloads", "passed": false }
      ],
      "prdPath": "/path/to/PRD.md",
      "source": "work",
      "stale": false
    }
  ],
  "archived": [],
  "sessions": [
    {
      "slug": "20260527-1530-quick-task",
      "task": "Fix broken link on homepage",
      "phase": "native",
      "sessionUUID": "abc-123-def",
      "startedAt": "2026-05-27T15:30:00Z",
      "isActive": true,
      "sessionName": "Fix Homepage Link",
      "taskSlug": "fix-homepage-link"
    }
  ],
  "processes": {
    "20260527-1530-implement-feature": {
      "type": "ralph",
      "startTime": 1716825000000,
      "logPath": "/path/to/log.log",
      "budget": 5,
      "model": "opus"
    }
  }
}
```

### Library

#### GET /api/library
Get all library items (manual + auto-discovered projects).

**Response:**
```json
[
  {
    "name": "Pai Config",
    "path": "~/Projects/pai-config/",
    "description": "Personal AI Infrastructure configuration",
    "tags": ["pai-project"],
    "pinned": true,
    "discovered": false
  }
]
```

### GitHub

#### GET /api/github
Get GitHub PRs and issues (5-minute cache).

**Response:**
```json
[
  {
    "repo": "owner/repo",
    "number": 42,
    "title": "Add authentication feature",
    "type": "pr",
    "state": "open",
    "url": "https://github.com/owner/repo/pull/42",
    "updatedAt": "2026-05-27T12:00:00Z",
    "labels": ["feature", "backend"]
  }
]
```

### PRD Detail

#### GET /api/prd/{slug}
Get full PRD content for a specific task.

**Response:**
```json
{
  "frontmatter": {
    "task": "Implement authentication",
    "slug": "20260527-1530-implement-feature",
    "effort": "standard",
    "phase": "execute",
    "progress": "3/8"
  },
  "criteria": [
    { "id": "ISC-C1", "text": "User can log in", "passed": true }
  ],
  "raw": "---\ntask: Implement authentication\n---\n...",
  "path": "/full/path/to/PRD.md"
}
```

### Task Operations

#### POST /api/task
Create a new task.

**Request:**
```json
{
  "title": "Implement feature X",
  "description": "Detailed description",
  "effort": "standard",
  "mode": "interactive"
}
```

**Response:**
```json
{
  "slug": "20260527-1530-implement-feature-x"
}
```

#### PATCH /api/task/{slug}/phase
Update task phase.

**Request:**
```json
{
  "phase": "execute"
}
```

**Response:**
```json
{ "ok": true }
```

#### PATCH /api/task/{slug}/criteria/{criterionId}
Toggle criterion pass/fail status.

**Response:**
```json
{ "ok": true }
```

#### PATCH /api/task/{slug}/order
Update task sort order.

**Request:**
```json
{
  "sort_order": 10
}
```

**Response:**
```json
{ "ok": true }
```

#### PATCH /api/task/{slug}/metadata
Update task metadata (priority, tags).

**Request:**
```json
{
  "priority": "high",
  "tags": ["backend", "urgent"]
}
```

**Response:**
```json
{ "ok": true }
```

#### POST /api/reorder
Bulk reorder tasks across phases.

**Request:**
```json
{
  "updates": [
    { "slug": "task-1", "phase": "execute", "sort_order": 1 },
    { "slug": "task-2", "phase": "verify", "sort_order": 2 }
  ]
}
```

**Response:**
```json
{ "ok": true }
```

### Archive Operations

#### POST /api/task/{slug}/archive
Archive a task (moves to archived section).

**Response:**
```json
{ "ok": true }
```

#### DELETE /api/task/{slug}/archive
Unarchive a task.

**Response:**
```json
{ "ok": true }
```

### Session Management

#### POST /api/task/{slug}/launch
Launch a Claude session for the task.

**Response:**
```json
{
  "ok": true,
  "cmd": "claude -n \"Task Name\" \"Read PRD.md and begin...\""
}
```

Opens terminal session in task working directory with PRD context.

### Ralph Loop

#### POST /api/task/{slug}/ralph
Start Ralph Loop autonomous execution.

**Request (optional):**
```json
{
  "budget": 5,
  "maxIterations": 5,
  "model": "opus"
}
```

**Response:**
```json
{ "ok": true }
```

**Error (already running):**
```json
{ "error": "Already running" }
```
Status: 409

#### DELETE /api/task/{slug}/ralph
Stop running Ralph Loop process.

**Response:**
```json
{ "ok": true }
```

### Docker Execution

#### POST /api/task/{slug}/docker
Start Docker-isolated execution.

**Request (optional):**
```json
{
  "budget": 5
}
```

**Response:**
```json
{ "ok": true }
```

**Error:**
```json
{ "error": "Already running or Docker disabled" }
```
Status: 409

#### DELETE /api/task/{slug}/docker
Stop Docker process.

**Response:**
```json
{ "ok": true }
```

### Process Logs

#### GET /api/task/{slug}/log
Stream log output from running process (Ralph Loop or Docker).

**Response:**
Plain text log file contents.

### Utility Endpoints

#### GET /api/knowledge-health
Analyze knowledge base health.

**Response:**
```json
{
  "domains": [
    {
      "name": "Domain Name",
      "health": "healthy",
      "issues": []
    }
  ]
}
```

#### GET /api/search?q={query}&budget={tokens}
Search memory system.

**Parameters:**
- `q`: Search query (required)
- `budget`: Token budget (default: 4000)

**Response:**
```json
{
  "query": "search term",
  "results": [
    {
      "file": "/path/to/file.md",
      "relevance": 0.95,
      "excerpt": "Matching content..."
    }
  ]
}
```

#### GET /api/config
Get board configuration.

**Response:**
```json
{
  "port": 3333,
  "scanDirs": ["~/.claude/MEMORY/WORK"],
  "workRoot": "~/.claude/MEMORY/WORK",
  "projectsDir": "~/Projects",
  "autoDiscover": true,
  "ignored": ["node_modules", ".git"],
  "library": [],
  "archived": [],
  "terminal": "iterm",
  "ralphLoop": {
    "defaultBudget": 5,
    "defaultMaxIterations": 5,
    "defaultModel": "opus"
  },
  "docker": {
    "enabled": true,
    "image": "oven/bun:latest",
    "memoryLimit": "2g",
    "cpuLimit": "2.0",
    "timeout": 1800
  }
}
```

#### PUT /api/config
Update board configuration.

**Request:** Full or partial config object (merged with existing).

**Response:**
```json
{ "ok": true }
```

#### GET /api/processes
Get all running processes.

**Response:**
```json
[
  {
    "slug": "task-slug",
    "type": "ralph",
    "startTime": 1716825000000,
    "elapsed": 125000,
    "logPath": "/path/to/log.log",
    "budget": 5,
    "model": "opus"
  }
]
```

## Server-Sent Events (SSE)

### GET /api/events

Long-lived connection for real-time updates.

**Connection:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**
```
data: update

data: connected
```

**Events:**
- `connected`: Sent immediately on connection
- `update`: Broadcast when any work item, session, or process changes

**Client Behavior:**
On receiving `update` event, client should refetch:
- `/api/work` (if viewing work items)
- `/api/library` (if viewing library)
- `/api/github` (if viewing GitHub items)

**Reconnection:**
Client should automatically reconnect if connection drops.

## CORS

All endpoints support CORS:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

OPTIONS preflight requests return 204.

## Error Responses

**404 Not Found:**
```json
{ "error": "Not found" }
```

**409 Conflict:**
```json
{ "error": "Already running" }
```

**500 Internal Server Error:**
```json
{
  "error": "Error message",
  "details": "Additional context"
}
```

## File Watchers

The board automatically watches:
- All `scanDirs` directories (recursive)
- `~/.claude/MEMORY/STATE/work.json`

Changes trigger SSE `update` broadcast to all connected clients.

## Static Assets

- `/` → React app (index.html from frontend/dist)
- `/assets/*` → Static assets with immutable cache headers

## Terminal Adapter

Board launches Claude sessions using terminal adapter:
- **iTerm**: AppleScript control
- **Terminal.app**: Fallback support

Adapter interface: `scripts/adapters/terminal.ts`

## Process Management

Running processes tracked in-memory:
- Ralph Loop: `bun run ralph-loop.ts`
- Docker: Isolated container with memory/CPU limits

Processes auto-cleanup on exit. Zombie detection via active session UUID tracking.

## Data Sources

- **Work Items**: Scanned from `scanDirs` (PRD.md files)
- **Sessions**: `~/.claude/MEMORY/STATE/work.json`
- **Library**: Manual config + auto-discovered from `projectsDir`
- **GitHub**: `gh` CLI (5-minute cache)
- **Archive**: Stored in `board-config.json` → `archived` array
