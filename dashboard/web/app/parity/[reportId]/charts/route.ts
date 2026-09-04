export async function GET(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;
  const destination = new URL("/parity", request.url);
  destination.searchParams.set("report", reportId);
  destination.searchParams.set("view", "charts");
  return Response.redirect(destination);
}
