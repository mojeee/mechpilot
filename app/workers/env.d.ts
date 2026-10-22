// Vite asset imports used by the workers (tsconfig.workers.json has no vite/client types).
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
