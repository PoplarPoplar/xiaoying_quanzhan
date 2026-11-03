import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const base = process.env.BACKEND_URL || "http://localhost:8080";
  const url = new URL("/api/" + path.map(encodeURIComponent).join("/"), base);
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const key of ["content-type", "cookie", "origin", "accept"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
      redirect: "manual",
    });
    const outgoing = new Headers();
    for (const key of [
      "content-type",
      "content-disposition",
      "x-content-type-options",
    ]) {
      const value = upstream.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    for (const cookie of upstream.headers.getSetCookie())
      outgoing.append("set-cookie", cookie);
    outgoing.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        code: "BACKEND_UNAVAILABLE",
        message: "暂时无法连接制作服务，请稍后重试",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as HEAD };
