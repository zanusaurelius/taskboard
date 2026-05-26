FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN AUTH_SECRET="build-time-placeholder-not-used-at-runtime-xxxxx" \
    DATABASE_URL="file:/tmp/build-placeholder.db" \
    npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY --from=builder /app/public ./public
RUN mkdir -p /app/data/uploads /app/db
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
# Native SQLite encryption module — prebuilt for linux/amd64 musl (alpine)
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /app/node_modules/better-sqlite3-multiple-ciphers ./node_modules/better-sqlite3-multiple-ciphers
COPY --from=deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
# Patch better-sqlite3/lib/index.js on disk so both CJS require() and ESM import
# return a Database subclass that auto-applies globalThis.__dbKey on every open.
# Must be a file-level patch: patch-sqlite.js only patches require.cache (CJS),
# but the Prisma adapter loads via ESM which has a separate module registry.
RUN node -e " \
  const fs=require('fs'); \
  const p='./node_modules/better-sqlite3/lib/index.js'; \
  const orig=fs.readFileSync(p,'utf8'); \
  const wrap=[ \
    '', \
    '// Auto-apply SQLCipher key — patched at Docker build time', \
    'const _OrigDb=module.exports;', \
    'class _EncDb extends _OrigDb{', \
    '  constructor(f,o){', \
    '    super(f,o);', \
    '    const k=globalThis.__dbKey;', \
    '    if(k&&f!==\":memory:\"){try{this.key(Buffer.from(k,\"hex\"));}catch(e){throw e;}}', \
    '  }', \
    '}', \
    'Object.assign(_EncDb,_OrigDb);', \
    'module.exports=_EncDb;', \
    'module.exports.SqliteError=_OrigDb.SqliteError;', \
  ].join('\n'); \
  fs.writeFileSync(p,orig+wrap); \
  console.log('patched better-sqlite3/lib/index.js'); \
"
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["/entrypoint.sh"]
