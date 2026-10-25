import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("@webtui/css"));
const files = [
  "base.css",
  "utils/box.css",
  "components/typography.css",
  "components/button.css",
  "components/input.css",
  "components/textarea.css",
  "components/checkbox.css",
  "components/badge.css",
  "components/table.css",
  "components/pre.css",
];

const css = [
  "@layer base, utils, components;",
  ...files.map((file) => readFileSync(join(root, file), "utf8")),
  readFileSync(new URL("../public/theme.css", import.meta.url), "utf8"),
].join("\n");

writeFileSync(new URL("../public/app.css", import.meta.url), css);
