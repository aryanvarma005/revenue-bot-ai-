// server.js
const express = require("express");
const bodyParser = require("body-parser")
const axios = require("axios"); 
// ----------------- CONFIG (use the values you provided) -----------------
const WHATSAPP_TOKEN = "EAAhdOzTcnDABQJ7Hldapgxal2OVUswrSqZBkhreseQJ2yBTHfCq4mSmP55Bh0NyZBQD7VIfyhEtCGpZCQB5dJ8hlYcWKdPzo4JEIWPUDKINweZBVwQYGgvzAMSqLWZCKcbgTuoGQH7WzUoZATYEyAYz7kfTL1sxb2OkN2ZCS1u7IDZCI1KxOZCY15Wab9pBdkXe106wZDZD";
const PHONE_NUMBER_ID = "885442727987273";
const WHATSAPP_BUSINESS_ID = "1102006881830575";
const VERIFY_TOKEN = "REVENUE_BOT_AI_VERIFY"; // keep same or change if you configured different on Meta

// ----------------- Simple in-memory session store (prototype) -----------------
const sessions = {}; // key = user phone (from)

// helper: create/get session
function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      state: "NEED_ID", // NEED_ID -> NEED_PASSWORD -> LOGGED_IN -> CHANGING_TEACHER
      tempStudentId: null,
      studentId: null,
      expiresAt: null,
      voiceStyle: "female_teacher",
      preferredLanguage: "en",
    };
  }
  return sessions[userId];
}

function getTodayMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
}

function ensureNotExpired(session) {
  if (!session || !session.expiresAt) return;
  if (new Date() > session.expiresAt) {
    session.state = "NEED_ID";
    session.studentId = null;
    session.tempStudentId = null;
    session.expiresAt = null;
  }
}

