import { getNovaCapabilitySummary } from "../chat/nova-capability-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getNovaCapabilitySummary(), {
    headers: { "Cache-Control": "no-store" },
  });
}
