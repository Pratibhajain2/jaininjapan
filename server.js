const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PROMPT = `You are a Jain food expert with comprehensive knowledge of vegetarian and Jain-friendly restaurants in Japan.

When given a city name, return a JSON array of ALL real, verified vegetarian/Jain-friendly restaurants in that city. Be thorough — aim for 10-20 results.

For Tokyo always include: ALL Nataraj branches (Ikebukuro, Shibuya, Shinjuku, Ginza), Vege Herb Saga (Ogikubo), Govinda's ISKCON (Edogawa), Milan Nataraj (Shibuya), Veg Kitchen Tokyo (Taito), T's Tantan (Tokyo Station, Ueno, Ikebukuro).
For Osaka always include: Shama Vegetarian (Shinsaibashi), Gopinatha ISKCON, Khazana Restaurant.
For Kyoto always include: Krishna ISKCON Kyoto, Kerala Indian Restaurant, Shigetsu at Tenryu-ji.
For Koyasan: Shojin Ryori at temple lodgings.

Each object MUST have exactly these fields:
{
  "name": "exact restaurant name",
  "area": "specific neighbourhood",
  "address": "street address if known",
  "nearestStation": "nearest train/metro station",
  "tags": array using only "jain","no-og","pure-veg","vegan" — only verified,
  "note": "2 honest sentences on Jain suitability and caveats",
  "menuHighlights": ["dish1","dish2","dish3"],
  "dietaryOptions": {
    "jain":"yes|no|ask","noOnionGarlic":"yes|no|ask",
    "pureVeg":"yes|no|ask","vegan":"yes|no|ask",
    "dairyFree":"yes|no|ask","glutenFree":"yes|no|ask"
  },
  "price":"budget|mid|upscale",
  "callAhead": true or false,
  "hours":"hours if known",
  "phone":"phone if known",
  "website":"website if known",
  "mapsUrl":"https://www.google.com/maps/search/[URL-encoded name + area + city + Japan]"
}

Output ONLY the raw JSON array. No markdown, no backticks, no explanation. Start with [ end with ].`;

// Models to try in order — first one that works wins
const GEMINI_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
  "gemini-pro",
];

async function callGemini(city) {
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${PROMPT}\n\nList all Jain-friendly and pure vegetarian Indian restaurants in ${city}, Japan. Be thorough. Output only the JSON array.` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
        }),
      });
      const data = await response.json();
      // Check for error
      if (data.error) {
        console.log(`Model ${model} failed: ${data.error.message}`);
        lastError = data.error.message;
        continue; // try next model
      }
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!raw) { lastError = "Empty response"; continue; }
      return raw; // success
    } catch (err) {
      console.log(`Model ${model} threw: ${err.message}`);
      lastError = err.message;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// API endpoint
app.post("/api/restaurants", async (req, res) => {
  const { city } = req.body;
  if (!city) return res.status(400).json({ error: "city is required" });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set on server" });

  try {
    const raw = await callGemini(city);
    const clean = raw.replace(/```json|```/gi, "").trim();
    const s = clean.indexOf("["), e = clean.lastIndexOf("]");
    if (s === -1 || e <= s) return res.status(500).json({ error: "Could not parse restaurant data" });
    const parsed = JSON.parse(clean.slice(s, e + 1));
    res.json({ restaurants: parsed });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Serve frontend
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`JainJapan running on port ${PORT}`));
