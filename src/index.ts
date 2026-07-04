import { Hono } from "hono";
import type { Env, User, Conversation, Message } from "./types";

type App = { Bindings: Env; Variables: { user: User } };

const app = new Hono<App>();

// ── Health check ─────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ status: "ok", name: "xavier" }));

// ── Chat completion (streaming) ──────────────────────────────
app.post("/api/chat", async (c) => {
  const { messages, model } = await c.req.json<{
    messages: { role: string; content: string }[];
    model?: string;
  }>();

  const resolvedModel = model || "@cf/meta/llama-3.1-8b-instruct";

  const stream = await c.env.AI.run(resolvedModel as any, {
    messages: messages.map((m) => ({ role: m.role as any, content: m.content })),
    stream: true,
  });

  return new Response(stream as any, {
    headers: { "content-type": "text/event-stream" },
  });
});

// ── List models ──────────────────────────────────────────────
app.get("/api/models", (c) => {
  return c.json({
    models: [
      { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B" },
      { id: "@cf/meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B" },
      { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
      { id: "@cf/deepseek/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 32B" },
    ],
  });
});

// ── Conversations CRUD ───────────────────────────────────────
app.get("/api/conversations", async (c) => {
  const results = await c.env.DB.prepare(
    "SELECT * FROM conversations ORDER BY updated_at DESC"
  ).all<Conversation>();
  return c.json(results.results);
});

app.post("/api/conversations", async (c) => {
  const { title, model } = await c.req.json<{ title?: string; model?: string }>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO conversations (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, "anonymous", title || "New Chat", model || "@cf/meta/llama-3.1-8b-instruct", now, now).run();
  return c.json({ id, title: title || "New Chat", model, created_at: now });
});

// ── Messages ─────────────────────────────────────────────────
app.get("/api/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const results = await c.env.DB.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  ).bind(conversationId).all<Message>();
  return c.json(results.results);
});

app.post("/api/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const { role, content, model } = await c.req.json<{
    role: string;
    content: string;
    model?: string;
  }>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, conversationId, role, content, model || null, now).run();
  await c.env.DB.prepare(
    "UPDATE conversations SET updated_at = ? WHERE id = ?"
  ).bind(now, conversationId).run();
  return c.json({ id, role, content, created_at: now });
});

// ── File upload to R2 ────────────────────────────────────────
app.post("/api/files", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const key = `uploads/${crypto.randomUUID()}/${file.name}`;
  await c.env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ key, name: file.name, size: file.size });
});

// ── Serve frontend (fallback) ────────────────────────────────
app.get("*", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Xavier AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; }
    h1 { font-size: 3rem; margin-bottom: 0.5rem; }
    p { color: #888; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Xavier</h1>
    <p>AI Assistant — API Ready</p>
  </div>
</body>
</html>`);
});

export default app;
