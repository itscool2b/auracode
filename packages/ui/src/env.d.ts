// Vite's `?raw` suffix imports a file's text. Only the token consistency tests use it; declaring it
// here keeps the package free of `vite/client` and `@types/node`.
declare module "*.css?raw" {
  const content: string;
  export default content;
}

// The Graphite source checks (no em dashes, integer weights) read their own modules as text.
declare module "*.ts?raw" {
  const content: string;
  export default content;
}

declare module "*.tsx?raw" {
  const content: string;
  export default content;
}
