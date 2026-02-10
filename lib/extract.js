import { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { responseFormatFromZodObject } from "@mistralai/mistralai/extra/structChat.js";

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

const COST_PER_PAGE = 0.003; // $3/1000 pages (annotated OCR)

const MetadataSchema = z.object({
  bibliographical_title: z
    .string()
    .describe(
      "The bibliographical title of the text, usually found in the initial pages"
    ),
  author: z
    .string()
    .describe(
      "The author of this document, usually found in the earlier pages"
    ),
  publisher: z
    .string()
    .describe(
      "The publication house(s) or entities of this document, found in the earlier pages"
    ),
  publication_year: z
    .string()
    .describe(
      "The year of publication of this document, usually found in the earlier pages near the publisher info"
    ),
  description: z
    .string()
    .describe(
      "A description encompassing the title, author, and publisher in 2-3 lines"
    ),
  summary: z
    .string()
    .describe(
      "A comprehensive ~200 word summary of the document covering its main themes, arguments, and significance"
    ),
});

const metadataExtractionPrompt = `You are a document analyser whose job is to analyse all pages of the document to provide the following information (below given is their details and the format in which you have to return this information):

{
  "bibliographical_title": "string" // This implies the bibliographical title of the text, usually can be found in the initial pages
  "author": "string", // The author of this document, usually found in the earlier pages in the document
  "publisher": "string", // The publication house(s) or entities of this document, which can be found in the earlier pages of the document
  "publication_year": "string", // The year of publication, usually found in the earlier pages near the publisher info
  "description": "string", // The description which encompasses all of the above in 2-3 lines
  "summary": "string" // A comprehensive summary of approximately 200 words that covers the main themes, key arguments, subject matter, and significance of the document. The summary should give a reader a clear understanding of what the document is about, its scope, and its contribution to the field.
}

Make sure you find all the information from these pages and answer in the desired format only. If you are unable to find the information of author or publication, you can enter the most relevant information or the one which seems ideal in the case. However, you would be able to find both of these in the starting few pages of the document as defined above, if not, you can see the entire document for it. Remember, we just need the names in author and publisher, no leading statements or assumptions you make.

For the summary, read through the entire document and produce a ~200 word summary that captures:
- The main subject matter and themes
- Key arguments or findings
- The scope and structure of the work
- Its significance or contribution to the field

Return ONLY the JSON object with these six fields, nothing else.`;

export async function extractMetadata(documentUrl) {
  const startTime = Date.now();

  const response = await client.ocr.process({
    model: "mistral-ocr-latest",
    document: {
      type: "document_url",
      documentUrl,
    },
    documentAnnotationFormat: responseFormatFromZodObject(MetadataSchema),
    documentAnnotationPrompt: metadataExtractionPrompt,
    includeImageBase64: false,
  });

  const elapsedMs = Date.now() - startTime;
  const pages = response.pages?.length || 0;

  const metadata = response.documentAnnotation
    ? JSON.parse(response.documentAnnotation)
    : null;

  if (!metadata) {
    throw new Error("Mistral OCR returned no metadata for this document");
  }

  const totalTimeSec = (elapsedMs / 1000).toFixed(2);
  const timePerPage = pages > 0 ? (elapsedMs / 1000 / pages).toFixed(2) : "N/A";
  const totalCost = (pages * COST_PER_PAGE).toFixed(4);

  console.log(`  Pages: ${pages} | Time: ${totalTimeSec}s (${timePerPage}s/page) | Cost: $${totalCost} ($${COST_PER_PAGE}/page)`);

  return {
    bibliographical_title: metadata.bibliographical_title,
    author: metadata.author,
    publisher: metadata.publisher,
    publication_year: metadata.publication_year,
    description: metadata.description,
    summary: metadata.summary,
    pages,
  };
}
