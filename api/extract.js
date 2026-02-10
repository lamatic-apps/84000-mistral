import { extractMetadata } from "../lib/extract.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7);
  if (token !== process.env.API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  // Validate body
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing 'url' in request body" });
  }

  try {
    const result = await extractMetadata(url);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Extraction failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
