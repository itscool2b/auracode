// Build-time React prerendering only. No JavaScript server is deployed.
import { renderToReadableStream } from "react-dom/server.browser";
import { type EntryContext, ServerRouter } from "react-router";
export default async function render(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  const stream = await renderToReadableStream(<ServerRouter context={context} url={request.url} />);
  await stream.allReady;
  headers.set("Content-Type", "text/html");
  return new Response(stream, { status, headers });
}
