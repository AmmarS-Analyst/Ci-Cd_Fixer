# Running devops-agent on Kubernetes (minikube)

This is a learning-oriented deployment of the same app that `docker-compose.yml`
runs — same three services (agent, ollama, postgres), same env vars, raw YAML
manifests (no Helm) so every primitive is visible. It's a second way to run the
project, not a replacement for docker-compose, which is still the fastest path
for local dev.

## 1. Start minikube

```bash
minikube start
```

## 2. Build and load the agent image

minikube runs its own Docker daemon separate from your host's — a normal
`docker build` won't be visible inside the cluster. Build normally, then load
the image directly into the node (no registry needed for local learning):

```bash
docker build -t devops-agent:local ./agent
minikube image load devops-agent:local
```

Re-run both commands after any code change — `imagePullPolicy: IfNotPresent`
means the cluster won't notice a rebuilt image unless it's reloaded (or you
`kubectl rollout restart deployment/agent -n devops-agent` after reloading).

## 3. Create the secret

```bash
cp k8s/secret.example.yaml k8s/secret.yaml
# edit k8s/secret.yaml: real GITHUB_TOKEN, and keep POSTGRES_PASSWORD in sync with DATABASE_URL
kubectl apply -f k8s/secret.yaml
```

## 4. Apply everything else

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/ollama.yaml
kubectl apply -f k8s/agent.yaml
```

(`secret.yaml` from step 3 needs the namespace to already exist — that's why
namespace.yaml is applied here too, even though you technically could apply it
before the secret as well.)

Watch it come up:

```bash
kubectl get pods -n devops-agent -w
```

## 5. Pull the model

Same manual step as docker-compose — the ollama pod starts empty:

```bash
kubectl exec -it -n devops-agent deploy/ollama -- ollama pull qwen2.5-coder:7b
```

## 6. Reach the agent

```bash
minikube service agent -n devops-agent --url
```

Use the printed URL exactly like `http://localhost:3000` in the main README —
`curl <url>/health`, `curl <url>/dashboard`, `POST <url>/webhook/pipeline-failed`, etc.

## Useful commands while learning

```bash
kubectl get all -n devops-agent            # everything at a glance
kubectl describe pod <name> -n devops-agent # why is a pod pending/crashlooping?
kubectl logs -f deploy/agent -n devops-agent
kubectl exec -it -n devops-agent deploy/postgres -- psql -U postgres -d agent
minikube dashboard                          # the K8s web UI
```

## Tear down

```bash
kubectl delete namespace devops-agent   # deletes everything above except the local docker image and minikube itself
minikube stop                           # or `minikube delete` to remove the cluster entirely
```

## What's deliberately simple here (follow-up learning exercises)

- **Postgres is a Deployment + PVC, not a StatefulSet.** Works fine at one
  replica; a StatefulSet is the more idiomatic choice for stateful apps and
  worth converting to as a next step.
- **No Ingress.** NodePort + `minikube service` is enough for local access;
  an Ingress controller (nginx-ingress, on minikube via
  `minikube addons enable ingress`) is the next step toward something
  resembling a real cluster.
- **No resource requests/limits.** Worth adding once you're comfortable with
  the basics — `kubectl top pods` needs metrics-server
  (`minikube addons enable metrics-server`) to be useful here.
- **No HorizontalPodAutoscaler.** The agent is a single replica; scaling it
  wouldn't help anyway since Ollama (the actual bottleneck) is a single
  CPU-bound instance behind it.
- **Secrets are plain `Opaque` Kubernetes Secrets** (base64, not encrypted at
  rest by default) — fine for local learning, not how you'd handle real
  credentials in production (that's what tools like Sealed Secrets or an
  external secrets operator are for).
