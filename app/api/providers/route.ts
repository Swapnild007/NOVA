import { getNovaProviderCapabilities } from "@/app/api/chat/free-providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      providers: getNovaProviderCapabilities(),
      policy: "strict-free-core",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
