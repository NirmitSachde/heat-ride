import { defineConfig, defaultClientConditions } from "vite";

export default defineConfig({
  base: "/street-skin/",
  // deck.gl / luma.gl ship a WebGL-only build; we never use WebGPU, so skip that code.
  resolve: { conditions: ["visgl:webgl-only", ...defaultClientConditions] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl")) return "maplibre";
          if (id.includes("@deck.gl") || id.includes("@luma.gl") || id.includes("@math.gl") || id.includes("@loaders.gl") || id.includes("@probe.gl")) return "deck";
          if (id.includes("/p5/")) return "p5";
          if (id.includes("/d3")) return "d3";
          return undefined;
        },
      },
    },
  },
});
