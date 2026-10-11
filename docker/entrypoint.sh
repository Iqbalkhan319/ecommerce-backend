#!/bin/sh                                   # এই স্ক্রিপ্ট sh দিয়ে চলবে (alpine এ bash নেই, sh আছে)
set -eu                                     # -e: কোনো কমান্ড ব্যর্থ হলেই থেমে যাও।  -u: না-থাকা variable ব্যবহার করলে error দাও

# ---------------------------------------------------------------------
# ধাপ ০: দরকারি তথ্য আছে কিনা যাচাই (Dockerfile এর ENV এ লেখা নোট দুটো)
# ---------------------------------------------------------------------
: "${APP_MAIN:?APP_MAIN is required}"       # APP_MAIN (app এর মূল ফাইল) না থাকলে error দিয়ে থেমে যাও। শুরুর ":" একটা খালি কমান্ড, শুধু যাচাইয়ের জন্য
: "${KNEXFILE:?KNEXFILE is required}"       # KNEXFILE (ডাটাবেস সেটিং ফাইল) না থাকলে থেমে যাও

# knex কে সরাসরি ডাকো: চালুর সময় npm/npx লাগবে না, তাই container এর ফাইলসিস্টেম read-only রাখা যায়।
# knex যেখানে আশা করা হয় সেখানে না পেলে npx দিয়ে চেষ্টা করবে।
KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"   # knex এর ফাইল কোথায়। আগে থেকে বলা না থাকলে এই ডিফল্ট জায়গা
run_knex() {                                # run_knex নামে একটা ছোট কাজের ব্লক বানাও (পরে নাম ধরে ডাকা যাবে)
  if [ -x "$KNEX_BIN" ]; then               # knex ফাইলটা আছে আর চালানো যায়?
    "$KNEX_BIN" "$@"                        # হ্যাঁ হলে সরাসরি চালাও। "$@" মানে ডাকার সময় যা যা দেওয়া হয়েছে সব
  else                                      # না হলে
    npx --no-install knex "$@"              # npx দিয়ে চালাও (--no-install মানে নতুন করে নামাবে না)
  fi                                        # if এর শেষ
}                                           # run_knex ব্লকের শেষ

# ---------------------------------------------------------------------
# ধাপ ১: ডাটাবেসের table বানানো/বদলানো (migration), বারবার চেষ্টা করে
# ---------------------------------------------------------------------
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then   # RUN_MIGRATIONS=true থাকলে তবেই এই অংশ চলবে (না বললে false)
  attempt=1                                 # এটা প্রথম চেষ্টা
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"     # সর্বোচ্চ কতবার চেষ্টা করবে। না বললে ১৫ বার
  until run_knex migrate:latest --knexfile "$KNEXFILE"; do   # migration সফল না হওয়া পর্যন্ত নিচের কাজগুলো বারবার করো
    if [ "$attempt" -ge "$max_attempts" ]; then    # চেষ্টা সর্বোচ্চ সীমায় পৌঁছে গেছে?
      echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2   # error বার্তা দেখাও (>&2 মানে error এর জায়গায়)
      exit 1                                # 1 দিয়ে বের হয়ে যাও (ব্যর্থ), app চালু করবে না
    fi                                      # if এর শেষ
    echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2   # "এই চেষ্টা ব্যর্থ, ৩ সেকেন্ড পরে আবার"
    attempt=$((attempt + 1))                # চেষ্টার গোনা ১ বাড়াও
    sleep 3                                 # ৩ সেকেন্ড অপেক্ষা করো (ডাটাবেস তৈরি হওয়ার সময় দিতে)
  done                                      # until এর শেষ। সফল হলে এখানে এসে পরের ধাপে যাবে
fi                                          # if এর শেষ

# ---------------------------------------------------------------------
# ধাপ ২: নমুনা (seed) ডাটা ঢোকানো, শুধু বললে
# ---------------------------------------------------------------------
if [ "${RUN_SEED:-false}" = "true" ]; then  # RUN_SEED=true থাকলে তবেই (না বললে false)
  seed_script="$(dirname "$APP_MAIN")/seed/seed.js"   # seed ফাইলের জায়গা: APP_MAIN যে ফোল্ডারে আছে তার ভেতরের seed/seed.js
  if [ -f "$seed_script" ]; then            # ফাইলটা সত্যিই আছে?
    node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2   # চালাও। ব্যর্থ হলে শুধু বার্তা দেখাও, থামবে না (|| মানে "ব্যর্থ হলে এটা")
  fi                                        # if এর শেষ
fi                                          # if এর শেষ

# ---------------------------------------------------------------------
# ধাপ ৩: আসল app চালু করা
# ---------------------------------------------------------------------
exec node "$APP_MAIN"                       # স্ক্রিপ্টকে সরিয়ে তার জায়গায় node বসাও, যাতে বন্ধ করার সংকেত সরাসরি app এ পৌঁছায়



############## original entrypoint.sh ##############
# #!/bin/sh
# set -eu

# : "${APP_MAIN:?APP_MAIN is required}"
# : "${KNEXFILE:?KNEXFILE is required}"

# # Call the knex binary directly: no npm/npx at runtime, so the container can run with a
# # read-only root filesystem. Falls back to npx if the binary is not where we expect it.
# KNEX_BIN="${KNEX_BIN:-/app/node_modules/.bin/knex}"
# run_knex() {
#   if [ -x "$KNEX_BIN" ]; then
#     "$KNEX_BIN" "$@"
#   else
#     npx --no-install knex "$@"
#   fi
# }

# if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
#   attempt=1
#   max_attempts="${MIGRATION_MAX_ATTEMPTS:-15}"
#   until run_knex migrate:latest --knexfile "$KNEXFILE"; do
#     if [ "$attempt" -ge "$max_attempts" ]; then
#       echo "Migrations failed after ${max_attempts} attempts; refusing to start." >&2
#       exit 1
#     fi
#     echo "Migration attempt ${attempt}/${max_attempts} failed; retrying in 3s..." >&2
#     attempt=$((attempt + 1))
#     sleep 3
#   done
# fi

# if [ "${RUN_SEED:-false}" = "true" ]; then
#   seed_script="$(dirname "$APP_MAIN")/seed/seed.js"
#   if [ -f "$seed_script" ]; then
#     node "$seed_script" || echo "Seeding reported a failure; continuing startup." >&2
#   fi
# fi

# exec node "$APP_MAIN"
