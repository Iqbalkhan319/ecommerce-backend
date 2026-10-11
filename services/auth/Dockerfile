# =====================================================================
# auth-service Dockerfile
#
# রান্নাঘরে রান্না হয়, কিন্তু ক্রেতার টেবিলে শুধু তৈরি খাবার যায়।
#   stage ১-৪ = রান্নাঘর (অনেক জিনিস লাগে, শেষে ফেলে দেওয়া হয়)
#   stage ৫ (runtime) = টেবিল (শুধু এটাই আসল image হয়)
# =====================================================================


# ---------------------------------------------------------------------
# STAGE ১: base – সবার ভিত্তি
# ---------------------------------------------------------------------

# শুরু করো Node 22 দেওয়া ছোট alpine Linux থেকে। এই ধাপের নাম দিলাম "base"
FROM node:22-alpine AS base

# dumb-init নামের ছোট সাহায্যকারী বসাও (--no-cache মানে ডাউনলোডের জঞ্জাল রাখবে না)
RUN apk add --no-cache dumb-init

# এখন থেকে সব কাজ /app ফোল্ডারে হবে (না থাকলে বানিয়ে নেবে)
WORKDIR /app

# app কে বলে দাও এটা আসল ব্যবহারের ধরনে (production) চলছে
ENV NODE_ENV=production


# ---------------------------------------------------------------------
# STAGE ২: deps – সব package নামানো (dev সহ, compile করার জন্য)
# ---------------------------------------------------------------------

# base থেকে শুরু করে নতুন ধাপ, নাম "deps"
FROM base AS deps

# প্রথমে শুধু package এর তালিকা ফাইল কপি করো (কোড না)। কারণ: কোড বদলালেও তালিকা না বদলালে Docker আগের ডাউনলোড আবার ব্যবহার করে, build দ্রুত হয়
COPY package.json package-lock.json .npmrc ./

# platform নামের ভাগ করা প্যাকেজের তালিকা কপি
COPY packages/platform/package.json packages/platform/

# auth service এর তালিকা কপি
COPY services/auth/package.json services/auth/

# admin service এর তালিকা কপি (npm workspace এর জন্য তিনটাই লাগে)
COPY services/admin/package.json services/admin/

# public service এর তালিকা কপি
COPY services/public/package.json services/public/

# lock ফাইলে লেখা হুবহু সংস্করণ দিয়ে সব package নামাও। --include=dev মানে compile এর tool সহ। --ignore-scripts মানে package গুলোর নিজস্ব install script চালিও না (নিরাপদ)
RUN npm ci --include=dev --ignore-scripts


# ---------------------------------------------------------------------
# STAGE ৩: build – কোড compile করে চলার উপযোগী বানানো
# ---------------------------------------------------------------------

# deps এর সব কিছু নিয়ে শুরু, নাম "build"
FROM deps AS build

# TypeScript এর সাধারণ সেটিং ফাইল কপি
COPY tsconfig.base.json ./

# এবার platform এর আসল কোড কপি
COPY packages/platform packages/platform

# auth service এর আসল কোড কপি
COPY services/auth services/auth

# আগে platform, তারপর auth-service compile করো (-w মানে ঐ workspace এর build)। ফলাফল যায় dist ফোল্ডারে। && মানে প্রথমটা সফল হলে তবেই দ্বিতীয়টা
RUN npm run build -w @ecom/platform \
 && npm run build -w @ecom/auth-service


# ---------------------------------------------------------------------
# STAGE ৪: prod-deps – শুধু চলার package (dev tool ছাড়া)
# ---------------------------------------------------------------------

# base থেকে নতুন করে শুরু (deps থেকে না), নাম "prod-deps"
FROM base AS prod-deps

# package তালিকা ফাইল কপি
COPY package.json package-lock.json .npmrc ./

# platform এর তালিকা কপি
COPY packages/platform/package.json packages/platform/

# auth এর তালিকা কপি
COPY services/auth/package.json services/auth/

# admin এর তালিকা কপি
COPY services/admin/package.json services/admin/

# public এর তালিকা কপি
COPY services/public/package.json services/public/

# শুধু আসল চলার package নামাও (--omit=dev মানে dev tool বাদ)। তারপর npm এর cache মুছে দাও যাতে image ছোট থাকে
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# ---------------------------------------------------------------------
# STAGE ৫: runtime – চূড়ান্ত image (টেবিলের তৈরি খাবার)
# ---------------------------------------------------------------------

# আবার base থেকে পরিষ্কার শুরু। আগের stage এর বাকি কিছু আসবে না, শুধু নিচের COPY --from যা আনবে। নাম "runtime"
FROM base AS runtime

# তিনটা environment variable: app এর মূল ফাইল কোথায়, knex (ডাটাবেস migration tool) এর সেটিং ফাইল কোথায়, আর error এ আসল কোডের লাইন নম্বর দেখানোর অনুমতি
ENV APP_MAIN=/app/services/auth/dist/main.js \
    KNEXFILE=/app/services/auth/knexfile.js \
    NODE_OPTIONS=--enable-source-maps

