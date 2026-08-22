import { defineConfig } from "astro/config";
import { seekite } from "@seekite/astro";

export default defineConfig({ integrations: [seekite()] });
