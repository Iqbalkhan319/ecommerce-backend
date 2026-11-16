# ===== STAGE 1: base (সবার ভিত্তি, বাকি stage গুলো এখান থেকে শুরু হবে) =====

# Node 22 এর ছোট্ট Alpine Linux image নাও, আর এই stage-এর নাম দাও "base"
FROM node:22-alpine AS base

# dumb-init নামের ছোট প্রোগ্রাম install করো (--no-cache মানে বাড়তি ফাইল রাখবে না, image ছোট থাকবে) dumb-init একটা ছোট প্রোগ্রাম, যার কাজ container-এর ভেতরে "প্রথম প্রসেস" (PID 1) হিসেবে বসে থাকা।  সমস্যা কী ছিল? 
# Container-এর প্রথম প্রসেসের (PID 1) দুটো বিশেষ দায়িত্ব থাকে। এক, বন্ধ করার signal (যেমন docker stop) ঠিকমতো গ্রহণ করা। দুই, মরে যাওয়া child প্রসেসগুলোকে পরিষ্কার করা। Node.js নিজে এই কাজ ভালো পারে না। ফলে docker stop
# দিলে app অনেক সময় বন্ধ হতে চায় না, ১০ সেকেন্ড অপেক্ষা করে জোর করে মারতে হয়।  dumb-init কী করে? সে নিজে PID 1 হয়ে বসে, তারপর আপনার app চালায়। বন্ধ করার signal এলে সে সেটা app-কে ঠিকভাবে পৌঁছে দেয়। আর মরা child প্রসেস জমতে দেয় না।
# dumb-init এর কোনো full form নেই। এটা কোনো সংক্ষেপ (abbreviation) না, এটা একটা নাম।  নামটা ভাগ করলে:  dumb = বোকা বা সাধারণ init = initialization বা “init প্রসেস” (Linux-এ প্রথম যে প্রসেস চালু হয়, তাকে init বলে)  
# মানে: "একটা খুব সহজ, বোকা-সাদাসিধে init।"  "বোকা" কেন? কারণ এর কাজ খুব অল্প। সে শুধু দুটো কাজ করে: বন্ধ করার বার্তা app-কে পৌঁছে দেয়, আর মরা child প্রসেস পরিষ্কার করে। আর কিছু করে না। বড় init প্রোগ্রামগুলো (যেমন systemd) অনেক কাজ করে, কিন্তু container-এ অত কিছু লাগে না।
RUN apk add --no-cache dumb-init

# container-এর ভেতরে কাজের ফোল্ডার হলো /app (না থাকলে নিজেই বানিয়ে নেবে)
WORKDIR /app

# NODE_ENV একটা environment variable (পরিবেশের নাম-লেখা চিরকুট)। এতে লেখা থাকে app এখন কোন "মোডে" চলছে। সাধারণ মোড দুটো: development (কাজ শেখা/টেস্ট করার সময়) আর production (আসল ব্যবহারকারীদের জন্য)।  
# এটা কেন লাগে? অনেক package আর framework এই চিরকুট পড়ে নিজের আচরণ বদলায়। production দেখলে তারা:  বেশি দ্রুত চলে (বাড়তি check আর debug কাজ বন্ধ রাখে) error-এর ভেতরের গোপন তথ্য ব্যবহারকারীকে দেখায় না কম 
#memory নেয়  সহজ উদাহরণ: ভাবুন রেস্টুরেন্ট। development হলো রান্নাঘরে ট্রায়াল, সেখানে সবাই ঘুরে দেখে, ভুল হলে জোরে বলে। production হলো আসল গ্রাহকের সামনে পরিবেশন, সব পরিপাটি, ভেতরের ঝামেলা কেউ দেখে না।  আপনার 
# Dockerfile-এ একটা মজার ব্যাপার: এই লাইনটা base stage-এ আছে, আর বাকি সব stage base থেকে শুরু হয়। তাই সবাই production মোড পায়। এজন্যই deps stage-এ লেখা আছে npm ci --include=dev। কারণ NODE_ENV=production 
# থাকলে npm সাধারণত dev package বাদ দেয়, কিন্তু build করতে dev package লাগে। তাই --include=dev দিয়ে জোর করে নেওয়া হয়েছে।
ENV NODE_ENV=production





# ===== STAGE 2: deps (সব package install, dev সহ) =====

# এই লাইনটা base stage-এর উপর ভিত্তি করে নতুন একটা stage শুরু করে, যার নাম deps। 
FROM base AS deps

# package.json = বাজারের তালিকা "ডাল লাগবে, তেল লাগবে।"  package-lock.json = ঠিক কোনটা কিনবেন সেটা লেখা তালিকা "এই ব্র্যান্ডের ১ কেজি ডাল।" তাই যখনই কিনুন, একই জিনিস আসে।  .npmrc = কোন দোকান থেকে কিনবেন দোকানের 
# ঠিকানা, আর দরকার হলে ঢোকার কার্ড। Docker-এর একটা স্মৃতি আছে। সে প্রতিটা লাইনের কাজ একবার করলে ফলাফল মনে রাখে।  উদাহরণ: ধরুন আপনি রোজ বাজারে যান।  তালিকা আগের মতোই আছে? তাহলে Docker বলে, "এটা আমি আগেই কিনে
# রেখেছি, আবার যাব না।" সময় বাঁচে। তালিকা বদলেছে? তখন সে আবার বাজারে যায়।  এখন দেখুন, Dockerfile-এ আগে তালিকা (এই তিনটা ফাইল) কপি করা হয়েছে, তারপর বাজার (npm ci)।  আপনি শুধু কোড বদলালেন, কিন্তু তালিকা বদলালেন না। 
# তখন Docker বলে, "তালিকা তো একই, বাজার আর করব না।" ফলে build দ্রুত হয়।  যদি আগেই পুরো কোড কপি করতেন, তাহলে কোডের একটা ছোট লাইন বদলালেও Docker ভাবত "কিছু একটা বদলেছে" আর প্রতিবার আবার বাজারে যেত। অনেক 
# সময় লাগত।  মূল কথা: যা কম বদলায় (তালিকা) তা আগে রাখো, যা বেশি বদলায় (কোড) তা পরে রাখো।
# .npmrc = npm + rc  rc মানে সাধারণত “run commands” (চালানোর কমান্ড)। এটা পুরনো Unix থেকে আসা একটা নিয়ম: কোনো প্রোগ্রাম চালু হওয়ার সময় যে সেটিং ফাইল পড়ে, তার নামের শেষে rc বসানো হয়।  আরও উদাহরণ:  .bashrc = bash-এর সেটিং .npmrc = npm-এর সেটিং .vimrc = vim-এর সেটিং  শুরুর . (ডট) কেন? Linux-এ নামের আগে . থাকলে ফাইলটা লুকানো ফাইল হয়। সাধারণ তালিকায় (ls) দেখা যায় না। সেটিং ফাইল সবসময় চোখের সামনে থাকার দরকার নেই, তাই লুকানো রাখা হয়।
COPY package.json package-lock.json .npmrc ./

