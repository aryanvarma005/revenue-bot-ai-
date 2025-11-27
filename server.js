const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ----------------- ENV VARIABLES -----------------
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!WHATSAPP_TOKEN || !VERIFY_TOKEN || !PHONE_NUMBER_ID || !GEMINI_API_KEY) {
  console.error("❌ Missing environment variables");
}

// Gemini init
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let model = null;
try {
 model = genAI.getGenerativeModel({ model: "gemini-pro" });
} catch (err) {
  console.error("❌ Gemini Init Error:", err);
}

// Express app
const app = express();
app.use(bodyParser.json());

// -------------------- AI FUNCTION --------------------
async function askGemini(prompt) {
  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("🔥 Gemini Error:", err.response?.data || err);
    return "⚠ Gemini AI error! Please try again.";
  }
}

// -------------------- SEND WHATSAPP MESSAGE --------------------
async function sendWhatsAppMessage(to, text) {
  try {
    const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    console.log("📩 WA Sent:", response.data);
    return response.data;
  } catch (err) {
    console.error("❌ WhatsApp Send Error:", err.response?.data || err);
    return null;
  }
}

// -------------------- WEBHOOK VERIFY --------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook Verified ✔");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// -------------------- RECEIVE WHATSAPP MESSAGE --------------------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body || "";

    console.log("💬 Incoming:", from, text);

    // AI Generate Answer
    const aiResponse = await askGemini(
      `You are REVENUE BOT AI. Explain clearly and simply:\n\nQ: ${text}`
    );

    await sendWhatsAppMessage(from, aiResponse);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Incoming Message Error:", err);
    return res.sendStatus(200);
  }
});

// -------------------- HOME ROUTE --------------------
app.get("/", (req, res) => {
  res.send("🔥 REVENUE BOT AI is LIVE & RUNNING!");
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});