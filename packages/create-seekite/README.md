# create-seekite

Scaffold a small Vite app with format-v2 indexing, worker-backed search, and
either the headless or React Seekite UI already connected.

```sh
pnpm create seekite my-search --template react
cd my-search
pnpm install
pnpm dev
```

Use `--template vanilla` for a dependency-free DOM UI. The generated app keeps
its content in `content/`, builds search assets through `@seekite/vite`, and
loads the runtime in `src/search.worker.ts`.