# এই লাইনটা platform নামের ছোট অংশের তালিকা-ফাইল (package.json) কপি করে।  সহজ কথা: আপনার project একটা বড় বাড়ির মতো, আর তার ভেতরে কয়েকটা আলাদা ঘর আছে:  platform (সবার কাজে লাগে, 
# যেমন সবার ব্যবহারের রান্নাঘর) auth, admin, public (আলাদা আলাদা ঘর)  প্রতিটা ঘরের নিজস্ব package.json আছে। এই লাইন platform ঘরের তালিকাটা নিয়ে /app/packages/platform/ ফোল্ডারে রাখে।  
# আমি বললাম ফাইল /app/packages/platform/-এ যায়, অথচ Dockerfile-এ লেখা packages/platform/, শুরুতে /app/ নেই। কেন?

# উত্তর: কারণ Docker নিজেই /app/ যোগ করে নেয়।

# মনে আছে base stage-এ এই লাইন ছিল?
# WORKDIR /app

# এর মানে: "এখন থেকে আমি /app ফোল্ডারে দাঁড়িয়ে আছি।"

# এরপর Dockerfile-এ যেখানে / দিয়ে শুরু না হওয়া কোনো পথ (relative path) লেখা হয়, Docker সেটাকে /app-এর ভেতরে ধরে নেয়।

# তাহলে:
# COPY packages/platform/package.json packages/platform/

# শেষের অংশ packages/platform/ লেখা হলো। Docker বুঝে নিল:
# /app/ + packages/platform/ = /app/packages/platform/

# দুই ধরনের পথ:

# / দিয়ে শুরু (যেমন /usr/local/bin/entrypoint.sh) = পুরো পথ। সরাসরি সেই জায়গায় যাও।
# / ছাড়া শুরু (যেমন packages/platform/) = আপেক্ষিক পথ। এখন যেখানে আছো (/app), সেখান থেকে হিসাব করো।

# কেন শুধু এই ফাইল, 
# পুরো কোড না? আগের মতোই কারণ। Docker শুধু তালিকা দেখে npm ci চালাবে। কোড পরে আসবে। তাই কোড বদলালে বাজার আবার করতে হবে না।  কেন সব ঘরের তালিকা লাগছে? কারণ npm ci জানতে চায় পুরো বাড়িতে কোন কোন ঘর 
# আছে (এটাকে workspace বলে)। একটা ঘরের তালিকা না থাকলে সে গোলমাল করে।  শেষের packages/platform/ কী? এটা গন্তব্য। শেষে / আছে, তাই Docker বোঝে এটা একটা ফোল্ডার, ফাইলের নাম না। ফাইলটা ওই ফোল্ডারের ভেতরে গিয়ে বসে।
COPY packages/platform/package.json packages/platform/

# এই লাইনটা auth ঘরের তালিকা-ফাইল (package.json) কপি করে।  আগের লাইনের মতোই কাজ, শুধু ঘর আলাদা।  platform = সবার কাজে লাগার ঘর auth = লগইন আর পরিচয় যাচাইয়ের ঘর (কে ঢুকছে, তার অনুমতি আছে কিনা)  এই লাইন  
# services/auth/package.json ফাইলটা নিয়ে container-এর /app/services/auth/ ফোল্ডারে রাখে।  কেন এখানে auth লাগছে, অথচ আমরা শুধু admin build করছি? কারণ npm ci পুরো বাড়ির সব ঘরের তালিকা একসাথে দেখতে চায়। একটা ঘরের 
# তালিকা না থাকলে সে বলবে, "এই ঘর কোথায়?" আর গোলমাল করবে। তাই auth-এর কোড লাগে না, কিন্তু তার তালিকা লাগে।  শেষের / আগের মতোই: এটা বলে দেয় গন্তব্য একটা ফোল্ডার।
COPY services/auth/package.json services/auth/

# এই লাইনটা admin ঘরের তালিকা-ফাইল (package.json) কপি করে।  আগের দুই লাইনের মতোই কাজ, শুধু ঘর আলাদা।  platform = সবার কাজে লাগার ঘর auth = লগইন যাচাইয়ের ঘর admin = পরিচালনার ঘর (অ্যাডমিন যেখান থেকে সব সামলায়)  
# এই লাইন services/admin/package.json ফাইলটা নিয়ে container-এর /app/services/admin/ ফোল্ডারে রাখে।  এই ঘরটা বিশেষ কেন? কারণ আপনার Dockerfile শেষে এই admin ঘরটাই build করে চালায়। auth আর public শুধু তালিকা হিসেবে লাগে, 
# কিন্তু admin আসল কাজের ঘর।  মনে রাখার কথা: এখানেও শুধু তালিকা কপি হচ্ছে, কোড না। কোড আসবে পরের build stage-এ।
COPY services/admin/package.json services/admin/

# এই লাইনটা public ঘরের তালিকা-ফাইল (package.json) কপি করে।  আগের লাইনগুলোর মতোই কাজ, শুধু ঘর আলাদা।  platform = সবার কাজে লাগার ঘর auth = লগইন যাচাইয়ের ঘর admin = পরিচালনার ঘর public = সাধারণ ব্যবহারকারীর ঘর 
# (যেখানে বাইরের মানুষ দেখে বা কেনাকাটা করে)  এই লাইন services/public/package.json ফাইলটা নিয়ে container-এর /app/services/public/ ফোল্ডারে রাখে।  এটাই শেষ ঘর। এখন চারটা ঘরের তালিকা Docker-এর কাছে আছে। তাই পরের 
# লাইনে npm ci পুরো বাড়ির বাজার একসাথে করতে পারবে।  মনে রাখার কথা: এখানেও auth-এর মতো, public-এর কোড লাগছে না, শুধু তালিকা লাগছে। কারণ npm ci সব ঘরের নাম জানতে চায়।
COPY services/public/package.json services/public/

