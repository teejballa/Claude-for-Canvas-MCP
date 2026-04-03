<<<<<<< HEAD
# Claude-for-Canvas-MCP
This is a custom built MCP server for Claude that connects it to Canvas, with assignment, announcement, to do viewing capabilities.
=======
<h1 align="center">Canvas MCP Server</h1>
<p align="center">
  <strong>Connect your Canvas LMS to Claude.</strong><br/>
  Pull assignments, grades, announcements, and course data directly into your AI workflow via the Model Context Protocol.
</p>

<p align="center">
  <a href="#what-it-does">What It Does</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#tools">Tools</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#use-cases">Use Cases</a>
</p>

---

## What It Does

This is an MCP (Model Context Protocol) server that connects Canvas LMS to Claude. Once configured, Claude can directly access your Canvas data — assignments, due dates, grades, announcements, and course info — without you copy-pasting anything.

**Why this exists:** I'm a high school student who uses Claude daily and was tired of manually telling it what homework I had. So I built a bridge. Now Claude reads my Canvas directly and can plan my study sessions, break down assignments, and flag what's due.

---

## What's MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI assistants connect to external data sources and tools. This server implements that protocol for Canvas LMS, so any MCP-compatible client (Claude Desktop, Claude Code, Cowork, etc.) can access your Canvas data.

---

## Architecture

This MCP server runs as a **Cloudflare Worker** — a serverless function deployed at the edge. It exposes a single `/mcp` endpoint that speaks JSON-RPC 2.0 (the MCP wire protocol) over HTTP.

```
Claude (MCP Client)
    │
    ▼  JSON-RPC 2.0 over HTTP
Cloudflare Worker (/mcp)
    │
    ▼  REST API + Bearer Token
Canvas LMS (your-school.instructure.com)
```

The Worker handles MCP protocol negotiation (`initialize`, `tools/list`, `tools/call`), translates tool calls into Canvas REST API requests, and returns structured data back to Claude.

**Why Cloudflare Workers?** Always on, no server to maintain, globally distributed, and free tier covers personal usage easily. The Worker cold-starts in under 5ms.

---

## Prerequisites

