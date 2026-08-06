interface WebpackContext {
  (request: string): unknown;
  keys(): string[];
  resolve(request: string): string | number;
  id: string | number;
}

interface ImportMeta {
  webpackContext(
    directory: string,
    options?: {
      recursive?: boolean;
      regExp?: RegExp;
      include?: RegExp;
      exclude?: RegExp;
      mode?: "sync" | "eager" | "weak" | "lazy" | "lazy-once";
    },
  ): WebpackContext;
}