// ----------------- WhatsApp API sender (real) -----------------{
async function sendWhatsAppMessage(to, text) {
  try {
    const url = `https://graph.facebook.com/v16.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: to,
      text: { body: text },
    };

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      }
    });

    console.log("WhatsApp API Response:", res.data);
    return res.data;

  } catch (err) {
    console.error("Error sending WhatsApp message:", err.response ? err.response.data : err);
    return null;
  }
}

// ----------------- AI placeholder functions (replace with real model later) -----------------
async function generateTextAnswer(question, language = "en") {
  return `Here is a basic explanation of your doubt:\n\nQuestion: "${question}"\n\nThis is the REVENUE BOT AI prototype answer. In the full version this will be a step-by-step solution (text, diagram, voice or video on demand).`;
}

async function generateDiagramPlaceholder() {
  return "[DIAGRAM PLACEHOLDER]\n(Real diagrams will be attached or sent as media in final app.)";
}

async function generateVoicePlaceholder(voiceStyle) {
  return `[VOICE PLACEHOLDER]\n(Will send voice in style: ${voiceStyle})`;
}

async function generateVideoPlaceholder() {
  return "[VIDEO PLACEHOLDER]\n(Will send short explanatory video)";
}

async function generateSimpleExplanation() {
  return "[SIMPLE EXPLANATION]\n(Simple explanation content)";
}

async function generateAdvancedExplanation() {
  return "[ADVANCED EXPLANATION]\n(Advanced step-by-step breakdown)";
}

function getOptionsMenuText() {
  return `Choose your format:\n\n- DIAGRAM  → Diagram explanation\n- VOICE    → Voice explanation\n- VIDEO    → Video explanation\n- SIMPLE   → Easy explanation\n- ADVANCED → In-depth explanation\n- CHANGE TEACHER → Change teacher's voice\n`;
}

function getTeacherVoiceMenu() {
  return `Choose your teacher voice:\n\n- MALE\n- FEMALE\n- YOUTH\n- ROBOT\n`;
}

function mapVoiceKeywordToStyle(keyword) {
  switch ((keyword || "").toUpperCase().trim()) {
    case "MALE": return "male_teacher";
    case "FEMALE": return "female_teacher";
    case "YOUTH": return "friendly_young_tutor";
    case "ROBOT": return "robotic_ai";
    default: return null;
  }
}

// ----------------- Express app and webhook handling -----------------
const app = express();
app.use(bodyParser.json());

// Webhook verification for GET
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Utility: parse incoming message from WhatsApp Cloud webhook payload
function parseWhatsAppMessage(body) {
  // Meta's structure: body.entry[0].changes[0].value.messages[0]
  try {
    if (!body || !body.entry) return null;
    for (const entry of body.entry) {
      if (!entry.changes) continue;
      for (const change of entry.changes) {
        const v = change.value;
        if (!v) continue;
        // messages can be present
        if (v.messages && v.messages.length > 0) {
          const msg = v.messages[0];
          const from = msg.from; // phone number of sender
          // text can be in msg.text.body or in msg.type-specific fields
          let text = "";
          if (msg.text && msg.text.body) text = msg.text.body;
          else if (msg.type === "interactive" && msg.interactive && msg.interactive.text) text = msg.interactive.text.body || "";
          return { from, text, raw: msg, meta: v };
        }
      }
    }
  } catch (e) {
    console.error("parse error", e);
  }
  return null;
}

// Main webhook POST: receives incoming messages from WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    // Try parse official structure first
    const parsed = parseWhatsAppMessage(req.body);

    // If parse failed, fallback to simple format used earlier (for local testing)
    let from, msg;
    if (parsed) {
      from = parsed.from;
      msg = (parsed.text || "").trim();
    } else {
      // fallback (if you used non-Meta simulator): expect { from: "...", message: "..." }
      from = req.body.from || null;
      msg = (req.body.message || "").trim();
    }

    if (!from || !msg) {
      // nothing meaningful; ack
      return res.sendStatus(200);
    }

    console.log("Incoming from:", from, "message:", msg);

    const session = getSession(from);
    ensureNotExpired(session);

    // State machine (same flow as your prototype)
    if (session.state === "NEED_ID") {
      const lc = msg.toLowerCase();
      if (lc === "hi" || lc === "hello") {
        await sendWhatsAppMessage(from, "Welcome to REVENUE BOT AI!\nPlease enter your Student ID:");
        return res.sendStatus(200);
      }
      // treat as id
      session.tempStudentId = msg;
      session.state = "NEED_PASSWORD";
      await sendWhatsAppMessage(from, `Student ID received: ${msg}\nNow enter your password:`);
      return res.sendStatus(200);
    }

    if (session.state === "NEED_PASSWORD") {
      // auto-login for prototype
      session.studentId = session.tempStudentId;
      session.tempStudentId = null;
      session.state = "LOGGED_IN"; 
      session.expiresAt = getTodayMidnight();
      await sendWhatsAppMessage(from, `Login successful! 🎉\nYou are logged in as ${session.studentId}.\nSession expires at 12:00 AM tonight.`);
      return res.sendStatus(200);
    }

    // logged in
    if (session.state === "LOGGED_IN") {
      const up = msg.trim().toUpperCase();

      // handle teacher change initiation
      if (up === "CHANGE TEACHER") {
        session.state = "CHANGING_TEACHER";
        await sendWhatsAppMessage(from, getTeacherVoiceMenu());
        return res.sendStatus(200);
      }

      // if in changing teacher state, map choice
      if (session.state === "CHANGING_TEACHER") {
        const newVoice = mapVoiceKeywordToStyle(msg);
        if (!newVoice) {
          await sendWhatsAppMessage(from, "Invalid choice. Type MALE / FEMALE / YOUTH / ROBOT.");
          return res.sendStatus(200);
        }
        session.voiceStyle = newVoice;
        session.state = "LOGGED_IN";
        await sendWhatsAppMessage(from, `Teacher voice updated to: ${newVoice}`);
        return res.sendStatus(200);
      }

      // content options
      if (up === "DIAGRAM") {
        await sendWhatsAppMessage(from, await generateDiagramPlaceholder());
        return res.sendStatus(200);
      }
      if (up === "VOICE") {
        await sendWhatsAppMessage(from, await generateVoicePlaceholder(session.voiceStyle));
        return res.sendStatus(200);
      }
      if (up === "VIDEO") {
        await sendWhatsAppMessage(from, await generateVideoPlaceholder());
        return res.sendStatus(200);
      }
      if (up === "SIMPLE") {
        await sendWhatsAppMessage(from, await generateSimpleExplanation());
        return res.sendStatus(200);
      }
      if (up === "ADVANCED") {
        await sendWhatsAppMessage(from, await generateAdvancedExplanation());
        return res.sendStatus(200);
      }

      // default: treat as doubt question
      const ans = await generateTextAnswer(msg, session.preferredLanguage);
      await sendWhatsAppMessage(from, ans);
      await sendWhatsAppMessage(from, getOptionsMenuText());
      return res.sendStatus(200);
    }

    // safety
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.sendStatus(200);
  }
});

// Health check (easy to test)
app.get("/", (req, res) => {
  res.send("REVENUE BOT AI prototype running.");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`REVENUE BOT AI prototype server running on port ${PORT}`);
});
