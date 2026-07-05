// BASE_PATH is duplicated (not imported from a shared file) in lib/basePath.ts
// for client-side use. This was previously a cross-file require() from a
// repo-root .js into a lib/*.ts client file, which broke in practice (case
// mismatch on the shared filename, and a missing-module build error) --
// duplicating this one literal is lower-risk than that indirection. If you
// ever change the basePath below, update lib/basePath.ts to match.
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  output: "export",
  basePath: isProd ? "/space-3" : "",
  images: { unoptimized: true },
};

module.exports = nextConfig;