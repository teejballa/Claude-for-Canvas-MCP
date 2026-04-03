/**
 * Canvas MCP Server - Cloudflare Worker
 * Exposes Canvas LMS data (courses, assignments, grades, announcements)
 * via the Model Context Protocol (MCP) Streamable HTTP transport.
 */

export interface Env {
  CANVAS_API_KEY: string;
  CANVAS_URL: string;
}

// ─── Canvas API Helper ────────────────────────────────────────────────────────

async function canvasGet(env: Env, path: string): Promise<any> {
  const url = `${env.CANVAS_URL}/api/v1${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.CANVAS_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Canvas API authentication failed — check your API key."
      );
    }
    throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_courses",
    description:
      "Get all active courses the student is currently enrolled in, including course names, codes, and IDs.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_assignments",
    description:
      "Get assignments for a specific course or all courses. Returns name, due date, points, and submission status.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: {
          type: "string",
          description:
            "Canvas course ID. If omitted, fetches assignments for all active courses.",
        },
        include_past: {
          type: "boolean",
          description:
            "Whether to include past/completed assignments. Defaults to false (only upcoming + overdue).",
        },
      },
    },
  },
  {
    name: "get_upcoming_assignments",
    description:
      "Get all upcoming assignments across all courses sorted by due date, with urgency indicators.",
    inputSchema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "number",
          description:
            "How many days ahead to look. Defaults to 14 days.",
        },
      },
    },
  },
  {
    name: "get_grades",
    description:
      "Get current grades and scores for all enrolled courses.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_announcements",
    description:
      "Get recent announcements from all courses or a specific course.",
    inputSchema: {
      type: "object",
      properties: {
        course_id: {
          type: "string",
          description:
            "Canvas course ID. If omitted, fetches announcements for all active courses.",
        },
      },
    },
  },
];

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getCourses(env: Env): Promise<string> {
  const courses = await canvasGet(
    env,
    "/courses?enrollment_state=active&per_page=100"
  );

  if (!courses.length) return "No active courses found.";

  const lines = courses.map(
    (c: any) =>
      `• ${c.name}  (ID: ${c.id}${c.course_code ? ", Code: " + c.course_code : ""})`
  );
  return `Your active courses (${courses.length}):\n\n${lines.join("\n")}`;
}

async function getAssignments(env: Env, args: any): Promise<string> {
  const now = new Date();

  const fetchForCourse = async (courseId: number, courseName: string) => {
    const bucket = args.include_past
      ? ""
      : "&bucket=future&bucket=overdue&bucket=undated";
    const asgns: any[] = await canvasGet(
      env,
      `/courses/${courseId}/assignments?order_by=due_at&per_page=100${bucket}`
    ).catch(() => []);
    return asgns.map((a) => ({ ...a, _course_name: courseName }));
  };

  let assignments: any[];

  if (args.course_id) {
    // Single course
    const course = await canvasGet(env, `/courses/${args.course_id}`).catch(
      () => null
    );
    const courseName = course?.name ?? `Course ${args.course_id}`;
    assignments = await fetchForCourse(Number(args.course_id), courseName);
  } else {
    // All courses
    const courses = await canvasGet(
      env,
      "/courses?enrollment_state=active&per_page=100"
    );
    const results = await Promise.all(
      courses.map((c: any) => fetchForCourse(c.id, c.name))
    );
    assignments = results
      .flat()
      .sort((a: any, b: any) => {
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      });
  }

  if (!assignments.length) return "No assignments found.";

  const lines = assignments.map((a: any) => {
    const due = a.due_at
      ? new Date(a.due_at).toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "No due date";
    const overdue =
      a.due_at && new Date(a.due_at) < now && !a.has_submitted_submissions
        ? " ⚠️ OVERDUE"
        : "";
    const pts = a.points_possible != null ? `${a.points_possible} pts` : "N/A";
    const submitted = a.has_submitted_submissions ? " ✅" : "";
    return `• ${a.name}${submitted}  [${a._course_name}]\n  Due: ${due}${overdue}  |  ${pts}`;
  });

  return `Assignments:\n\n${lines.join("\n\n")}`;
}

async function getUpcomingAssignments(env: Env, args: any): Promise<string> {
  const daysAhead = typeof args.days_ahead === "number" ? args.days_ahead : 14;
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 86_400_000);

  const courses = await canvasGet(
    env,
    "/courses?enrollment_state=active&per_page=100"
  );

  const results = await Promise.all(
    courses.map((c: any) =>
      canvasGet(
        env,
        `/courses/${c.id}/assignments?order_by=due_at&per_page=100&bucket=future&bucket=overdue`
      )
        .then((asgns: any[]) =>
          asgns.map((a) => ({ ...a, _course_name: c.name }))
        )
        .catch(() => [])
    )
  );

  const assignments = results
    .flat()
    .filter((a: any) => a.due_at && new Date(a.due_at) <= cutoff)
    .sort(
      (a: any, b: any) =>
        new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
    );

  if (!assignments.length)
    return `No upcoming assignments in the next ${daysAhead} days. 🎉`;

  const lines = assignments.map((a: any) => {
    const due = new Date(a.due_at);
    const msLeft = due.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    const urgency =
      daysLeft < 0
        ? "🔴 OVERDUE"
        : daysLeft === 0
        ? "🔴 DUE TODAY"
        : daysLeft <= 2
        ? "🟡 DUE SOON"
        : "🟢";
    const dueStr = due.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const when =
      daysLeft >= 0 ? `in ${daysLeft}d` : `${Math.abs(daysLeft)}d ago`;
    const pts =
      a.points_possible != null ? ` | ${a.points_possible} pts` : "";
    return `${urgency} ${a.name}  [${a._course_name}]\n   Due: ${dueStr} (${when})${pts}`;
  });

  return `Upcoming assignments — next ${daysAhead} days (${assignments.length} total):\n\n${lines.join("\n\n")}`;
}

async function getGrades(env: Env): Promise<string> {
  const enrollments = await canvasGet(
    env,
    "/users/self/enrollments?state[]=active&type[]=StudentEnrollment&include[]=current_grades&per_page=100"
  );

  if (!enrollments.length) return "No grade information found.";

  const lines = enrollments.map((e: any) => {
    const g = e.grades ?? {};
    const letter = g.current_grade ?? "—";
    const pct =
      g.current_score != null ? ` (${g.current_score}%)` : "";
    const name = e.course_name ?? `Course ${e.course_id}`;
    return `• ${name}:  ${letter}${pct}`;
  });

  return `Current grades:\n\n${lines.join("\n")}`;
}

async function getAnnouncements(env: Env, args: any): Promise<string> {
  let contextParam: string;

  if (args.course_id) {
    contextParam = `context_codes[]=course_${args.course_id}`;
  } else {
    const courses = await canvasGet(
      env,
      "/courses?enrollment_state=active&per_page=100"
    );
    if (!courses.length) return "No active courses found.";
    contextParam = courses
      .map((c: any) => `context_codes[]=course_${c.id}`)
      .join("&");
  }

  const announcements = await canvasGet(
    env,
    `/announcements?${contextParam}&per_page=20`
  );

  if (!announcements.length) return "No recent announcements.";

  const lines = announcements.map((a: any) => {
    const date = new Date(a.posted_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    // Strip HTML tags
    const body = (a.message ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 250);
    const ellipsis = (a.message ?? "").length > 250 ? "…" : "";
    return `📢 ${a.title}  [${a.context_name ?? "Unknown Course"}]  —  ${date}\n   ${body}${ellipsis}`;
  });

  return `Recent announcements (${announcements.length}):\n\n${lines.join("\n\n")}`;
}

// ─── JSON-RPC Helpers ─────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id",
};

function ok(id: any, result: any): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(id: any, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { headers: { "Content-Type": "application/json", ...CORS } }
  );
}

// ─── Request Dispatcher ───────────────────────────────────────────────────────

async function dispatch(
  id: any,
  method: string,
  params: any,
  env: Env
): Promise<Response> {
  try {
    switch (method) {
      // ── Lifecycle ──────────────────────────────────────────────────────────
      case "initialize":
        return ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "canvas-mcp", version: "1.0.0" },
        });

      case "notifications/initialized":
        return new Response(null, { status: 204, headers: CORS });

      case "ping":
        return ok(id, {});

      // ── Discovery ──────────────────────────────────────────────────────────
      case "tools/list":
        return ok(id, { tools: TOOLS });

      // ── Tool Calls ─────────────────────────────────────────────────────────
      case "tools/call": {
        const toolName: string = params?.name;
        const args: any = params?.arguments ?? {};
        let text: string;

        switch (toolName) {
          case "get_courses":
            text = await getCourses(env);
            break;
          case "get_assignments":
            text = await getAssignments(env, args);
            break;
          case "get_upcoming_assignments":
            text = await getUpcomingAssignments(env, args);
            break;
          case "get_grades":
            text = await getGrades(env);
            break;
          case "get_announcements":
            text = await getAnnouncements(env, args);
            break;
          default:
            return err(id, -32602, `Unknown tool: "${toolName}"`);
        }

        return ok(id, { content: [{ type: "text", text }] });
      }

      default:
        return err(id, -32601, `Method not found: "${method}"`);
    }
  } catch (e: any) {
    const msg: string = e?.message ?? "Unknown error";
    if (msg.includes("authentication failed")) {
      return err(id, -32603, msg);
    }
    return err(id, -32603, `Internal error: ${msg}`);
  }
}

// ─── Main Fetch Handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { method, url } = request;
    const { pathname } = new URL(url);

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check
    if (method === "GET" && pathname === "/") {
      return new Response(
        JSON.stringify({ status: "ok", service: "Canvas MCP Server", version: "1.0.0" }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // MCP endpoint
    if (method === "POST" && pathname === "/mcp") {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return err(null, -32700, "Parse error — body must be valid JSON");
      }

      const { id, method: rpcMethod, params } = body as any;
      return dispatch(id, rpcMethod, params, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
