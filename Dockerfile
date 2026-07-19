# Run a Web3.0 node in a container. Build:  docker build -t web3-node .
# Run:  docker run -p 8787:8787 --env-file .env web3-node
FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm
COPY . .
RUN pnpm install
ENV WEB3_HOST=0.0.0.0
EXPOSE 8787
CMD ["pnpm", "--filter", "@web3/node", "start"]
