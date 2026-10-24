// Vite's `?raw` suffix imports a file's text. Only the token consistency tests use it; declaring it
// here keeps the package free of `vite/client` and `@types/node`.
declare module "*.css?raw" {
  const content: string;
  export default content;
}
