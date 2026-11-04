import { handleApi } from "@/lib/api/router";

type Params = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Params) {
  const { path } = await params;
  return handleApi(request, path);
}

export const GET = handle;
export const POST = handle;
