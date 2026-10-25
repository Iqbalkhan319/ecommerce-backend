#!/usr/bin/env bash
### ILM retention (7 din) + replica 0 (single-node cluster). Bar bar chalaleo kono khoti nei.
set -euo pipefail

NS=logging
NODE_IP=172.17.0.233
PW=$(kubectl -n "$NS" get secret efk-es-elastic-user -o go-template='{{.data.elastic | base64decode}}')
NP=$(kubectl -n "$NS" get svc efk-es-http -o jsonpath='{.spec.ports[0].nodePort}')
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

echo "== 2. Index template: notun logstash-* index-e policy + replica 0 =="
es_put "_index_template/logs-template" '{
  "index_patterns": ["logstash-*"],
  "priority": 200,
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-7d",
      "index.number_of_replicas": 0
    }
  }
}'

echo "== 3. Ager toiri index gulote lagano =="
es_put "logstash-*/_settings" '{
  "index.lifecycle.name": "logs-7d",
  "index.number_of_replicas": 0
}'

echo "== Verify: index health =="
curl -sk -u "elastic:${PW}" "${ES}/_cat/indices/logstash-*?v&h=index,health,docs.count,store.size"

echo "== Verify: ILM policy =="
curl -sk -u "elastic:${PW}" "${ES}/logstash-*/_ilm/explain?filter_path=indices.*.policy,indices.*.phase&pretty"