# npm = Node Package Manager Node.js-এর package (অন্যের বানানো কোড) আনা আর সামলানোর দোকানদার।  ci = Clean Install মানে "পরিষ্কার install"।  "পরিষ্কার" কেন? npm ci শুরুতেই পুরনো node_modules ফোল্ডার মুছে ফেলে। 
# তারপর package-lock.json দেখে হুবহু সেই version-গুলো নতুন করে আনে। কোনো আন্দাজ নেই, কোনো পরিবর্তন নেই।  সহজ উদাহরণ:  npm install = ঘরে আগের জিনিস থাকলে রেখে দেয়, দরকার মতো কিছু যোগ করে। 
# তাই ফলাফল প্রতিবার একটু আলাদা হতে পারে। npm ci = ঘর খালি করে, তালিকা দেখে ঠিক সেই জিনিসগুলোই আবার সাজায়।  তাই Docker আর production-এ npm ci ব্যবহার করা ভালো, কারণ প্রতিবার একই ফলাফল পাওয়া যায়। 
# ১. --include=dev মানে “dev package-ও নাও।”  আগে বলেছিলাম NODE_ENV=production থাকলে npm সাধারণত dev package বাদ দেয়। কিন্তু build করতে dev package লাগে (যেমন TypeScript, যা কোডকে compile করে)। তাই জোর করে 
# বলা হলো, "এবার dev জিনিসগুলোও আনো।"  উদাহরণ: বাজারের তালিকায় "রান্নার জিনিস" আর "রান্নার যন্ত্র" দুটোই আছে। production মোড শুধু রান্নার জিনিস আনে। কিন্তু রান্না করতে যন্ত্রও লাগে, তাই --include=dev বলে "যন্ত্রগুলোও আনো।"   
# ২. --ignore-scripts মানে “install-এর সময় বাড়তি script চালিও না।”  কিছু package install হওয়ার সময় নিজে থেকে কিছু কমান্ড চালায়। এগুলোতে ঝুঁকি থাকতে পারে, কারণ অন্যের লেখা কোড আপনার server-এ চলে যায়।  উদাহরণ: 
# দোকান থেকে জিনিস কেনার সময় দোকানদার বলল, "আমি আপনার ঘরে ঢুকে নিজে সাজিয়ে দেব।" আপনি বললেন, "না, শুধু জিনিস দাও, সাজানো আমি করব।"  মূল কথা: প্রথমটা build-এর জন্য দরকারি জিনিস আনে, দ্বিতীয়টা নিরাপত্তা বাড়ায়।
RUN npm ci --include=dev --ignore-scripts



# ===== STAGE 3: build (code কে compile করা) =====

# deps = dependencies, এই লাইনটা deps stage-এর উপর ভিত্তি করে নতুন একটা stage শুরু করে, যার নাম build।  ভাগ করে বুঝি:  FROM deps = “deps stage যেখানে শেষ হয়েছে, সেখান থেকে শুরু করো।” AS build = "এই নতুন stage-এর 
# নাম দাও build।"  এর মানে কী? deps stage-এ আমরা npm ci করে সব package (dev সহ) এনে রেখেছি। build stage সেই সব নিয়েই শুরু হয়। আবার বাজার করতে হয় না।  সহজ উদাহরণ: ভাবুন রান্নাঘর।  deps stage = বাজার থেকে সব জিনিস
# আর যন্ত্র এনে রান্নাঘরে রাখা হলো। build stage = সেই রান্নাঘরেই এবার রান্না শুরু।  নতুন রান্নাঘর বানাতে হয় না, আগের ঘরেই কাজ চলে।  আগের FROM base AS deps থেকে পার্থক্য:  FROM base = একদম খালি ঘর থেকে শুরু। FROM deps = জিনিসপত্র 
# সাজানো ঘর থেকে শুরু।  মনে রাখার কথা: এই build stage-এর কাজ শুধু কোড compile করা। এটা চূড়ান্ত image না। এখান থেকে শুধু compile হওয়া কোড পরে runtime stage-এ নেওয়া হবে।
FROM deps AS build

# tsconfig.base.json হলো নিয়মের খাতা।  আপনার কোড TypeScript ভাষায় লেখা। কিন্তু Node সেটা সরাসরি বোঝে না। তাই আগে সাধারণ JavaScript-এ বদলাতে হয়।  বদলানোর সময় কীভাবে বদলাবে, সেই নিয়ম এই খাতায় লেখা আছে।  উদাহরণ: 
# আপনি বাংলা থেকে ইংরেজিতে অনুবাদ করবেন। অনুবাদের আগে আপনার হাতে একটা নিয়মের খাতা লাগে, যেমন "কোন ধরনের ইংরেজি লিখব"।  এই লাইন সেই খাতাটা কপি করে আনে, কারণ পরের লাইনগুলোতে অনুবাদ (build) হবে।  
#মূল কথা: নিয়মের খাতা আগে আনো, তারপর অনুবাদ শুরু করো।
# ./ মানে "এখন যে ফোল্ডারে আছি, সেই ফোল্ডার"।
# ভাগ করে দেখুন:
# . (একটা ডট) = "এই ফোল্ডার"
# / = ফোল্ডারের চিহ্ন
# আমরা WORKDIR /app দিয়েছি, তাই "এই ফোল্ডার" মানে /app।
COPY tsconfig.base.json ./

# এই লাইনটা platform ঘরের পুরো কোড কপি করে।  আগের লাইনের সাথে পার্থক্য:  আগে: COPY packages/platform/package.json ... = শুধু তালিকা-ফাইল। এবার: COPY packages/platform ... = পুরো ঘর, মানে সব কোড ফাইল।  কেন এখন 
# পুরো কোড? কারণ এখন আমরা build stage-এ আছি, আর এখানে কোড compile (অনুবাদ) করতে হবে। কোড না থাকলে অনুবাদ করবে কী?  কেন আগে না? আগে শুধু তালিকা কপি করেছিলাম, যাতে npm ci আর বারবার চালাতে না হয়। কোড অনেক
#  বদলায়, তাই কোড সবার শেষে আনা হয়।  শেষের packages/platform: এটা গন্তব্য। container-এর /app/packages/platform ফোল্ডারে পুরো কোড গিয়ে বসে।  উদাহরণ: আগে বাজারের তালিকা দিয়ে জিনিস আনা হয়েছে। এবার রান্নার আসল রেসিপি আনা হচ্ছে। 

# আগের লাইনে শেষে / ছিল, এই লাইনে নেই। দুটোর কারণ আলাদা, কারণ কী কপি হচ্ছে সেটা আলাদা।
# আগে মনে করুন:
# COPY packages/platform/package.json packages/platform/
# এখানে কপি হচ্ছে একটা ফাইল (package.json)। গন্তব্যে / দেওয়া মানে "এটা একটা ফোল্ডার, ফাইলটা এর ভেতরে রাখো।" / না দিলে Docker ভাবতে পারত packages/platform একটা ফাইলের নাম, আর package.json-কে সেই নামে রাখত।

# এই লাইনে:
# COPY packages/platform packages/platform
# এখানে কপি হচ্ছে একটা পুরো ফোল্ডার (packages/platform)। ফোল্ডার কপির নিয়ম আলাদা: Docker ফোল্ডারের ভেতরের সব কিছু গন্তব্যে ঢেলে দেয়। গন্তব্য না থাকলে নিজেই বানিয়ে নেয়। তাই / না দিলেও সমস্যা নেই, Docker নিজে বুঝে নেয়।

# সহজ নিয়ম:

# ফাইল কপি করে ফোল্ডারে রাখতে চাইলে → শেষে / দাও (পরিষ্কার বোঝানোর জন্য)।
# ফোল্ডার কপি করলে → / লাগে না, দিলেও একই ফল।
COPY packages/platform packages/platform

