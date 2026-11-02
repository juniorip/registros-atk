import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  const filePath = join(process.cwd(), "public", "legacy.html");
  const source = await readFile(filePath, "utf8");
  const html = process.env.ATK_LOCAL_PREVIEW === "1" ? source.replace("<body>", '<body data-local-preview="true">') : source;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
