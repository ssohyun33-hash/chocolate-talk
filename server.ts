import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up JSON body limits to support camera image uploads safely
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Lazy-loaded Gemini SDK helper to prevent startup crash if API key is missing
let aiClient: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// REST endpoint for scanning user ID from image snaps using Gemini 3.5 Flash vision
app.post("/api/scan-id", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      res.status(400).json({ error: "Missing base64 image data" });
      return;
    }

    // Clean base64 pattern
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const ai = getGemini();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data
          }
        },
        "Locate any 8-digit numeric identifier or code (e.g. 10493820 or any other 8 adjacent digits) in the visual page. Return ONLY the 8 digits, nothing else. No punctuation, no markers, no markdown blocks. If no 8-digit number is found, return 'none'."
      ]
    });

    const parsedCode = response.text ? response.text.trim().replace(/\s/g, "") : "none";
    res.json({ id: parsedCode });
  } catch (error: any) {
    console.error("Failed to perform OCR on image:", error);
    res.status(500).json({ error: error.message || "Failed to parse camera snapshot" });
  }
});

// Bootstrapper for dev process or static client asset hosting
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT}`);
  });
}

startServer();
