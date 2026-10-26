#!/usr/bin/env bash
### ILM retention (7 din) + replica 0 (single-node). Bar bar chalaleo kono khoti nei.
set -euo pipefail

NS=logging
NODE_IP=172.17.0.233
PW=$(kubectl -n "$NS" get secret elasticsearch-master-credentials -o jsonpath='{.data.password}' | base64 -d)
NP=$(kubectl -n "$NS" get svc elasticsearch-master -o jsonpath='{.spec.ports[0].nodePort}')
ES="https://${NODE_IP}:${NP}"

es_put() {
  curl -sk -u "elastic:${PW}" -H 'Content-Type: application/json' -X PUT "${ES}/$1" -d "$2"
  echo
}

echo "== 1. ILM policy: 7 din por delete =="
es_put "_ilm/policy/logs-7d" '{
  "policy": {
    "phases": {
      "hot": { "actions": {} },
      "delete": { "min_age": "7d", "actions": { "delete": {} } }
    }
  }
}'

echo "== 2. Template: logstash-* ar node-* index-e policy + replica 0 =="
es_put "_index_template/logs-template" '{
  "index_patterns": ["logstash-*", "node-*"],
  "priority": 200,
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-7d",
      "index.number_of_replicas": 0
    }
  }
}'

echo "== 3. Ager toiri index thakle sheikhane lagano =="
es_put "logstash-*,node-*/_settings?allow_no_indices=true" '{
  "index.lifecycle.name": "logs-7d",
  "index.number_of_replicas": 0
}'

echo "== Verify: index health =="
curl -sk -u "elastic:${PW}" "${ES}/_cat/indices/logstash-*,node-*?v&h=index,health,docs.count,store.size"
