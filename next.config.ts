import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dit is een volledig dynamische, geauthenticeerde applicatie (geen
  // marketingpagina's): experimentele statische caching-features van
  // Next.js bewust uitgeschakeld om te voorkomen dat gebruikersspecifieke
  // of vertrouwelijke data per ongeluk tussen gebruikers gecached wordt.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
