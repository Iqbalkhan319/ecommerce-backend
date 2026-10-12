#!/bin/sh

# =====================================================================
# শেখার কপি: প্রতিটা অংশের ঠিক ওপরে বাংলা ব্যাখ্যা। কমান্ডগুলো আগের entrypoint.sh-এর সাথে হুবহু এক।
#
# খুব গুরুত্বপূর্ণ নিয়ম: প্রথম লাইন "#!/bin/sh" (শেবাং/shebang) একদম একা থাকতে হয়।
# এর পাশে বা পরে কোনো মন্তব্য লেখা যাবে না। Linux ওই লাইনের "/bin/sh"-এর পরের সবটুকুকে sh-এর
# একটা আর্গুমেন্ট ধরে নেয়, তাই sh তখন সেই মন্তব্যকেই ফাইলের নাম ভেবে খুলতে চেষ্টা করে এবং
# "can't open '# ...'" error দিয়ে container বারবার ক্র্যাশ করে।
# শেলের বাকি লাইনে কমান্ডের পরে # মন্তব্য চলে, কিন্তু শেবাং লাইনে চলে না।
# =====================================================================

# set -eu দুটো নিরাপত্তা সুইচ চালু করে:
#   -e : কোনো কমান্ড ব্যর্থ হলে স্ক্রিপ্ট সাথে সাথে থেমে যাবে (ব্যর্থতা চেপে গিয়ে এগোবে না)।
#   -u : যে ভ্যারিয়েবল সেট করা নেই সেটা ব্যবহার করতে গেলে error দেবে (বানান ভুল ধরা পড়ে)।
set -eu

# APP_MAIN: অ্যাপের মূল ফাইল কোথায় (Dockerfile-এর ENV থেকে আসে, যেমন /app/services/auth/dist/main.js)।
# ${নাম:?বার্তা} মানে নাম সেট না থাকলে বার্তা দেখিয়ে স্ক্রিপ্ট বন্ধ হয়ে যাবে। শুরুর ":" একটা খালি কমান্ড, এখানে শুধু এই পরীক্ষাটা চালাতে বসানো।
: "${APP_MAIN:?APP_MAIN is required}"

# KNEXFILE: knex (ডাটাবেস migration টুল)-এর সেটিং ফাইল কোথায়। না থাকলে বন্ধ।
: "${KNEXFILE:?KNEXFILE is required}"

# মূল ইংরেজি মন্তব্যের অর্থ: এখানে knex-এর বাইনারি সরাসরি ডাকা হয়, npm/npx ছাড়া।
# ফলে container শুধু-পড়া (read-only) ফাইলসিস্টেমে চালানো যায়, কারণ npx নিজের cache লিখতে চায়।
# বাইনারি যেখানে আশা করা হয় সেখানে না পেলে npx-এ ফিরে যায়।

# KNEX_BIN: knex প্রোগ্রামের পথ। আগে থেকে সেট করা না থাকলে ডিফল্ট /app/node_modules/.bin/knex।
KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"

# run_knex একটা ছোট ফাংশন: "knex চালাও" কাজটাকে একটা নামে বেঁধে রাখে, যাতে নিচে বারবার লিখতে না হয়।
# "$@" মানে ফাংশনকে যে আর্গুমেন্টগুলো দেওয়া হয়েছে সেগুলো হুবহু পাঠিয়ে দাও।
run_knex() {
  # -x পরীক্ষা করে: ওই পথে ফাইলটা আছে এবং চালানোর অনুমতি আছে কিনা।
  if [ -x "$KNEX_BIN" ]; then
    # আছে: সরাসরি চালাও (দ্রুত, npm লাগে না)।
    "$KNEX_BIN" "$@"
  else
    # নেই: বিকল্প হিসেবে npx দিয়ে চালাও। --no-install মানে ইন্টারনেট থেকে কিছু নামাবে না, শুধু ইনস্টল করা knex খুঁজবে।
    npx --no-install knex "$@"
  fi
}