# এই লাইনটা admin ঘরের সব কোড নিয়ে আসে।  আগের লাইনে platform-এর কোড এনেছিলাম। এবার admin-এর কোড।  কেন এখন? কারণ পরের লাইনে admin build (অনুবাদ) হবে। কোড না থাকলে অনুবাদ করবে কী?  একটা মজার কথা: 
# auth আর public-এর কোড আনা হচ্ছে না। কারণ আমরা শুধু admin বানাচ্ছি। তাই তাদের শুধু তালিকা ছিল, কোড লাগে না।  উদাহরণ: platform-এর রেসিপি আনা হয়েছে। এবার admin-এর রেসিপিও আনা হলো। এখন রান্না শুরু করা যাবে।
COPY services/admin services/admin

# এই দুই লাইন কোড অনুবাদ (build) করে। প্রথমে platform, তারপর admin।  ভাগ করে বুঝি:  npm run build = “package.json-এ লেখা build কমান্ডটা চালাও।” -w @ecom/platform = -w মানে workspace (ঘর)। বলা হলো, "শুধু platform 
# ঘরের জন্য চালাও।" && = "আগেরটা সফল হলে তবেই পরেরটা করো।" \ = "কমান্ড এখনো শেষ হয়নি, পরের লাইনেও চলছে।"  কেন আগে platform, তারপর admin? কারণ admin ঘর platform ঘরের কোড ব্যবহার করে। platform আগে অনুবাদ না হলে 
# admin অনুবাদ করতে গিয়ে আটকে যাবে।  উদাহরণ: রান্নাঘরে আগে মশলা বাটতে হবে (platform), তারপর সেই মশলা দিয়ে তরকারি রাঁধা হবে (admin)।
RUN npm run build -w @ecom/platform \
 && npm run build -w @ecom/admin-service




 # ===== STAGE 4: prod-deps (শুধু production package) =====

# আবার "base" থেকে নতুন করে শুরু (dev package যেন এখানে না ঢোকে), নাম "prod-deps"
FROM base AS prod-deps

# এই লাইনটা আগে একবার এসেছে (deps stage-এ)। এখন আবার এসেছে prod-deps stage-এ।  এই তিনটা ফাইল হলো:  package.json = বাজারের তালিকা package-lock.json = ঠিক কোন জিনিস কিনবেন সেই তালিকা .npmrc = কোন দোকান থেকে 
# কিনবেন  আবার কেন কপি? কারণ prod-deps একটা নতুন রান্নাঘর। এটা base থেকে শুরু হয়েছে, deps থেকে না। তাই আগের রান্নাঘরের কোনো জিনিস এখানে নেই। তালিকা আবার আনতে হবে।  নতুন রান্নাঘর কেন? কারণ এই রান্নাঘরে শুধু দরকারি জিনিস
#  আনা হবে, যন্ত্রপাতি (dev package) বাদ দিয়ে। আগের রান্নাঘরে যন্ত্রপাতি ছিল, তাই সেটা থেকে শুরু করলে যন্ত্র ঢুকে যেত।  মনে রাখার কথা: এই stage-এর কাজ হলো চূড়ান্ত image-এর জন্য হালকা node_modules বানানো।
COPY package.json package-lock.json .npmrc ./

# এই লাইনটা আগে একবার এসেছিল (deps stage-এ)। এখন আবার এসেছে prod-deps stage-এ।  এটা platform ঘরের তালিকা-ফাইল (package.json) কপি করে।  আবার কেন? কারণ prod-deps একটা নতুন রান্নাঘর, base থেকে শুরু। আগের রান্নাঘরের
# কিছুই এখানে নেই। তাই তালিকা আবার আনতে হচ্ছে।  কেন তালিকা, কোড না? এই stage-এর কাজ শুধু package আনা। কোড লাগে না।  উদাহরণ: নতুন রান্নাঘরে platform ঘরের বাজারের তালিকা রাখা হলো, যাতে পরের লাইনে npm ci বাজার করতে পারে।
COPY packages/platform/package.json packages/platform/

# এই লাইনটাও আগে একবার এসেছিল (deps stage-এ)। এখন আবার prod-deps stage-এ।  এটা auth ঘরের তালিকা-ফাইল (package.json) কপি করে।  আবার কেন? কারণ prod-deps নতুন রান্নাঘর। আগের রান্নাঘরের তালিকা এখানে নেই।  auth-এর 
# কোড লাগছে না কেন? এই stage-এর কাজ শুধু package আনা। npm ci সব ঘরের নাম জানতে চায়, তাই শুধু তালিকা রাখা হলো।  উদাহরণ: নতুন রান্নাঘরে auth ঘরের বাজারের তালিকাও রাখা হলো, যাতে পরের লাইনে বাজার ঠিকমতো হয়।
COPY services/auth/package.json services/auth/

# admin-এর package.json কপি
COPY services/admin/package.json services/admin/

# public-এর package.json কপি
COPY services/public/package.json services/public/

# এই লাইনটা prod-deps stage-এর আসল কাজ করে: শুধু দরকারি package আনে, আর বাড়তি জিনিস মুছে ফেলে।  ভাগ করে বুঝি:  npm ci = তালিকা দেখে হুবহু package আনো (আগে বলেছি)। --omit=dev = dev package বাদ দাও। 
# আগে --include=dev ছিল, এবার উল্টো। কারণ চূড়ান্ত image-এ যন্ত্রপাতি (যেমন TypeScript) লাগে না, শুধু app চালানোর জিনিস লাগে। --ignore-scripts = install-এর সময় বাড়তি script চালিও না (নিরাপত্তার জন্য, আগে বলেছি)। 
# && = আগেরটা সফল হলে তবেই পরেরটা। npm cache clean --force = npm-এর cache মুছে ফেলো। --force মানে "জোর করে মোছো, জিজ্ঞেস কোরো না।"  cache কী? npm package আনার সময় একটা কপি নিজের কাছে জমিয়ে রাখে, 
# যাতে পরে আবার দ্রুত আনতে পারে। কিন্তু Docker image-এ আর বাজারে যাওয়ার দরকার নেই। তাই এই জমানো কপি শুধু জায়গা নেয়।  উদাহরণ: বাজার থেকে জিনিস এনে রান্নাঘরে রাখলেন। কিন্তু যন্ত্রপাতি আনলেন না (--omit=dev)। আর জিনিসের 
# প্যাকেট, ব্যাগ, রসিদ সব ফেলে দিলেন (cache clean), যাতে রান্নাঘর হালকা থাকে।

# node_modules হলো জিনিসপত্র রাখার আলমারি।  আপনি npm ci চালালে npm বাজার থেকে সব package (অন্যের বানানো কোড) এনে এই ফোল্ডারে রাখে। আপনার app চলার সময় দরকার হলে এখান থেকেই জিনিস নেয়।  উদাহরণ: বাজার থেকে চাল, 
# ডাল, তেল এনে আপনি রান্নাঘরের আলমারিতে গুছিয়ে রাখলেন। রান্নার সময় আলমারি থেকে নেন। node_modules সেই আলমারি।
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force





# ===== STAGE 5: runtime (চূড়ান্ত image, এটাই চলবে) =====

