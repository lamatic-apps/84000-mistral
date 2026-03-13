import { PDFDocument } from "pdf-lib";

const COST_PER_PAGE = 0.003; // $3/1000 pages (annotated OCR)
const MAX_PAGES = 100;

const AZURE_OCR_ENDPOINT =
  process.env.AZURE_OCR_ENDPOINT ||
  "https://aman-7900-resource.services.ai.azure.com/providers/mistral/azure/ocr";

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

const jsonSchema = {
  type: "json_schema",
  json_schema: {
    schema: {
      properties: {
        bibliographical_title: {
          title: "Bibliographical_Title",
          description:
            "The bibliographical title of the text, usually found in the initial pages",
          type: "string",
        },
        author: {
          title: "Author",
          description:
            "The author of this document, usually found in the earlier pages",
          type: "string",
        },
        publisher: {
          title: "Publisher",
          description:
            "The publication house(s) or entities of this document, found in the earlier pages",
          type: "string",
        },
        publication_year: {
          title: "Publication_Year",
          description:
            "The year of publication of this document, usually found in the earlier pages near the publisher info",
          type: "string",
        },
        description: {
          title: "Description",
          description:
            "A description encompassing the title, author, and publisher in 2-3 lines",
          type: "string",
        },
        summary: {
          title: "Summary",
          description:
            "A comprehensive ~200 word summary of the document covering its main themes, arguments, and significance",
          type: "string",
        },
      },
      required: [
        "bibliographical_title",
        "author",
        "publisher",
        "publication_year",
        "description",
        "summary",
      ],
      title: "MetadataSchema",
      type: "object",
      additionalProperties: false,
    },
    name: "document_annotation",
    strict: true,
  },
};

async function downloadAndPreparePdf(documentUrl) {
  const res = await fetch(documentUrl);
  if (!res.ok) {
    throw new Error(`Failed to download PDF: ${res.status} ${res.statusText}`);
  }
  let pdfBytes = new Uint8Array(await res.arrayBuffer());

  const srcDoc = await PDFDocument.load(pdfBytes);
  const pageCount = srcDoc.getPageCount();

  if (pageCount > MAX_PAGES) {
    console.log(
      `  PDF has ${pageCount} pages, extracting first ${MAX_PAGES}...`
    );
    const trimmedDoc = await PDFDocument.create();
    const copiedPages = await trimmedDoc.copyPages(
      srcDoc,
      Array.from({ length: MAX_PAGES }, (_, i) => i)
    );
    for (const page of copiedPages) {
      trimmedDoc.addPage(page);
    }
    pdfBytes = await trimmedDoc.save();
  }

  return Buffer.from(pdfBytes).toString("base64");
}

export async function extractMetadata(documentUrl) {
  const startTime = Date.now();

  const base64Pdf = await downloadAndPreparePdf(documentUrl);
  const dataUri = `data:application/pdf;base64,${base64Pdf}`;

  const payload = {
    model: "mistral-document-ai-2512",
    document: {
      type: "document_url",
      document_url: dataUri,
    },
    document_annotation_format: jsonSchema,
    document_annotation_prompt: metadataExtractionPrompt,
    include_image_base64: false,
  };

  const res = await fetch(AZURE_OCR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AZURE_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure OCR request failed: ${res.status} — ${body}`);
  }

  const result = await res.json();

  const elapsedMs = Date.now() - startTime;
  const pages = result.usage_info?.pages_processed_annotation || 0;

  const metadata = result.document_annotation
    ? JSON.parse(result.document_annotation)
    : null;

  if (!metadata) {
    throw new Error("Azure Mistral OCR returned no metadata for this document");
  }

  const totalTimeSec = (elapsedMs / 1000).toFixed(2);
  const timePerPage =
    pages > 0 ? (elapsedMs / 1000 / pages).toFixed(2) : "N/A";
  const totalCost = (pages * COST_PER_PAGE).toFixed(4);

  console.log(
    `  Pages: ${pages} | Time: ${totalTimeSec}s (${timePerPage}s/page) | Cost: $${totalCost} ($${COST_PER_PAGE}/page)`
  );

  return {
    bibliographical_title: metadata.bibliographical_title,
    author: metadata.author,
    publisher: metadata.publisher,
    publication_year: metadata.publication_year,
    description: metadata.description,
    summary: metadata.summary,
    pages,
    benchmark: {
      total_time_sec: parseFloat(totalTimeSec),
      time_per_page_sec: pages > 0 ? parseFloat(timePerPage) : null,
      total_cost_usd: parseFloat(totalCost),
      cost_per_page_usd: COST_PER_PAGE,
    },
  };
}