# RUN_MIGRATIONS=true হলে (compose-এ ডিফল্ট true) অ্যাপ চালু করার আগে ডাটাবেসের কাঠামো হালনাগাদ করা হয়।
# ${নাম:-false} মানে সেট না থাকলে false ধরো।
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  # attempt: এখন কত নম্বর চেষ্টা চলছে। শুরু ১।
  attempt=1

  # সর্বোচ্চ কতবার চেষ্টা করবে। ডিফল্ট ১৫। ডাটাবেস তখনো প্রস্তুত না থাকলে আবার চেষ্টা করার জন্য এটা লাগে।
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"

  # until মানে "যতক্ষণ না সফল হয়": migrate:latest সফল না হওয়া পর্যন্ত লুপ চলবে। সফল হলেই লুপ থেকে বেরিয়ে যায়।
  # migrate:latest সব বাকি migration নিজের schema-তে চালায়।
  until run_knex migrate:latest --knexfile "$KNEXFILE"; do
    # -ge মানে "বড় বা সমান": চেষ্টা সর্বোচ্চ সীমায় পৌঁছে গেলে হাল ছেড়ে দাও।
    if [ "$attempt" -ge "$max_attempts" ]; then
      # >&2 মানে বার্তাটা error-স্ট্রিমে যায় (docker compose logs-এ দেখা যায়)।
      echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2
      # ১ দিয়ে বেরোনো মানে ব্যর্থ। অ্যাপ চালু হয় না, container রিস্টার্ট নীতি অনুযায়ী আবার চেষ্টা করে।
      exit 1
    fi
    # এখনো সীমা পার হয়নি: কত নম্বর চেষ্টা ব্যর্থ হলো জানিয়ে দাও।
    echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2
    # $(( )) গণিতের জন্য: চেষ্টার সংখ্যা ১ বাড়াও।
    attempt=$((attempt + 1))
    # ৩ সেকেন্ড অপেক্ষা করে আবার চেষ্টা (ডাটাবেস প্রস্তুত হওয়ার সময় দেওয়া)।
    sleep 3
  done
fi

# RUN_SEED=true হলে ডেমো ডাটা বসানো হয় (ডিফল্ট false)। আপনার টেস্ট .env-এ true, লাইভে অবশ্যই false।
if [ "${RUN_SEED:-false}" = "true" ]; then
  # seed ফাইলের পথ: অ্যাপের মূল ফাইলের ফোল্ডারে seed/seed.js। dirname একটা পথের ফোল্ডার-অংশ বের করে।
  seed_script="$(dirname "$APP_MAIN")/seed/seed.js"
  # -f পরীক্ষা করে ফাইলটা আছে কিনা। না থাকলে চুপচাপ এড়িয়ে যায়।
  if [ -f "$seed_script" ]; then
    # seed চালাও। "|| echo ..." মানে seed ব্যর্থ হলেও শুধু সতর্কবার্তা দিয়ে চালু হওয়া চালিয়ে যাও (-e থাকা সত্ত্বেও বন্ধ হবে না)।
    node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2
  fi
fi

# exec মানে বর্তমান প্রসেসকেই অ্যাপ দিয়ে বদলে ফেলো, নতুন করে আরেকটা প্রসেস বানিও না।
# এতে dumb-init-এর পাঠানো "বন্ধ হও" সংকেত (SIGTERM) সরাসরি অ্যাপ পায়, তাই docker stop ভদ্রভাবে থামায়।
exec node "$APP_MAIN"











# #!/bin/sh                                   # এই স্ক্রিপ্ট sh দিয়ে চলবে (alpine এ bash নেই, sh আছে)
# set -eu                                     # -e: কোনো কমান্ড ব্যর্থ হলেই থেমে যাও।  -u: না-থাকা variable ব্যবহার করলে error দাও

# # ---------------------------------------------------------------------
# # ধাপ ০: দরকারি তথ্য আছে কিনা যাচাই (Dockerfile এর ENV এ লেখা নোট দুটো)
# # ---------------------------------------------------------------------
# : "${APP_MAIN:?APP_MAIN is required}"       # APP_MAIN (app এর মূল ফাইল) না থাকলে error দিয়ে থেমে যাও। শুরুর ":" একটা খালি কমান্ড, শুধু যাচাইয়ের জন্য
# : "${KNEXFILE:?KNEXFILE is required}"       # KNEXFILE (ডাটাবেস সেটিং ফাইল) না থাকলে থেমে যাও

# # knex কে সরাসরি ডাকো: চালুর সময় npm/npx লাগবে না, তাই container এর ফাইলসিস্টেম read-only রাখা যায়।
# # knex যেখানে আশা করা হয় সেখানে না পেলে npx দিয়ে চেষ্টা করবে।
# KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"   # knex এর ফাইল কোথায়। আগে থেকে বলা না থাকলে এই ডিফল্ট জায়গা
# run_knex() {                                # run_knex নামে একটা ছোট কাজের ব্লক বানাও (পরে নাম ধরে ডাকা যাবে)
#   if [ -x "$KNEX_BIN" ]; then               # knex ফাইলটা আছে আর চালানো যায়?
#     "$KNEX_BIN" "$@"                        # হ্যাঁ হলে সরাসরি চালাও। "$@" মানে ডাকার সময় যা যা দেওয়া হয়েছে সব
#   else                                      # না হলে
#     npx --no-install knex "$@"              # npx দিয়ে চালাও (--no-install মানে নতুন করে নামাবে না)
#   fi                                        # if এর শেষ
# }                                           # run_knex ব্লকের শেষ

