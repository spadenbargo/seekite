import { cp, rm } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(appRoot, "dist/server/search");
const destination = path.join(appRoot, "dist/client/search");

// TanStack Start's environment build closes the Seekite Vite plugin in the
// build-only server environment. The deployed site is entirely static, so
// stage those generated assets beside the prerendered client pages.
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
