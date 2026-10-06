const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

const nextConfig = {
  reactStrictMode: true,
  ...(isGitHubPages
    ? {
        output: "export",
        basePath: "/NOVA",
        assetPrefix: "/NOVA/",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