# # ---------------------------------------------------------------------
# # ধাপ ১: ডাটাবেসের table বানানো/বদলানো (migration), বারবার চেষ্টা করে
# # ---------------------------------------------------------------------
# if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then   # RUN_MIGRATIONS=true থাকলে তবেই এই অংশ চলবে (না বললে false)
#   attempt=1                                 # এটা প্রথম চেষ্টা
#   max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"     # সর্বোচ্চ কতবার চেষ্টা করবে। না বললে ১৫ বার
#   until run_knex migrate:latest --knexfile "$KNEXFILE"; do   # migration সফল না হওয়া পর্যন্ত নিচের কাজগুলো বারবার করো
#     if [ "$attempt" -ge "$max_attempts" ]; then    # চেষ্টা সর্বোচ্চ সীমায় পৌঁছে গেছে?
#       echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2   # error বার্তা দেখাও (>&2 মানে error এর জায়গায়)
#       exit 1                                # 1 দিয়ে বের হয়ে যাও (ব্যর্থ), app চালু করবে না
#     fi                                      # if এর শেষ
#     echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2   # "এই চেষ্টা ব্যর্থ, ৩ সেকেন্ড পরে আবার"
#     attempt=$((attempt + 1))                # চেষ্টার গোনা ১ বাড়াও
#     sleep 3                                 # ৩ সেকেন্ড অপেক্ষা করো (ডাটাবেস তৈরি হওয়ার সময় দিতে)
#   done                                      # until এর শেষ। সফল হলে এখানে এসে পরের ধাপে যাবে
# fi                                          # if এর শেষ

# # ---------------------------------------------------------------------
# # ধাপ ২: নমুনা (seed) ডাটা ঢোকানো, শুধু বললে
# # ---------------------------------------------------------------------
# if [ "${RUN_SEED:-false}" = "true" ]; then  # RUN_SEED=true থাকলে তবেই (না বললে false)
#   seed_script="$(dirname "$APP_MAIN")/seed/seed.js"   # seed ফাইলের জায়গা: APP_MAIN যে ফোল্ডারে আছে তার ভেতরের seed/seed.js
#   if [ -f "$seed_script" ]; then            # ফাইলটা সত্যিই আছে?
#     node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2   # চালাও। ব্যর্থ হলে শুধু বার্তা দেখাও, থামবে না (|| মানে "ব্যর্থ হলে এটা")
#   fi                                        # if এর শেষ
# fi                                          # if এর শেষ

# # ---------------------------------------------------------------------
# # ধাপ ৩: আসল app চালু করা
# # ---------------------------------------------------------------------
# exec node "$APP_MAIN"                       # স্ক্রিপ্টকে সরিয়ে তার জায়গায় node বসাও, যাতে বন্ধ করার সংকেত সরাসরি app এ পৌঁছায়



# ############## original entrypoint.sh ##############
# # #!/bin/sh
# # set -eu

# # : "${APP_MAIN:?APP_MAIN is required}"
# # : "${KNEXFILE:?KNEXFILE is required}"

# # # Call the knex binary directly: no npm/npx at runtime, so the container can run with a
# # # read-only root filesystem. Falls back to npx if the binary is not where we expect it.
# # KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"
# # run_knex() {
# #   if [ -x "$KNEX_BIN" ]; then
# #     "$KNEX_BIN" "$@"
# #   else
# #     npx --no-install knex "$@"
# #   fi
# # }

# # if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
# #   attempt=1
# #   max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"
# #   until run_knex migrate:latest --knexfile "$KNEXFILE"; do
# #     if [ "$attempt" -ge "$max_attempts" ]; then
# #       echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2
# #       exit 1
# #     fi
# #     echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2
# #     attempt=$((attempt + 1))
# #     sleep 3
# #   done
# # fi

# # if [ "${RUN_SEED:-false}" = "true" ]; then
# #   seed_script="$(dirname "$APP_MAIN")/seed/seed.js"
# #   if [ -f "$seed_script" ]; then
# #     node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2
# #   fi
# # fi

# # exec node "$APP_MAIN"