# এই লাইনটা base থেকে শুরু করে নতুন একটা stage বানায়, যার নাম runtime।  ভাগ করে বুঝি:  FROM base = একদম পরিষ্কার ঘর থেকে শুরু। AS runtime = এই stage-এর নাম runtime।  এটা বিশেষ কেন? এটাই চূড়ান্ত image। আপনার app এই stage 
# থেকেই চলবে। আগের deps, build, prod-deps ছিল রান্নাঘর, এটা হলো টেবিল, যেখানে শুধু তৈরি খাবার আসে।  base থেকে কেন, build থেকে না? build ঘরে যন্ত্রপাতি আর কোডের অনুবাদের ঝামেলা পড়ে আছে। সেখান থেকে শুরু করলে সব বাড়তি 
# জিনিস চূড়ান্ত image-এ ঢুকত, image ভারী হতো। পরিষ্কার ঘর থেকে শুরু করে শুধু দরকারি জিনিস আনলে image ছোট আর নিরাপদ থাকে।  পরের লাইনগুলোতে কী হবে? এই খালি ঘরে prod-deps থেকে আলমারি (node_modules) আর build থেকে অনুবাদ 
# হওয়া কোড (dist) এনে সাজানো হবে।  উদাহরণ: রান্নাঘরে রান্না শেষ। এবার পরিষ্কার টেবিলে শুধু তৈরি খাবার সাজানো হচ্ছে, হাঁড়ি-পাতিল না।
FROM base AS runtime

# এই লাইনটা তিনটা environment variable (চিরকুট) সেট করে।  ১. APP_MAIN=/app/services/admin/dist/main.js মানে “app-এর শুরুর ফাইল কোনটা।” অনুবাদ হওয়া কোডের ভেতরে main.js হলো সদর দরজা। entrypoint.sh এই চিরকুট পড়ে জানে 
# কোন ফাইল চালাতে হবে।  ২. KNEXFILE=/app/services/admin/knexfile.js মানে “database-এর সেটিং ফাইল কোথায়।” Knex হলো database-এর সাথে কথা বলার একটা টুল। migration (database-এর টেবিল বানানো বা বদলানো) চালানোর সময় সে এই 
# ফাইল খোঁজে।  ৩. NODE_OPTIONS=--enable-source-maps মানে “error হলে আসল লাইন নম্বর দেখাও।” কোড অনুবাদ হওয়ার পর লাইন নম্বর বদলে যায়। এই সেটিং থাকলে error-এ অনুবাদের আগের মূল TypeScript ফাইলের লাইন দেখায়। তাই ভুল খুঁজে 
# পাওয়া সহজ হয়।  \ কেন? কমান্ড পরের লাইনেও চলছে। তিনটা চিরকুট একসাথে এক ENV-এ সেট হচ্ছে।  উদাহরণ: টেবিলে তিনটা নোট রাখা হলো:  "রান্না শুরু করার জায়গা এটা" (APP_MAIN) "মশলার খাতা ওখানে আছে" (KNEXFILE) "ভুল হলে ঠিক কোথায় ভুল, সেটা বলে দিও" (NODE_OPTIONS)
ENV APP_MAIN=/app/services/admin/dist/main.js \
    KNEXFILE=/app/services/admin/knexfile.js \
    NODE_OPTIONS=--enable-source-maps

# এই লাইনটা prod-deps রান্নাঘর থেকে আলমারি (node_modules) এনে runtime টেবিলে রাখে।  ভাগ করে বুঝি:  COPY = কপি করো। --from=prod-deps = "বাইরে থেকে না, prod-deps stage থেকে নাও।" এটাই আগের stage থেকে জিনিস আনার উপায়। 
# /app/node_modules = prod-deps stage-এর ভেতরে আলমারি যেখানে আছে। ./node_modules = runtime stage-এর /app/ ফোল্ডারে একই নামে রাখো। (./ মানে এখনকার কাজের ফোল্ডার, এখানে /app)  কেন prod-deps থেকে, deps থেকে না? 
# কারণ prod-deps-এর আলমারিতে শুধু দরকারি জিনিস আছে। deps-এর আলমারিতে যন্ত্রপাতিও (dev package) আছে, যা চূড়ান্ত image-এ লাগে না।  উদাহরণ: রান্নাঘর থেকে হালকা আলমারিটা তুলে এনে পরিষ্কার টেবিলের পাশে বসানো হলো।
COPY --from=prod-deps /app/node_modules ./node_modules

# এই লাইনটা prod-deps রান্নাঘর থেকে মূল তালিকা-ফাইল (package.json) এনে runtime টেবিলে রাখে।  ভাগ করে বুঝি:  --from=prod-deps = prod-deps stage থেকে নাও। /app/package.json = ওই stage-এ ফাইলটা যেখানে আছে।
# ./package.json = runtime-এর /app/ ফোল্ডারে একই নামে রাখো।  কেন এটা লাগে? আলমারি (node_modules) আছে, কিন্তু app-কে জানতে হয় প্রজেক্টটা কী। অনেক সময় Node এই ফাইল পড়ে জানে কোন ধরনের কোড (যেমন import ব্যবহার করে
# কিনা) আর কীভাবে চালাতে হবে। তাই আলমারির পাশে তালিকাটাও রাখা হলো।  উদাহরণ: আলমারি টেবিলের পাশে বসানো হয়েছে। এবার তার গায়ে একটা তালিকা সাঁটা হলো, যাতে বোঝা যায় ভেতরে কী আছে আর কী কাজে লাগে।
COPY --from=prod-deps /app/package.json ./package.json

# এই লাইনটা build রান্নাঘর থেকে platform-এর অনুবাদ হওয়া কোড (dist) এনে runtime টেবিলে রাখে।  ভাগ করে বুঝি:  --from=build = build stage থেকে নাও। (আগের লাইনগুলোতে ছিল prod-deps, এবার build।) /app/packages/platform/dist = 
# build stage-এ অনুবাদ হওয়া কোড যেখানে জমা হয়েছিল। packages/platform/dist = runtime-এ একই জায়গায় রাখো।  dist কী? dist মানে distribution। npm run build চালালে TypeScript কোড অনুবাদ হয়ে JavaScript হয়, আর সেই 
# তৈরি কোড dist ফোল্ডারে জমা হয়। Node এই JavaScript-ই চালাতে পারে।  কেন build থেকে? কারণ অনুবাদ তো build ঘরেই হয়েছে। prod-deps ঘরে শুধু package ছিল, অনুবাদ করা কোড ছিল না।  কেন শুধু dist, পুরো কোড না? চূড়ান্ত 
# image-এ মূল TypeScript কোড লাগে না, শুধু তৈরি কোড লাগে। তাই image ছোট থাকে।  উদাহরণ: রান্না শেষ। রান্নাঘর থেকে শুধু তৈরি খাবারের থালাটা (dist) টেবিলে আনা হলো। কাঁচা মাল আর হাঁড়ি রান্নাঘরেই পড়ে রইল।