- **Node.js 18+** — Download from [nodejs.org](https://nodejs.org) (LTS version recommended)
- **A Canvas LMS account** — Any school using Canvas (Instructure) will work
- **A free Cloudflare account** — Sign up at [cloudflare.com](https://cloudflare.com) (no domain or credit card needed)

---

## Quick Start

### 1. Get your Canvas API token

1. Log into your school's Canvas (e.g., `https://your-school.instructure.com`)
2. Go to **Account** → **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Name it something like `Claude MCP` and click **Generate Token**
6. **Copy the token immediately** — Canvas won't show it again

### 2. Clone and install

```bash
git clone https://github.com/teejballa/Claude-for-Canvas-Custom-MCP.git
cd Claude-for-Canvas-Custom-MCP
npm install
```

### 3. Configure your school's Canvas URL

Open `wrangler.toml` and replace the placeholder with your school's Canvas URL:

```toml
[vars]
CANVAS_URL = "https://your-school.instructure.com"
```

### 4. Log into Cloudflare and store your API key

```bash
# This opens your browser to authenticate with Cloudflare
npx wrangler login

# This prompts you to paste your Canvas API token — it's stored securely
# as a Cloudflare secret and never appears in your code
npx wrangler secret put CANVAS_API_KEY
```

When `wrangler secret put` runs, it will show `Enter a secret value:` — paste your Canvas token and press Enter.

### 5. Deploy

```bash
npm run deploy
```

You'll see output like:
```
Published canvas-mcp (0.5 sec)
  https://canvas-mcp.<your-subdomain>.workers.dev
```

Copy that URL — you'll need it in the next step. The `/mcp` endpoint is your MCP server.

### 6. Add to Claude

**Claude Desktop (Cowork):**

Go to **Settings** (gear icon) → **MCP Servers** → **Add Server** → enter a name like `Canvas` and paste your Worker URL with `/mcp` at the end:

```
https://canvas-mcp.<your-subdomain>.workers.dev/mcp
```

**Claude Code (CLI):**

Add to your MCP config file (`~/.claude/claude_desktop_config.json` or your project's `.mcp.json`):

```json
{
  "mcpServers": {
    "canvas": {
      "type": "url",
      "url": "https://canvas-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

### 7. Test it

Ask Claude anything about your classes:
- *"What assignments do I have due this week?"*
- *"What are my grades in each class?"*
- *"Are there any new announcements?"*
- *"Break down the assignment due tomorrow and help me plan my time."*

If you get a `401 Unauthorized` error, your API key is wrong — re-run `npx wrangler secret put CANVAS_API_KEY` with the correct token.

---

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_courses` | List all active courses with names, codes, and IDs | — |
| `get_assignments` | Get assignments for one course or all courses with due dates, points, and submission status | `course_id` (optional), `include_past` (optional) |
| `get_upcoming_assignments` | Get assignments due soon across all courses, sorted by due date with urgency indicators | `days_ahead` (default: 14) |
| `get_grades` | Get current letter grades and percentages for all enrolled courses | — |
| `get_announcements` | Get recent announcements from all courses or a specific course | `course_id` (optional) |

Assignments include submission status (✅), urgency indicators (🔴 OVERDUE, 🔴 DUE TODAY, 🟡 DUE SOON, 🟢), point values, and course names.

---

## Configuration

| Variable | Where | Description |
|----------|-------|-------------|
| `CANVAS_URL` | `wrangler.toml` | Your school's Canvas URL (e.g., `https://your-school.instructure.com`) |
| `CANVAS_API_KEY` | Wrangler secret | Your Canvas API access token (stored securely, never in code) |

---

## Use Cases

**Homework planning** — "What's due this week? Prioritize by difficulty and deadline."

**Study session prep** — "Pull my upcoming history test details and help me make a study plan."

**Grade tracking** — "How am I doing across all my classes? Flag anything below a B."

**Assignment breakdown** — "Read the rubric for my English essay and help me outline it."

**Automated daily briefing** — I use this MCP in a scheduled task that runs every morning at 9 AM. It scans Canvas alongside my calendar and email, then sends me a prioritized summary of what's due, what to work on, and what I'm forgetting — delivered via email and iMessage, no manual input needed.

---

## How I Use It

This MCP is a core piece of my personal AI productivity system. It feeds into:

- A **daily briefing** that fires every morning — pulls Canvas assignments, calendar events, and email, then delivers a formatted summary via email and iMessage
- A **homework planner** that prioritizes assignments by due date, difficulty, and time available
- **Study guide generation** that reads assignment details and creates interactive HTML study materials with flashcards, quizzes, and concept maps
- A **heartbeat system** that checks project and homework status throughout the day

It runs alongside a custom Apple Mail MCP and Google Calendar integration — together they give Claude full context on school life without any manual input.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| Protocol | Model Context Protocol (MCP) — JSON-RPC 2.0 |
| Transport | HTTP Streamable |
| API | Canvas LMS REST API v1 |
| Auth | Bearer token via Wrangler secrets |

---

## Project Structure

```
canvas-mcp/
├── src/
│   └── index.ts          # MCP server — Canvas API calls, tool definitions, JSON-RPC dispatcher
├── package.json           # Dependencies (Wrangler, TypeScript, Cloudflare Workers types)
├── tsconfig.json          # TypeScript config (ES2022, strict mode)
├── wrangler.toml          # Cloudflare Worker config + Canvas URL
└── .gitignore
```

---

## Local Development

To run the Worker locally, create a `.dev.vars` file in the project root with your Canvas API key (this file is gitignored and never committed):

```bash
# .dev.vars
CANVAS_API_KEY=your_canvas_api_token_here
```

Then:

```bash
npm install          # Install dependencies
npx wrangler dev     # Run locally at http://localhost:8787
npm run deploy       # Deploy to Cloudflare
npm run tail         # Tail production logs
```

The local server runs at `http://localhost:8787/mcp` — you can point a Claude MCP config at this URL during development.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` | API key is wrong or expired — re-run `npx wrangler secret put CANVAS_API_KEY` |
| Tools return empty results | Make sure you're enrolled in active courses in Canvas |
| Can't log into Cloudflare | Run `npx wrangler login` again |

---

## Contributing

If your school uses Canvas and you want to extend the tool set, PRs are welcome.

Ideas for extensions:
- `get_submissions` — pull submitted work and teacher feedback
- `get_modules` — navigate course modules and content pages
- `get_discussions` — read and post to discussion boards
- `get_calendar_events` — pull Canvas calendar events directly
- `submit_assignment` — submit work to Canvas from Claude

---

## Built by

**TJ Walsh** — High school student building AI tools for productivity and education.

[GitHub](https://github.com/teejballa) · [LinkedIn](https://www.linkedin.com/in/tj-walsh-613b5936a/)

*This project is not affiliated with Instructure (Canvas) or Anthropic.*
>>>>>>> b16f055 (initial commit, working canvas mcp with cloudflare workers)
