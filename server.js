require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 4173;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MEMORY_FILE = path.join(__dirname, "memory", "conversations.json");

const SYSTEM_INSTRUCTION =
  "You are Harvis AI, a helpful Jarvis-style voice assistant. Answer naturally, clearly, and accurately. Never invent fake facts. For current or factual information, only answer what you can verify. If you cannot verify something live, say so honestly. Use simple English or Hinglish depending on the user's language. Keep replies short and useful.";

const CURRENT_FACT_HINT =
  "Important runtime limitation: this lightweight app does not include live web search grounding yet. If the user asks for latest/current/today/news/prices/releases/versions/live facts and you cannot verify the information from available context, say: I cannot verify this live right now.";

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function ensureMemoryFile() {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });

  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, "[]\n", "utf8");
  }
}

async function readMemory() {
  await ensureMemoryFile();

  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Memory file could not be read. Starting fresh.", error.message);
    return [];
  }
}

async function saveConversation(entry) {
  const history = await readMemory();
  history.push(entry);

  // Simple memory for now. Later this can become per-user memory, vector search,
  // summaries, auth-backed accounts, or a database without changing the API shape.
  const cappedHistory = history.slice(-100);
  await fs.writeFile(MEMORY_FILE, JSON.stringify(cappedHistory, null, 2), "utf8");
}

function buildGeminiPayload(message, memory) {
  const recent = memory.slice(-6).map((item) => ({
    user: item.user,
    assistant: item.assistant
  }));

  return {
    systemInstruction: {
      parts: [{ text: `${SYSTEM_INSTRUCTION}\n\n${CURRENT_FACT_HINT}` }]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Recent conversation memory, if useful:",
              JSON.stringify(recent),
              "",
              "User message:",
              message
            ].join("\n")
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.45,
      topP: 0.9,
      maxOutputTokens: 420
    }
  };
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("\n").trim();
  return text || "I could not generate a clear response.";
}

async function askGemini(message, memory) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "your_gemini_api_key_here") {
    const error = new Error("Gemini API key missing. Add GEMINI_API_KEY in your .env file.");
    error.statusCode = 500;
    throw error;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildGeminiPayload(message, memory))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage =
      data?.error?.message || `Gemini request failed with status ${response.status}`;
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    throw error;
  }

  return extractGeminiText(data);
}

app.post("/api/ask", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const memory = await readMemory();

    // Future expansion placeholders:
    // - Web search grounding: detect current/live questions and attach verified sources.
    // - Custom tools: route commands to small safe server-side tool handlers.
    // - App opening commands: add an allowlisted local launcher with user approval.
    // - Web automation: connect a browser automation service only when explicitly enabled.
    // - Smart home control: add device-specific integrations behind authentication.
    // - Face authentication: gate private actions with a separate trusted auth flow.
    // - Gesture control: add optional camera input on the frontend, never by default.

    const answer = await askGemini(message, memory);
    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      user: message,
      assistant: answer
    };

    await saveConversation(entry);

    return res.json({ answer });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Harvis could not answer right now."
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "Harvis AI",
    model: GEMINI_MODEL,
    memory: "json-file"
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureMemoryFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Harvis AI is online at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize Harvis AI:", error);
    process.exit(1);
  });