# COPY --from=prod-deps /app/node_modules ./node_modules
# COPY --from=build /app/packages/platform/dist packages/platform/dist
# build build section a tooo dist and node_modules directoy chilo na, tahole runtime section a ki vabe copy hocce?
# ভুল ধারণা: “build section-এ dist আর node_modules ছিল না।”
# আসলে: build stage-এ দুটোই ছিল। কিন্তু সরাসরি লেখা ছিল না, তৈরি হয়েছে।
# node_modules এসেছে কোথা থেকে?
# build stage শুরু হয়েছে এই লাইনে:
# FROM deps AS build
# মানে build হলো deps-এর সন্তান। আর deps stage-এ ছিল:
# RUN npm ci --include=dev --ignore-scripts
# এই কমান্ড /app/node_modules বানিয়েছে। সন্তান বাবার সব পায়, তাই build-এও node_modules আছে। (এটাতেই dev package আছে, তাই TypeScript চালানো যায়।)
# dist এসেছে কোথা থেকে?

# এই লাইন দিয়ে:
# RUN npm run build -w @ecom/platform && npm run build -w @ecom/admin-service
# npm run build চললে TypeScript কোড অনুবাদ হয়ে dist ফোল্ডার তৈরি হয়। তাই COPY লাইনে dist লেখা না থাকলেও এই RUN কমান্ড সেটা বানিয়ে ফেলে।
# মূল কথা: COPY ছাড়াও RUN দিয়ে ফাইল আর ফোল্ডার তৈরি হতে পারে।
# এখন runtime-এর লাইনগুলো:
# COPY --from=build /app/packages/platform/dist packages/platform/dist
# = “build stage-এ যে dist তৈরি হয়েছে, সেটা আনো।”

# একটা সূক্ষ্ম কথা:
# node_modules কিন্তু build থেকে আনা হয়নি। আনা হয়েছে prod-deps থেকে:
# COPY --from=prod-deps /app/node_modules ./node_modules

# কারণ build-এর node_modules-এ dev package আছে (ভারী)। prod-deps-এরটায় শুধু দরকারি জিনিস (হালকা)।
COPY --from=build /app/packages/platform/dist packages/platform/dist


# এই লাইনটা build রান্নাঘর থেকে platform-এর তালিকা-ফাইল (package.json) এনে runtime টেবিলে রাখে।  আগের লাইনের সাথে পার্থক্য:  আগের লাইন: platform-এর তৈরি খাবার (dist) আনা হয়েছিল। এই লাইন: platform-এর পরিচয়-কাগজ
# (package.json) আনা হচ্ছে।  কেন এটা লাগে? dist-এর কোড চলার সময় Node জানতে চায় platform ঘরটা কী, তার নাম কী, আর তার মূল ফাইল কোনটা। এই কাগজ ছাড়া admin যখন বলবে “@ecom/platform ব্যবহার করব”, Node ঘরটা খুঁজে 
# পাবে না।  উদাহরণ: থালা (dist) টেবিলে আনা হয়েছে। এবার থালার গায়ে নামের স্লিপটাও (package.json) লাগানো হলো, যাতে কেউ জিজ্ঞেস করলে বলা যায় "এটা কোন থালা।"  কেন build থেকে, prod-deps থেকে না? prod-deps-এও এই ফাইল ছিল, 
# কিন্তু এখানে build থেকেই আনা হয়েছে যাতে dist-এর সাথে একই stage-এর ফাইল মেলে। 
COPY --from=build /app/packages/platform/package.json packages/platform/package.json

# এই লাইনটা build রান্নাঘর থেকে admin-এর অনুবাদ হওয়া কোড (dist) এনে runtime টেবিলে রাখে।  আগের platform লাইনের মতোই কাজ, শুধু ঘর আলাদা।  আগে: platform-এর তৈরি খাবার (dist) আনা হয়েছিল। এবার: admin-এর তৈরি 
# খাবার (dist) আনা হচ্ছে।  এটাই আসল জিনিস। আপনার APP_MAIN=/app/services/admin/dist/main.js মনে আছে? সেই main.js ফাইলটা এই dist ফোল্ডারের ভেতরেই থাকে। মানে app এই কোড থেকেই চালু হবে।  কেন শুধু dist? মূল
#  TypeScript কোড চূড়ান্ত image-এ লাগে না। শুধু তৈরি কোড লাগে। তাই image ছোট থাকে।  উদাহরণ: platform-এর থালা টেবিলে আনা হয়েছিল। এবার মূল খাবারের থালা, মানে admin-এর থালাও আনা হলো। এই থালা থেকেই খাওয়া শুরু হবে।
COPY --from=build /app/services/admin/dist services/admin/dist

# এই লাইনটা build রান্নাঘর থেকে admin-এর migrations ফোল্ডার এনে runtime টেবিলে রাখে।  migrations কী? Migration হলো database-এর জন্য নির্দেশের খাতা। যেমন "একটা users টেবিল বানাও", "তাতে email কলাম যোগ করো"। app চালু 
# হওয়ার আগে এই নির্দেশ চালিয়ে database ঠিকঠাক সাজানো হয়।  কেন dist এর মতো অনুবাদ হওয়া না? এই ফোল্ডার সরাসরি যেমন আছে তেমনই কপি হচ্ছে। এখানে কোড অনুবাদ লাগে না (অথবা আগেই JavaScript আকারে আছে)।  আগের 
# লাইনগুলোর সাথে সম্পর্ক:  KNEXFILE = database-এর সেটিং ফাইল কোথায়, সেই চিরকুট। migrations = ওই সেটিং ধরে যে নির্দেশগুলো চলবে, সেই খাতা।  Knex এই ফোল্ডার থেকে নির্দেশ পড়ে database বানায়।  কেন লাগে? এই ফোল্ডার না থাকলে 
# চূড়ান্ত image-এ database সাজানোর নির্দেশ থাকবে না। তখন entrypoint.sh migration চালাতে গেলে খুঁজে পাবে না। উদাহরণ: থালা (dist) টেবিলে আছে। এবার সাথে একটা নির্দেশের খাতাও আনা হলো: "খাওয়ার আগে টেবিলটা এভাবে সাজিয়ে নাও।"
COPY --from=build /app/services/admin/migrations services/admin/migrations

# এই লাইনটা build রান্নাঘর থেকে admin-এর knexfile.js এনে runtime টেবিলে রাখে।  knexfile.js কী? এটা database-এর সেটিং ফাইল। এতে লেখা থাকে কোন database-এর সাথে কথা বলবে আর migration-এর খাতা কোথায় আছে।  আগের লাইনের
# সাথে সম্পর্ক:  আগের লাইন: নির্দেশের খাতা (migrations) আনা হয়েছিল। এই লাইন: সেই খাতা কোথায় আছে আর কোন database-এ চালাতে হবে, সেই ঠিকানার কাগজ আনা হচ্ছে।  আপনার মনে আছে? আগে ENV-এ লেখা ছিল KNEXFILE=/app/services/admin/knexfile.js। 
# ওই চিরকুট যে ফাইলের কথা বলছে, এটাই সেই ফাইল। ফাইল না থাকলে চিরকুটটা ফাঁকা জায়গা দেখাত।  উদাহরণ: নির্দেশের খাতা (migrations) টেবিলে আছে। এবার একটা কাগজও আনা হলো, যাতে লেখা: "খাতাটা কোথায় আছে, আর কোন টেবিলে কাজ করতে হবে।"
COPY --from=build /app/services/admin/knexfile.js services/admin/knexfile.js

