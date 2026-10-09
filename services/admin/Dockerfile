FROM node:22-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY packages/platform/package.json packages/platform/
COPY services/auth/package.json services/auth/
COPY services/admin/package.json services/admin/
COPY services/public/package.json services/public/
RUN npm ci --include=dev --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/platform packages/platform
COPY services/admin services/admin
RUN npm run build -w @ecom/platform \
 && npm run build -w @ecom/admin-service

FROM base AS prod-deps
COPY package.json package-lock.json .npmrc ./
COPY packages/platform/package.json packages/platform/
COPY services/auth/package.json services/auth/
COPY services/admin/package.json services/admin/
COPY services/public/package.json services/public/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM base AS runtime
ENV APP_MAIN=/app/services/admin/dist/main.js \
    KNEXFILE=/app/services/admin/knexfile.js \
    NODE_OPTIONS=--enable-source-maps

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=build /app/packages/platform/dist packages/platform/dist
COPY --from=build /app/packages/platform/package.json packages/platform/package.json
COPY --from=build /app/services/admin/dist services/admin/dist
COPY --from=build /app/services/admin/migrations services/admin/migrations
COPY --from=build /app/services/admin/knexfile.js services/admin/knexfile.js
COPY --from=build /app/services/admin/package.json services/admin/package.json
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage \
 && chown -R node:node /app/storage

USER node
EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
