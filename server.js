// server.js - STUDY DOUBT SOLVER (single-file, no lowdb)
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { nanoid } = require("nanoid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ---------------- ENV ----------------
const PORT = parseInt(process.env.PORT || "10000", 10);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "REVENUE_BOT_AI_VERIFY";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !GEMINI_API_KEY) {
  console.warn("⚠ Warning: set WHATSAPP_TOKEN, PHONE_NUMBER_ID, GEMINI_API_KEY in .env");
}

// ---------------- tiny JSON DB ----------------
const DB_PATH = path.join(__dirname, "db.json");
async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { users: {}, logs: [], tests: {} };
  }
}
async function writeDB(obj) {
  await fs.writeFile(DB_PATH, JSON.stringify(obj, null, 2), "utf8");
}

// ---------------- Gemini init ----------------
let model = null;
try {
  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  // use the model your account supports; update if needed
  model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
  console.log("✅ Gemini initialized");
} catch (e) {
  console.error("❌ Gemini init error:", e?.message || e);
}

// ---------------- Helpers ----------------
function makeMermaidUrl(code) {
  if (!code) return null;
  return `https://mermaid.ink/svg/${encodeURIComponent(code)}`;
}

async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  };
  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      timeout: 20000,
    });
  } catch (err) {
    console.error("WA text error:", err?.response?.data || err?.message || err);
  }
}

async function sendWhatsAppImage(to, imageUrl, caption = "") {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  };
  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      timeout: 20000,
    });
  } catch (err) {
    console.error("WA image error:", err?.response?.data || err?.message || err);
  }
}

// safe JSON extractor
function safeJSON(raw) {
  if (!raw || typeof raw !== "string") return null;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch { /* fallthrough */ }
  }
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------- Gemini ask ----------------
async function askGemini(question, lang = "English") {
  if (!model) return { short: "AI unavailable", detailed: "Model not loaded", mermaid: "", videos: [] };

  const system = `
You are STUDY-BOT, a friendly Indian tutor for students.
Respond ONLY with a valid JSON object like:
{
  "language":"${lang}",
  "short_answer":"one-line",
  "detailed_answer":"step-by-step (use simple words)",
  "mermaid":"<mermaid code or empty>",
  "video_suggestions":["https://youtube.com/..."]
}
Question: ${question}
Preferred language: ${lang}
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: system }] }],
      temperature: 0.2,
      max_output_tokens: 1200,
    });

    const raw = (result && result.response && (await result.response.text())) || "";
    const parsed = safeJSON(raw);

    if (!parsed) {
      // fallback: return raw text as detailed answer
      return { short: raw.split("\n")[0].slice(0, 300), detailed: raw, mermaid: "", videos: [] };
    }

    return {
      short: parsed.short_answer || parsed.short || "",
      detailed: parsed.detailed_answer || parsed.detailed || parsed.answer || "",
      mermaid: parsed.mermaid || "",
      videos: Array.isArray(parsed.video_suggestions) ? parsed.video_suggestions : (parsed.videos || []),
    };
  } catch (err) {
    console.error("Gemini call error:", err?.message || err);
    return { short: "Error from AI", detailed: "Please try again later.", mermaid: "", videos: [] };
  }
}

// ---------------- Express server ----------------
const app = express();
app.use(bodyParser.json());

// webhook verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// webhook messages
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("Incoming:", from, text);

    // load db
    const db = await readDB();
    db.users = db.users || {};
    db.logs = db.logs || [];
    db.tests = db.tests || {};

    if (!db.users[from]) db.users[from] = { lang: "English", createdAt: Date.now() };

    // commands
    const lc = text.trim().toLowerCase();

    if (lc.startsWith("set language")) {
      const lang = text.split(" ").slice(2).join(" ") || "English";
      db.users[from].lang = lang;
      await writeDB(db);
      await sendWhatsAppText(from, `✅ Language set to ${lang}`);
      return res.sendStatus(200);
    }

    if (["help", "menu", "options"].includes(lc)) {
      await sendWhatsAppText(from, "OPTIONS:\n1) Ask study question\n2) set language Hindi\n3) weekly test");
      return res.sendStatus(200);
    }

    if (lc.includes("weekly test")) {
      const id = nanoid(6);
      db.tests[id] = { user: from, createdAt: Date.now(), status: "created" };
      await writeDB(db);
      await sendWhatsAppText(from, `Weekly test created! ID = ${id}`);
      return res.sendStatus(200);
    }

    // normal question -> ask Gemini
    await writeDB(db); // ensure user saved
    const lang = db.users[from].lang || "English";
    const response = await askGemini(text, lang);

    // send short
    if (response.short) await sendWhatsAppText(from, `📌 Short:\n${response.short}`);

    // send detailed in chunks
    const detailed = response.detailed || "";
    if (detailed) {
      const chunks = detailed.match(/[\s\S]{1,1500}/g) || [detailed];
      for (const c of chunks) {
        await sendWhatsAppText(from, c);
      }
    }

    // mermaid diagram
    if (response.mermaid) {
      const url = makeMermaidUrl(response.mermaid);
      if (url) await sendWhatsAppImage(from, url, "Diagram");
    }

    // videos
    if (Array.isArray(response.videos) && response.videos.length) {
      await sendWhatsAppText(from, "🎥 Videos:\n" + response.videos.slice(0, 3).join("\n"));
    }

    // log
    db.logs.push({ id: nanoid(), user: from, q: text, time: Date.now() });
    await writeDB(db);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook handler error:", err?.message || err);
    // avoid retries
    return res.sendStatus(200);
  }
});

// health
app.get("/", (req, res) => res.send("STUDY BOT AI RUNNING ✔"));

// listen
app.listen(PORT, () => console.log("🚀 Server running on PORT", PORT));