# এই লাইনটা build রান্নাঘর থেকে admin-এর তালিকা-ফাইল (package.json) এনে runtime টেবিলে রাখে।  আগের platform লাইনের মতোই কাজ, শুধু ঘর আলাদা।  আগে: platform-এর নামের স্লিপ (package.json) আনা হয়েছিল। এবার: admin-এর 
# নামের স্লিপ আনা হচ্ছে।  কেন এটা লাগে? এই ফাইলে admin-এর নাম (@ecom/admin-service) আর তার তথ্য লেখা থাকে। Node আর npm এই ফাইল দেখে বোঝে ঘরটা কী। এই স্লিপ না থাকলে admin ঘরটা চিনতে সমস্যা হতে পারে।  উদাহরণ: admin-এর
# থালা (dist), নির্দেশের খাতা (migrations) আর ঠিকানার কাগজ (knexfile.js) টেবিলে আছে। এবার থালার গায়ে নামের স্লিপটাও লাগানো হলো।  মনে রাখার কথা: এই লাইন দিয়ে admin ঘরের দরকারি সব জিনিস runtime-এ চলে এলো। বাকি আছে শুধু entrypoint.sh।
COPY --from=build /app/services/admin/package.json services/admin/package.json

# এই লাইনটা আপনার নিজের লেখা entrypoint.sh ফাইলটা কপি করে container-এর ভেতরে রাখে।  ভাগ করে বুঝি:  COPY = কপি করো। (এবার --from= নেই, তাই কোনো stage থেকে না।) docker/entrypoint.sh = আপনার কম্পিউটারের project-এর
# ভেতরে docker ফোল্ডারের entrypoint.sh ফাইল। /usr/local/bin/entrypoint.sh = container-এর ভেতরে যেখানে রাখা হবে।  আগের লাইনগুলোর সাথে পার্থক্য: আগের সব লাইন অন্য stage থেকে জিনিস আনছিল। এই লাইন সরাসরি আপনার নিজের
# কম্পিউটার থেকে ফাইল আনছে।  entrypoint.sh কী? এটা একটা script, মানে কয়েকটা কমান্ডের তালিকা। container চালু হলে সবার আগে এটাই চলে। সাধারণত এতে থাকে:  database ঠিক করার migration চালানো তারপর app চালু করা (APP_MAIN চিরকুট 
# পড়ে)  /usr/local/bin/ কেন? Linux-এ এটা এমন একটা জায়গা, যেখানে চালানোর মতো script রাখা হয়। সবাই সহজে খুঁজে পায়।  মনে রাখার কথা: ফাইল শুধু কপি হলো, এখনো চালানোর অনুমতি পায়নি। সেটা পরের লাইনে (chmod +x) দেওয়া হবে।  উদাহরণ: 
# টেবিলে সব খাবার সাজানো হয়েছে। এবার আপনার নিজের হাতে লেখা একটা নির্দেশ-কাগজ রাখা হলো: "খাওয়া শুরুর আগে প্রথমে এই কাজগুলো করো।"
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# এই তিন লাইন মিলে তিনটা কাজ করে। && মানে একটা সফল হলে তবেই পরেরটা, আর \ মানে কমান্ড পরের লাইনেও চলছে।  ১. chmod +x /usr/local/bin/entrypoint.sh chmod = change mode (অনুমতি বদলাও)। +x = executable, মানে "চালানোর 
# অনুমতি দাও।"  আগের লাইনে ফাইল শুধু কপি হয়েছিল। কপি হলেই চালানো যায় না। এই কমান্ড অনুমতি দেয়, তাই entrypoint.sh এখন চলতে পারে।  ২. mkdir -p /app/storage/invoices mkdir = make directory (ফোল্ডার বানাও)। -p মানে 
# মাঝের ফোল্ডার না থাকলে সেটাও বানাও, আর আগে থেকে থাকলে ঝামেলা কোরো না।  এতে /app/storage/invoices নামের ফোল্ডার তৈরি হয়। app এখানে invoice (বিলের ফাইল) রাখবে।  ৩. chown -R node:node /app/storage chown = change 
# owner (মালিক বদলাও)। -R মানে ভেতরের সব কিছুসহ। node:node মানে node নামের user আর node নামের group।  এখন ফোল্ডারটার মালিক node user।  কেন এটা জরুরি? একটু পরেই USER node লাইন আসবে। তখন app root হিসেবে না, সাধারণ 
# node user হিসেবে চলবে। যদি ফোল্ডারের মালিক root থাকত, তাহলে node user সেখানে ফাইল লিখতে পারত না, আর invoice সেভ করতে গিয়ে error হতো।
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage/invoices \
 && chown -R node:node /app/storage

# এখন থেকে সব কিছু root না, "node" নামের সাধারণ user দিয়ে চলবে (নিরাপত্তার জন্য ভালো)
USER node

# EXPOSE 3002 মানে "আমার app 3002 নম্বর দরজা দিয়ে কথা বলে", এটা শুধু জানিয়ে রাখা।
EXPOSE 3002

