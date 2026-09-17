import type { NextConfig } from "next";

/**
 * Recall — static-export PWA.
 *
 * GitHub Pages: the build produces a fully static site in `out/` (no server).
 * For a project page (https://user.github.io/<repo>/) set:
 *   NEXT_PUBLIC_BASE_PATH=/<repo>
 * before building so all assets resolve from the subpath.
 * For a user/organization root page (or a custom domain) leave it unset.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
  // allow an isolated build dir (e.g. NEXT_DIST_DIR=.next-pages) so a static
  // export can run alongside the dev server without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
