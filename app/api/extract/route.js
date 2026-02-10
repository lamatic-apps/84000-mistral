import { extractMetadata } from "../../../lib/extract.js";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  if (token !== process.env.API_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
  }

  // Validate body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Missing 'url' in request body" },
      { status: 400 }
    );
  }

  try {
    const result = await extractMetadata(url);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Extraction failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
