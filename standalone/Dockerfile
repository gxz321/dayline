FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@10.20.0 --ignore-scripts --no-audit --no-fund && pnpm install --frozen-lockfile --ignore-scripts
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
COPY worker ./worker
COPY scripts/build-worker.mjs ./scripts/build-worker.mjs
COPY .openai/hosting.json ./.openai/hosting.json
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/dayline
WORKDIR /app
RUN apk add --no-cache flock
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY standalone/server.mjs standalone/auth.mjs standalone/bucket.mjs standalone/entrypoint.sh ./standalone/
RUN mkdir -p /var/lib/dayline && chown node:node /var/lib/dayline
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health',{headers:{host:new URL(process.env.PUBLIC_ORIGIN).host}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh","/app/standalone/entrypoint.sh"]

