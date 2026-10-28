FROM node:20-slim

# Prisma's query engine needs OpenSSL; the slim image does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so this layer is cached across code edits.
COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY test ./test
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/main"]
