#!/bin/bash
# Notun cluster-e shob kichu restore. Chalanor age: kubectl/helm/argocd CLI, ar niche-r backup file duto.
set -euo pipefail
B=$HOME/ecommerce-backend/k8s-infra-manifest
F=$HOME/ecommerce-frontend
SSKEY=${SSKEY:-$HOME/sealed-secrets-key-backup.yaml}
KEEK=${KEEK:-$HOME/kibana-encryption-keys-backup.yaml}

echo "== 1. MetalLB"
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.8/config/manifests/metallb-native.yaml
kubectl rollout status deploy/controller -n metallb-system --timeout=3m
kubectl apply -f $B/metallb/metallb-config.yaml

echo "== 2. ingress-nginx"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.2/deploy/static/provider/cloud/deploy.yaml
kubectl rollout status deploy/ingress-nginx-controller -n ingress-nginx --timeout=5m
kubectl apply -f $B/ingress-nginx/controller-service.yaml

echo "== 3. Sealed Secrets (age private key restore, tarpor controller)"
kubectl apply -f "$SSKEY"
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.41.2/controller.yaml
kubectl rollout restart deploy/sealed-secrets-controller -n kube-system
kubectl rollout status deploy/sealed-secrets-controller -n kube-system --timeout=3m

echo "== 4. Helm repos"
helm repo add jetstack https://charts.jetstack.io
helm repo add argo https://argoproj.github.io/argo-helm
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo add elastic https://helm.elastic.co
helm repo add fluent https://fluent.github.io/helm-charts
helm repo add sonarqube https://SonarSource.github.io/helm-chart-sonarqube
helm repo update

echo "== 5. cert-manager + ecom-ca issuer"
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --version v1.21.3 --set crds.enabled=true --wait
kubectl apply -f $B/cert-manager/cluster-issuer.yaml
kubectl wait certificate/ecom-ca -n cert-manager --for=condition=Ready --timeout=2m

echo "== 6. ArgoCD + Applications"
helm upgrade --install argocd argo/argo-cd -n argocd --create-namespace --version 10.17.1 -f $B/argocd/argocd-values.yaml --wait
kubectl apply -f $B/argocd/ecom-backend-app.yaml -f $B/argocd/otel-app.yaml \
              -f $F/argocd/ecom-frontend-app.yaml -f $F/argocd/monitoring-app.yaml

echo "== 7. OpenTelemetry operator"
helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator -n opentelemetry-operator-system --create-namespace --version 0.129.0 --wait

echo "== 8. Logging: Elasticsearch, Kibana, Fluent Bit"
kubectl create ns logging --dry-run=client -o yaml | kubectl apply -f -
if [ -f "$KEEK" ]; then kubectl apply -f "$KEEK"; else
  kubectl create secret generic kibana-encryption-keys -n logging --from-literal=security=$(openssl rand -hex 32) --from-literal=saved=$(openssl rand -hex 32) --from-literal=reporting=$(openssl rand -hex 32)
fi
helm upgrade --install elasticsearch elastic/elasticsearch -n logging --version 8.5.1 -f $B/logging/00-elasticsearch-values.yaml --timeout 10m
helm upgrade --install kibana elastic/kibana -n logging --version 8.5.1 -f $B/logging/02-kibana-values.yaml --timeout 10m
helm upgrade --install fluent-bit fluent/fluent-bit -n logging --version 0.58.3 -f $B/logging/03-fluent-bit-values.yaml

echo "== 9. SonarQube (admin password default admin/admin, login kore bodle nio)"
helm upgrade --install sonarqube sonarqube/sonarqube -n sonarqube --create-namespace --version 2026.5.1004 \
  -f $B/sonarqube/values.yaml --set monitoringPasscode=$(openssl rand -hex 12)

echo "== DONE. Baki manual: /etc/hosts entry, ecom-ca.crt browser-e import"
echo "   ecom-ca.crt: kubectl get secret ecom-ca-secret -n cert-manager -o jsonpath='{.data.ca\\.crt}' | base64 -d > ecom-ca.crt"
