// Minimal Pages Router _error override to prevent Next.js from using
// its built-in _error page which imports from next/document and causes
// prerender failures in Next.js 15.x App Router projects.

import type { NextPageContext } from "next";

interface ErrorProps {
  statusCode?: number;
}

function Error({ statusCode }: ErrorProps) {
  return (
    <div>
      <p>{statusCode ? `Error ${statusCode}` : "An error occurred"}</p>
    </div>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default Error;
