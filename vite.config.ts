import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// VITE_BASE is set by the GitHub Pages workflow to the repo subpath
// ("/goodguys-realtor-crm/"). Locally and on a custom domain it stays "/".
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // strictPort: a drifting port changes the OTP `emailRedirectTo`, and the new
  // origin will not be in Supabase's redirect allow-list, so sign-in links
  // silently stop working. Better to fail here than to debug that again.
  server: { port: 5174, strictPort: true },
});