# এই লাইনটা Docker-কে বলে: "মাঝে মাঝে গিয়ে দেখো app সুস্থ আছে কিনা।"  এটা দুই ভাগে:  প্রথম লাইন = কত পরপর আর কীভাবে দেখবে (নিয়ম) দ্বিতীয় লাইন (CMD ...) = আসলে কী করে দেখবে (কাজ)  প্রথম ভাগ: নিয়ম  --interval=15s = প্রতি ১৫ সেকেন্ডে একবার দেখো। --timeout=5s = ৫ সেকেন্ডের মধ্যে উত্তর না এলে ধরো "ফেল।" --start-period=40s = app চালু হতে সময় লাগে, তাই প্রথম ৪০ সেকেন্ডে ফেল হলে গুনবে না। --retries=5 = পরপর ৫ বার ফেল হলে তখন বলো “unhealthy।” \ = কমান্ড পরের লাইনেও চলছে।  দ্বিতীয় ভাগ: কাজ  CMD node -e "..." মানে node দিয়ে একটা ছোট কোড চালাও। কোডটা:  fetch('http://127.0.0.1:3002/health/ready') = নিজের app-এর দরজায় গিয়ে /health/ready ঠিকানায় ডাক দাও। (127.0.0.1 মানে "নিজের ঘর।") process.env.PORT||3002 = PORT চিরকুট থাকলে সেটা, না থাকলে 3002। .then(r=>process.exit(r.ok?0:1)) = উত্তর ঠিক এলে 0 (সুস্থ), না এলে 1 (অসুস্থ)। .catch(()=>process.exit(1)) = ডাক দিতেই error হলে (app বন্ধ), 1 (অসুস্থ)।
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# এই লাইনটা বলে: “container চালু হলে সবার আগে এই কমান্ড চালাও।” এটাই Dockerfile-এর শেষ লাইন।  ভাগ করে বুঝি:  ENTRYPOINT = container-এর "প্রথম কাজ।" container চালু হলে Docker এটাই চালায়। /usr/bin/dumb-init = প্রথমে গেটকিপার (dumb-init) চলবে। (আগে বলেছি, সে বন্ধ করার বার্তা ঠিকমতো app-কে পৌঁছে দেয়।) -- = "এখানে dumb-init-এর নিজের নির্দেশ শেষ। এর পরে যা আছে, সেটা তার চালানোর জিনিস।" /usr/local/bin/entrypoint.sh = আপনার নিজের লেখা script, যেটা dumb-init চালাবে।  মানে কী দাঁড়ালো? Container চালু হলে এই ক্রম চলে:  dumb-init শুরু হয় (গেটকিপার) সে entrypoint.sh চালায় (আপনার নির্দেশ-কাগজ) entrypoint.sh migration চালায়, তারপর app চালু করে (APP_MAIN চিরকুট পড়ে)  [ ] আর " " কেন? এটাকে বলে “exec form”। এতে কমান্ড সরাসরি চলে, মাঝখানে বাড়তি shell আসে না। তাই বন্ধ করার বার্তা (docker stop) ঠিকমতো পৌঁছায়।  উদাহরণ: রেস্টুরেন্ট খোলার সময়:  আগে গেটকিপার দরজায় এসে দাঁড়ায় (dumb-init)। সে ম্যানেজারকে নির্দেশ-কাগজ ধরিয়ে দেয় (entrypoint.sh)। ম্যানেজার কাগজ পড়ে রান্নাঘর সাজায়, তারপর রান্না শুরু করে।
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]





# FROM node:22-alpine AS base

# prothom a ata nilam and second a 

# FROM base AS deps

# basically ai gullo diye ki bojhano hoy? duitar sathe somporko ki daray? 

# এটা বুঝলে পুরো Dockerfile-এর কাঠামো বোঝা হয়ে যাবে।

# ১. প্রথম লাইন
# FROM node:22-alpine AS base
# = “বাইরের দোকান থেকে একটা তৈরি image নাও (node:22-alpine), আর তার নাম দাও base।”

# এখানে node:22-alpine হলো Docker Hub-এর (image-এর বাজার) একটা তৈরি image। তাতে Linux (Alpine) আর Node 22 আগে থেকেই বসানো আছে। আপনি শূন্য থেকে শুরু করছেন না।

# ২. দ্বিতীয় লাইন
# FROM base AS deps
# = “আমার নিজের বানানো base থেকে শুরু করো, আর এই নতুনটার নাম দাও deps।”

# এখানে FROM-এর পরে বাইরের image না, আপনার নিজের আগের stage-এর নাম।

# দুটোর সম্পর্ক কী?
# deps হলো base-এর সন্তান। deps শুরু হয় base-এর শেষ অবস্থা থেকে। মানে base-এ যা কিছু ছিল, সব deps-এ আছে:

# Node 22 আছে
# dumb-init install করা আছে
# কাজের ফোল্ডার /app ঠিক করা আছে
# NODE_ENV=production সেট করা আছে

# আর deps তার ওপর নিজের কাজ যোগ করে (package আনা)।

# সহজ উদাহরণ: বাড়ি বানানো

# node:22-alpine = কেনা জমি, যাতে ভিত আগে থেকেই আছে।
# base = সেই জমিতে আপনি দেয়াল, বিদ্যুৎ, পানির লাইন বসালেন। এটা "মূল কাঠামো"।
# deps = মূল কাঠামো ধরে একটা ঘর বানালেন যেখানে সব মালপত্র রাখা হবে।
# build = আবার একটা ঘর, যেটা deps-এর মালপত্র নিয়েই শুরু।

# পুরো পরিবারের গাছ:

# node:22-alpine (বাইরের image)
#    └── base (আপনার মূল কাঠামো)
#          ├── deps (সব package, dev সহ)
#          │     └── build (কোড অনুবাদ)
#          ├── prod-deps (শুধু production package)
#          └── runtime (চূড়ান্ত image)

# এই গাছ থেকে তিনটা জরুরি বিষয়:

# ক) base একবার লেখা, বারবার ব্যবহার।
# dumb-init install আর WORKDIR চারটা stage-এ লাগে (deps, prod-deps, runtime, এবং build পরোক্ষভাবে)। প্রতিবার না লিখে একবার base-এ লিখে সবাই সেখান থেকে শুরু করে। এতে ভুলও কম হয়।

# খ) FROM deps আর FROM base এর পার্থক্য কেন গুরুত্বপূর্ণ।

# build শুরু হয় deps থেকে, কারণ build-এর দরকার সব package (dev সহ)।
# prod-deps আর runtime শুরু হয় base থেকে, কারণ তাদের deps-এর বাড়তি যন্ত্রপাতি চাই না।

# গ) শুধু runtime stage-ই শেষে image হয়।
# বাকি stage-গুলো (deps, build, prod-deps) শুধু রান্নাঘর। কাজ শেষে ফেলে দেওয়া হয়। তাই চূড়ান্ত image ছোট থাকে। এটাকেই বলে multi-stage build।




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
# COPY services/admin services/admin
# RUN npm run build -w @ecom/platform \
#  && npm run build -w @ecom/admin-service

# FROM base AS prod-deps
# COPY package.json package-lock.json .npmrc ./
# COPY packages/platform/package.json packages/platform/
# COPY services/auth/package.json services/auth/
# COPY services/admin/package.json services/admin/
# COPY services/public/package.json services/public/
# RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# FROM base AS runtime
# ENV APP_MAIN=/app/services/admin/dist/main.js \
#     KNEXFILE=/app/services/admin/knexfile.js \
#     NODE_OPTIONS=--enable-source-maps

# COPY --from=prod-deps /app/node_modules ./node_modules
# COPY --from=prod-deps /app/package.json ./package.json
# COPY --from=build /app/packages/platform/dist packages/platform/dist
# COPY --from=build /app/packages/platform/package.json packages/platform/package.json
# COPY --from=build /app/services/admin/dist services/admin/dist
# COPY --from=build /app/services/admin/migrations services/admin/migrations
# COPY --from=build /app/services/admin/knexfile.js services/admin/knexfile.js
# COPY --from=build /app/services/admin/package.json services/admin/package.json
# COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# RUN chmod +x /usr/local/bin/entrypoint.sh \
#  && mkdir -p /app/storage/invoices \
#  && chown -R node:node /app/storage

# USER node
# EXPOSE 3002

# HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
#   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
