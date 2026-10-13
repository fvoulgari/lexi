import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Only build outputs explicitly listed here are eligible for Cache Storage.
export function staticPwa() {
  let output;
  return {
    name: "notebook-static-pwa",
    apply: "build",
    configResolved(config) {
      output = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = [
        "index.html",
        "manifest.webmanifest",
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png",
        ...readdirSync(resolve(output, "assets")).map(
          (name) => `assets/${name}`,
        ),
      ];
      const hash = createHash("sha256");
      for (const file of files)
        hash.update(readFileSync(resolve(output, file)));
      const template = readFileSync(
        new URL("./service-worker.js", import.meta.url),
        "utf8",
      );
      writeFileSync(
        resolve(output, "sw.js"),
        template
          .replace("__CACHE_VERSION__", hash.digest("hex").slice(0, 16))
          .replaceAll(
            "__STATIC_FILES__",
            JSON.stringify(files.map((file) => `/${file}`)),
          ),
      );
    },
  };
}
