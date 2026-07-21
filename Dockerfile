# syntax=docker/dockerfile:1
# Web3.0 node — public container image.
#
# Two stages on purpose: the `build` stage has the full (private) source and compiles the node into a
# single flat file; the `runtime` stage copies ONLY that compiled bundle. The published image
# therefore contains no TypeScript source, no workspace packages, and no repo history — the same
# "closed source, open binary" shape as the desktop installers.
#
#   docker build -t web3-node .
#   docker run -p 8787:8787 web3-node

# ---- build: compile the node to one dependency-free file --------------------------------------
FROM node:20-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN mkdir -p /out && pnpm --filter @web3/node exec node scripts/bundle.mjs /out/node-bundle.cjs

# ---- runtime: ship only the compiled bundle ---------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WEB3_HOST=0.0.0.0 \
    WEB3_PORT=8787
# Only the compiled bundle crosses the stage boundary; the source stays behind in `build`.
COPY --from=build /out/node-bundle.cjs ./node-bundle.cjs
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEB3_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node-bundle.cjs"]
