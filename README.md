<!-- # LAB | Trivy Container Scanning in CI/CD -->

## Learning Objectives

- Integrate Trivy container scanning into a GitHub Actions pipeline
- Interpret Trivy scan output and distinguish actionable findings from noise
- Upload scan results as SARIF to the GitHub Security tab
- Configure severity thresholds that make pipeline failures meaningful

## What you will see

- A GitHub Actions pipeline that builds a Docker image and scans it with Trivy before pushing
- The scan output showing CVEs by severity, affected package, and available fix version
- Trivy findings appearing in the GitHub Security → Code scanning tab
- A pipeline that blocks a merge when Critical or High CVEs are present

## Prerequisites

- GitHub account (public repository — GHAS is free on public repos)
- Docker Desktop running locally
- Docker knowledge from weeks 4–5
- GitHub Actions experience from weeks 6–8
- `gh` CLI authenticated (`gh auth status`)

---

## Step 1 — Create a repository and set up the application

Create a public repository and clone it:

```bash
gh repo create trivy-lab --public --clone
cd trivy-lab
```

Create the application source file:

```bash
mkdir -p src
cat > src/index.js << 'EOF'
const express = require('express')
const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'trivy-lab' })
})

app.get('/health', (req, res) => {
  res.json({ healthy: true })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
EOF
```

Create `package.json`:

```bash
cat > package.json << 'EOF'
{
  "name": "trivy-lab",
  "version": "1.0.0",
  "description": "Sample app for Trivy scanning lab",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "express": "4.18.2"
  }
}
EOF
```

Create the `Dockerfile`. The base image is intentionally pinned to an older version to generate CVE findings:

```bash
cat > Dockerfile << 'EOF'
FROM node:18.12.0-alpine3.16

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/

USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
EOF
```

**Why `node:18.12.0-alpine3.16`?**

This is a pinned but older image. Real projects drift this way: the image tag was current at the time the Dockerfile was written and nobody updated it. Alpine 3.16 has accumulated several known CVEs in packages like `libssl3` and `busybox`. This is exactly the scenario Trivy is designed to catch.

Commit the initial files:

```bash
npm install          # generates package-lock.json, required for npm ci
git add .
git commit -m "chore: initial app with intentionally old base image"
git push -u origin main
```

---

## Step 2 — Scan locally with Trivy

Trivy runs as a Docker container — no installation needed since Docker is already running:

```bash
docker build -t lab-app:local .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
aquasec/trivy image lab-app:local
```

**What you should see (trimmed):**

> The CVE IDs below are illustrative. Your actual output will contain real CVE IDs for the packages in that image version. The structure and column layout will match exactly; the IDs will differ.

```
lab-app:local (alpine 3.16.9)

Total: 24 (UNKNOWN: 0, LOW: 5, MEDIUM: 11, HIGH: 6, CRITICAL: 2)

┌──────────────────┬─────────────────┬──────────┬───────────────────┬────────────────┐
│     Library      │  Vulnerability  │ Severity │ Installed Version │ Fixed Version  │
├──────────────────┼─────────────────┼──────────┼───────────────────┼────────────────┤
│ libssl3          │ CVE-2023-5678   │ CRITICAL │ 3.0.7-r2          │ 3.0.13-r0      │
│ libcrypto3       │ CVE-2023-5678   │ CRITICAL │ 3.0.7-r2          │ 3.0.13-r0      │
│ busybox          │ CVE-2022-28391  │ HIGH     │ 1.35.0-r17        │ 1.35.0-r29     │
└──────────────────┴─────────────────┴──────────┴───────────────────┴────────────────┘

Node.js (node-pkg)

Total: 3 (UNKNOWN: 0, LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 0)
...
```

**What this means:**

Two sections: OS packages (from Alpine) and Node.js packages (from `node_modules`). The Critical findings are in `libssl3` and `libcrypto3`, OpenSSL components that have available patches. The `Fixed Version` column tells you exactly which version resolves each CVE. In most cases, updating to a more recent base image (`node:18-alpine`) fixes all OS-level findings automatically.

---

## Step 3 — Understand severity filtering

Before adding Trivy to CI, decide what severity level blocks the build:

```bash
# Only show Critical and High
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image --severity CRITICAL,HIGH lab-app:local

# Exit with code 1 if any Critical or High found (would fail a CI step)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image --severity CRITICAL,HIGH --exit-code 1 lab-app:local
echo "Exit code: $?"
```

**What you should see:**

```
Exit code: 1
```

`exit-code 1` is what makes a CI step fail. Without it, Trivy only reports; it does not block.

---