# prod-deps stage থেকে শুধু চলার package এর ফোল্ডার আনো (এটাই ১১৪ MB এর অংশ)
COPY --from=prod-deps /app/node_modules ./node_modules

# prod-deps stage থেকে package.json আনো
COPY --from=prod-deps /app/package.json ./package.json

# build stage থেকে platform এর compile হওয়া কোড আনো
COPY --from=build /app/packages/platform/dist packages/platform/dist

# platform এর package.json আনো
COPY --from=build /app/packages/platform/package.json packages/platform/package.json

# auth এর compile হওয়া কোড আনো (এটাই আপনার আসল app)
COPY --from=build /app/services/auth/dist services/auth/dist

# ডাটাবেস migration ফাইল আনো (table বানানোর নির্দেশ)
COPY --from=build /app/services/auth/migrations services/auth/migrations

# knex এর সেটিং ফাইল আনো
COPY --from=build /app/services/auth/knexfile.js services/auth/knexfile.js

# auth এর package.json আনো
COPY --from=build /app/services/auth/package.json services/auth/package.json

# চালু করার স্ক্রিপ্ট নিজের কম্পিউটার (repo) থেকে আনো
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# স্ক্রিপ্টকে চালানোর অনুমতি দাও। /app/storage ফোল্ডার বানাও। ফোল্ডারের মালিক করো "node" user কে (কারণ নিচে app root হিসেবে চলবে না)
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage \
 && chown -R node:node /app/storage

# এখন থেকে সব কিছু সাধারণ "node" user হিসেবে চলবে, root হিসেবে না (নিরাপদ)
USER node

# জানিয়ে রাখা: app 3001 নম্বর দরজায় শোনে (এটা শুধু তথ্য, নিজে দরজা খোলে না)
EXPOSE 3001

# Docker নিয়মিত জিজ্ঞাসা করবে "app ঠিক আছে?"। প্রতি ১৫ সেকেন্ডে একবার, ৫ সেকেন্ডে উত্তর না এলে ব্যর্থ, শুরুর ৪০ সেকেন্ড ব্যর্থতা গোনা হবে না, পরপর ৫ বার ব্যর্থ হলে "unhealthy"
# প্রশ্নটা হলো: node দিয়ে /health/ready ঠিকানায় একটা request পাঠাও। উত্তর ঠিক এলে 0 (সুস্থ), না এলে 1 (অসুস্থ)
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# container চালু হলে প্রথমে এটা চলবে: dumb-init (বন্ধ করার সংকেত ঠিকভাবে পৌঁছে দেয়) এর মাধ্যমে entrypoint.sh। সেই স্ক্রিপ্ট সম্ভবত migration চালিয়ে app চালু করে
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]






# FROM node:22-alpine AS base
# RUN apk add --no-cache dumb-init
# WORKDIR /app
# ENV NODE_ENV=production

# FROM base AS deps
# COPY package.json package-lock.json .npmrc ./
# COPY packages/platform/package.json packages/platform/
# COPY services/auth/package.json services/auth/
# COPY services/admin/package.json services/admin/
# COPY services/public/package.json services/public/
# RUN npm ci --include=dev --ignore-scripts

# FROM deps AS build
# COPY tsconfig.base.json ./
# COPY packages/platform packages/platform
# COPY services/auth services/auth
# RUN npm run build -w @ecom/platform \
#  && npm run build -w @ecom/auth-service

# FROM base AS prod-deps
# COPY package.json package-lock.json .npmrc ./
# COPY packages/platform/package.json packages/platform/
# COPY services/auth/package.json services/auth/
# COPY services/admin/package.json services/admin/
# COPY services/public/package.json services/public/
# RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# FROM base AS runtime
# ENV APP_MAIN=/app/services/auth/dist/main.js \
#     KNEXFILE=/app/services/auth/knexfile.js \
#     NODE_OPTIONS=--enable-source-maps

# COPY --from=prod-deps /app/node_modules ./node_modules
# COPY --from=prod-deps /app/package.json ./package.json
# COPY --from=build /app/packages/platform/dist packages/platform/dist
# COPY --from=build /app/packages/platform/package.json packages/platform/package.json
# COPY --from=build /app/services/auth/dist services/auth/dist
# COPY --from=build /app/services/auth/migrations services/auth/migrations
# COPY --from=build /app/services/auth/knexfile.js services/auth/knexfile.js
# COPY --from=build /app/services/auth/package.json services/auth/package.json
# COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# RUN chmod +x /usr/local/bin/entrypoint.sh \
#  && mkdir -p /app/storage \
#  && chown -R node:node /app/storage

# USER node
# EXPOSE 3001

# HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
#   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
