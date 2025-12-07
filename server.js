// ----------------------------------------------------
// STUDY DOUBT SOLVER AI - FINAL CLEAN VERSION (2025)
// ----------------------------------------------------

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const fs = require("fs").promises;
const path = require("path");
const { nanoid } = require("nanoid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ---------------- ENV ----------------
const PORT = parseInt(process.env.PORT || "10000", 10);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "REVENUE_BOT_AI_VERIFY";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !GEMINI_API_KEY) {
  console.warn("⚠ Missing env vars (WhatsApp or Gemini). Fix .env file.");
}

// ---------------- tiny JSON DB ----------------
const DB_PATH = path.join(__dirname, "db.json");

async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { users: {}, logs: [], tests: {} };
  }
}

async function writeDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ---------------- Gemini Init ----------------
let model = null;

try {
  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
  console.log("✅ Gemini initialized");
} catch (err) {
  console.error("❌ Gemini init failed:", err?.message);
}

// ---------------- Helper: WhatsApp Text ----------------
async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
  } catch (err) {
    console.log("WA text error:", err?.response?.data || err.message);
  }
}

// ---------------- Helper: WhatsApp Image ----------------
async function sendWhatsAppImage(to, imageUrl, caption = "") {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption }
  };

  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
  } catch (err) {
    console.log("WA image error:", err?.response?.data || err.message);
  }
}

// ---------------- Parse JSON Safely ----------------
function safeJSON(text) {
  if (!text) return null;

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {}
  }
  return null;
}

// ---------------- Gemini Ask Function (UPDATED 2025 FORMAT) ----------------
async function askGemini(question, lang = "English") {
  if (!model) {
    return {
      short: "AI unavailable",
      detailed: "Model not initialized",
      mermaid: "",
      videos: []
    };
  }

  const prompt = `
You are STUDY-BOT, an Indian tutor. 
Respond ONLY in valid JSON like:

{
  "short_answer": "...",
  "detailed_answer": "...",
  "mermaid": "",
  "video_suggestions": []
}

Question: ${question}
Language: ${lang}
`;

  try {
    const result = await model.generateContent(prompt);
    const raw = await result.response.text();

    const parsed = safeJSON(raw);

    if (!parsed) {
      return {
        short: raw.slice(0, 200),
        detailed: raw,
        mermaid: "",
        videos: []
      };
    }

    return {
      short: parsed.short_answer || "",
      detailed: parsed.detailed_answer || "",
      mermaid: parsed.mermaid || "",
      videos: parsed.video_suggestions || []
    };

  } catch (err) {
    console.error("Gemini error:", err.message);
    return {
      short: "Error from AI",
      detailed: "Please try again later.",
      mermaid: "",
      videos: []
    };
  }
}

// ---------------- Express App ----------------
const app = express();
app.use(bodyParser.json());

// ---------------- Verify Webhook ----------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ---------------- Handle WhatsApp Messages ----------------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("Incoming:", from, text);

    // Load DB
    const db = await readDB();
    db.users[from] ||= { lang: "English", createdAt: Date.now() };

    const lc = text.trim().toLowerCase();

    // ---------------- Commands ----------------
    if (lc.startsWith("set language")) {
      const lang = text.split(" ").slice(2).join(" ") || "English";
      db.users[from].lang = lang;
      await writeDB(db);

      await sendWhatsAppText(from, `✅ Language set to ${lang}`);
      return res.sendStatus(200);
    }

    if (["help", "menu", "options"].includes(lc)) {
      await sendWhatsAppText(
        from,
        "OPTIONS:\n1) Ask any study question\n2) set language Hindi\n3) weekly test"
      );
      return res.sendStatus(200);
    }

    if (lc.includes("weekly test")) {
      const id = nanoid(6);
      db.tests[id] = { user: from, createdAt: Date.now() };
      await writeDB(db);

      await sendWhatsAppText(from, `Weekly test created! ID = ${id}`);
      return res.sendStatus(200);
    }

    // ---------------- Gemini Answer ----------------
    const lang = db.users[from].lang;
    const ai = await askGemini(text, lang);

    if (ai.short)
      await sendWhatsAppText(from, `📌 Short:\n${ai.short}`);

    if (ai.detailed) {
      const chunks = ai.detailed.match(/[\s\S]{1,1500}/g) || [ai.detailed];
      for (const c of chunks) await sendWhatsAppText(from, c);
    }

    if (ai.mermaid) {
      const url = `https://mermaid.ink/svg/${encodeURIComponent(ai.mermaid)}`;
      await sendWhatsAppImage(from, url, "Diagram");
    }

    if (ai.videos?.length) {
      await sendWhatsAppText(from, "🎥 Videos:\n" + ai.videos.join("\n"));
    }

    // Log the Q
    db.logs.push({
      id: nanoid(),
      user: from,
      q: text,
      time: Date.now()
    });

    await writeDB(db);

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.sendStatus(200);
  }
});

// ---------------- Health ----------------
app.get("/", (req, res) => res.send("STUDY BOT AI RUNNING ✔"));

// ---------------- Start ----------------
app.listen(PORT, () =>
  console.log("🚀 Server running on PORT", PORT)
);