## Step 4 — Add Trivy to the GitHub Actions pipeline

Create the workflow directory and the workflow file:

```bash
mkdir -p .github/workflows
cat > .github/workflows/container-scan.yml << 'EOF'
name: Build and Scan

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build-and-scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write   # required to upload SARIF to Security tab

    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t lab-app:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@0.35.0
        with:
          image-ref: lab-app:${{ github.sha }}
          format: sarif
          output: ${{ github.workspace }}/trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: '1'
          ignore-unfixed: true    # skip CVEs with no available fix

      - name: Upload Trivy results to GitHub Security
        if: always()             # upload even if the scan step failed
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: ${{ github.workspace }}/trivy-results.sarif
          category: trivy
EOF

git add .github/workflows/container-scan.yml
git commit -m "ci: add Trivy container scanning to build pipeline"
git push origin main
```

**What you should see:**

The Actions tab shows the workflow running. The build-and-scan job will fail because of the Critical findings in the base image. This is the expected result.

---

## Step 5 — Fix the findings and see the pipeline pass

Update the Dockerfile to use the current base image tag:

```bash
# macOS
sed -i '' 's|node:18.12.0-alpine3.16|node:18-alpine|' Dockerfile
# Linux / WSL
sed -i 's|node:18.12.0-alpine3.16|node:18-alpine|' Dockerfile

git add Dockerfile
git commit -m "fix: upgrade base image to node:18-alpine to resolve Trivy CRITICAL CVEs"
git push origin main
```

**What you should see:**

The workflow runs again. The Trivy step shows fewer findings (in most cases, zero Critical or High) and the job passes. The SARIF upload sends the clean results to the Security tab.

---

## Step 6 — View results in the GitHub Security tab

Navigate to your repository → Security → Code scanning.

> **If you do not see a Security tab:** Code scanning requires GitHub Advanced Security, which is free for public repositories. If the repository is private on a free plan, make it public for this lab.

**What you should see:**

A list of findings from both scans. The findings from before the fix show state "Fixed" with the commit where they were resolved. Each finding shows:
- The CVE identifier and description
- The affected package and version
- The severity
- The commit where it was first seen and where it was resolved

This is the view your security team uses to track vulnerability remediation across the codebase.

---

## Bonus — Add Trivy IaC scanning

Trivy can also scan Kubernetes manifests for misconfigurations. Create a minimal manifest and scan it:

```bash
mkdir -p k8s
cat > k8s/deployment.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lab-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lab-app
  template:
    metadata:
      labels:
        app: lab-app
    spec:
      containers:
        - name: lab-app
          image: lab-app:latest
          ports:
            - containerPort: 3000
EOF

docker run --rm -v "$(pwd)":/project aquasec/trivy config /project/k8s/
```

**What you should see:**

```
k8s/deployment.yaml (kubernetes)

Tests: 15 (SUCCESSES: 9, FAILURES: 6, EXCEPTIONS: 0)
Failures: 6 (UNKNOWN: 0, LOW: 1, MEDIUM: 3, HIGH: 2, CRITICAL: 0)

HIGH: Container 'lab-app' of Deployment 'lab-app' should set 'resources.limits.cpu'
HIGH: Container 'lab-app' of Deployment 'lab-app' should set 'resources.limits.memory'
MEDIUM: Container 'lab-app' of Deployment 'lab-app' should set 'securityContext.readOnlyRootFilesystem'
MEDIUM: Container 'lab-app' of Deployment 'lab-app' should set 'securityContext.runAsNonRoot'
...
```

These are real misconfigurations you will recognise from weeks 12–13. The Trivy IaC check catches them before `kubectl apply`. Same shift-left principle, same tool, applied to Kubernetes configuration.

---

## Cleanup

```bash
gh repo delete trivy-lab --yes
cd ..
rm -rf trivy-lab
```

---

## Key takeaways

| Idea | What to remember |
|---|---|
| `exit-code: '1'` is the gate | Without it, Trivy reports but does not fail the pipeline. The gate is your intent made concrete. |
| `ignore-unfixed: true` reduces noise | CVEs with no available fix cannot be patched. Failing a build for them is noise. Fail only on fixable CVEs. |
| Upload SARIF with `if: always()` | You want results uploaded even when the scan step fails; otherwise you cannot see *why* it failed in the Security tab. |
| OS-level CVEs are usually fixed by a base image update | Most Critical findings in Alpine or Debian images are patched in a newer tag. Pin to a digest but update the tag regularly. |
| Trivy scans IaC too | `trivy config ./k8s/` catches Kubernetes misconfigurations before they reach the cluster. Same tool, same pipeline. |
