#!/usr/bin/env node
const https = require("https");
https.get("https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings/embeddings_2d.json", (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    const photos = JSON.parse(data);
    const patterns = {};
    photos.forEach(p => {
      if (!p.name) return;
      const parts = p.name.split("/");
      const subject = parts[0].trim().toLowerCase();
      const words = subject.split(/\s+/).slice(0, 2).join(" ");
      patterns[words] = (patterns[words] || 0) + 1;
    });

    console.log("=== MOST COMMON NAME PATTERNS ===");
    Object.entries(patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([pattern, count]) => {
        console.log(count.toString().padStart(5) + "  " + pattern);
      });
  });
});
