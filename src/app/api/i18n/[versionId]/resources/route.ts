import { NextResponse } from "next/server";
import {
  loadLocalizedResources,
  localizedDatasetHash,
  searchLocalizedResources,
} from "@/lib/server/localized-resources";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;
  const url = new URL(request.url);
  const hash = localizedDatasetHash(versionId);
  if (!hash)
    return NextResponse.json(
      { error: "Localized search is unavailable for this dataset." },
      { status: 404 },
    );
  if (url.searchParams.get("datasetHash") !== hash)
    return NextResponse.json(
      { error: "Localized search needs the current dataset." },
      { status: 409 },
    );
  const query = url.searchParams.get("query") ?? "";
  if (query.length > 128)
    return NextResponse.json({ error: "Search is too long." }, { status: 400 });
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(url.searchParams.get(name) ?? fallback);
    return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : fallback;
  };
  try {
    const pack = await loadLocalizedResources(versionId);
    const result = searchLocalizedResources(pack.resources, {
      query,
      offset: integer("offset", 0, 100000),
      limit: Math.max(1, integer("limit", 60, 120)),
      kind: url.searchParams.get("kind") ?? undefined,
      mod: url.searchParams.get("mod") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json(
      { error: "Localized search is temporarily unavailable." },
      { status: 503 },
    );
  }
}
