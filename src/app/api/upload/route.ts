import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ALLOWED_DECK_TYPES, MAX_DECK_BYTES } from "@/lib/validation";

/**
 * Vercel Blob "client upload" token endpoint.
 *
 * The browser calls `upload(..., { handleUploadUrl: "/api/upload" })`, which
 * POSTs here to mint a short-lived upload token, then streams the file DIRECTLY
 * to Blob storage — bypassing the 4.5 MB serverless request-body limit.
 *
 * We authorize the request (must be a TEAM user) and constrain content type /
 * size before issuing the token.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        if (!session?.user || session.user.role !== "TEAM" || !session.user.teamId) {
          throw new Error("Only signed-in team accounts can upload a pitch deck");
        }
        return {
          allowedContentTypes: [...ALLOWED_DECK_TYPES],
          maximumSizeInBytes: MAX_DECK_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ teamId: session.user.teamId }),
        };
      },
      onUploadCompleted: async () => {
        // Fires only on a publicly reachable deployment (Vercel), not localhost.
        // The submission is persisted separately by POST /api/submissions, so
        // there is nothing required here; hook in logging/virus-scan if needed.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
