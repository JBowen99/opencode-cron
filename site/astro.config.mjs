import { defineConfig } from "astro/config";

// Static landing page. Deploy this directory on its own domain.
export default defineConfig({
  output: "static",
});
