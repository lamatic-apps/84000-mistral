#!/usr/bin/env bash
# Azure-hosted Mistral Document AI OCR — equivalent to lib/extract.js SDK call
#
# Azure's Mistral endpoint does NOT support document URLs directly;
# it requires base64-encoded content sent as a data URI.
#
# Usage:
# export AZURE_API_KEY="<your-azure-api-key>"

set -euo pipefail

DOCUMENT_URL="${1:?Usage: $0 <document-url>}"

# --- Temp file cleanup ---
TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

PDF_FILE="$TMPDIR_WORK/document.pdf"
BODY_FILE="$TMPDIR_WORK/body.json"

# --- Download PDF ---
echo "Downloading PDF..." >&2
curl -sS -o "$PDF_FILE" "$DOCUMENT_URL"

# --- Base64-encode directly to file (avoids shell ARG_MAX limit) ---
printf 'data:application/pdf;base64,' > "$TMPDIR_WORK/data_uri.txt"
if base64 --help 2>&1 | grep -q '^\s*-w'; then
  base64 -w0 "$PDF_FILE" >> "$TMPDIR_WORK/data_uri.txt"
else
  base64 -i "$PDF_FILE" | tr -d '\n' >> "$TMPDIR_WORK/data_uri.txt"
fi

echo "PDF encoded ($(wc -c < "$PDF_FILE" | tr -d ' ') bytes). Sending to Azure Mistral OCR..." >&2

# --- Build JSON payload with jq (avoids shell arg-length limits) ---
jq -n \
  --rawfile doc_uri "$TMPDIR_WORK/data_uri.txt" \
  '{
    "model": "mistral-document-ai-2512",
    "document": {
      "type": "document_url",
      "document_url": $doc_uri
    },
    "document_annotation_format": {
      "type": "json_schema",
      "json_schema": {
        "schema": {
          "properties": {
            "bibliographical_title": {
              "title": "Bibliographical_Title",
              "description": "The bibliographical title of the text, usually found in the initial pages",
              "type": "string"
            },
            "author": {
              "title": "Author",
              "description": "The author of this document, usually found in the earlier pages",
              "type": "string"
            },
            "publisher": {
              "title": "Publisher",
              "description": "The publication house(s) or entities of this document, found in the earlier pages",
              "type": "string"
            },
            "publication_year": {
              "title": "Publication_Year",
              "description": "The year of publication of this document, usually found in the earlier pages near the publisher info",
              "type": "string"
            },
            "description": {
              "title": "Description",
              "description": "A description encompassing the title, author, and publisher in 2-3 lines",
              "type": "string"
            },
            "summary": {
              "title": "Summary",
              "description": "A comprehensive ~200 word summary of the document covering its main themes, arguments, and significance",
              "type": "string"
            }
          },
          "required": ["bibliographical_title", "author", "publisher", "publication_year", "description", "summary"],
          "title": "MetadataSchema",
          "type": "object",
          "additionalProperties": false
        },
        "name": "document_annotation",
        "strict": true
      }
    },
    "document_annotation_prompt": "You are a document analyser whose job is to analyse all pages of the document to provide the following information (below given is their details and the format in which you have to return this information):\n\n{\n  \"bibliographical_title\": \"string\" // This implies the bibliographical title of the text, usually can be found in the initial pages\n  \"author\": \"string\", // The author of this document, usually found in the earlier pages in the document\n  \"publisher\": \"string\", // The publication house(s) or entities of this document, which can be found in the earlier pages of the document\n  \"publication_year\": \"string\", // The year of publication, usually found in the earlier pages near the publisher info\n  \"description\": \"string\", // The description which encompasses all of the above in 2-3 lines\n  \"summary\": \"string\" // A comprehensive summary of approximately 200 words that covers the main themes, key arguments, subject matter, and significance of the document. The summary should give a reader a clear understanding of what the document is about, its scope, and its contribution to the field.\n}\n\nMake sure you find all the information from these pages and answer in the desired format only. If you are unable to find the information of author or publication, you can enter the most relevant information or the one which seems ideal in the case. However, you would be able to find both of these in the starting few pages of the document as defined above, if not, you can see the entire document for it. Remember, we just need the names in author and publisher, no leading statements or assumptions you make.\n\nFor the summary, read through the entire document and produce a ~200 word summary that captures:\n- The main subject matter and themes\n- Key arguments or findings\n- The scope and structure of the work\n- Its significance or contribution to the field\n\nReturn ONLY the JSON object with these six fields, nothing else.",
    "include_image_base64": false
  }' > "$BODY_FILE"

# --- Send request --
curl -sS -X POST "https://aman-7900-resource.services.ai.azure.com/providers/mistral/azure/ocr" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_API_KEY" \
  -d @"$BODY_FILE" \
| jq '{
    metadata: (.document_annotation | fromjson),
    usage: {
      pages_processed: .usage_info.pages_processed_annotation,
      doc_size_bytes:   .usage_info.doc_size_bytes
    }
  }'