# Run an ACP (Web3.0) node in a container. Build:  docker build -t acp-node .
# Run:  docker run -p 8787:8787 --env-file .env acp-node
FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY . .
RUN pnpm install
ENV ACP_HOST=0.0.0.0
EXPOSE 8787
CMD ["pnpm", "--filter", "@acp/node", "start"]
