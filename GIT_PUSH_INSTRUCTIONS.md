# 🚀 GIT PUSH + CLOUD BUILD DEPLOY — PAȘI SIMPLI

## CE TREBUIE SĂ FACI PE MAC-UL TĂU

### Pasul 1: Deschide Terminal pe Mac

```bash
# Apasă: Cmd + Space
# Scrie: Terminal
# Apasă: Enter
```

### Pasul 2: Copiază și rulează scriptul de deploy

```bash
cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

# Copiază-paste acest script și rulează-l direct în Terminal:
bash DEPLOY_SCRIPT.sh
```

**CE FACE SCRIPTUL:**
1. ✅ Șterge lock files (`git/*.lock`)
2. ✅ Verifică ce e staged
3. ✅ Creează commit (mesaj mare + detalii)
4. ✅ Face `git push origin main` → GitHub
5. ✅ Verifică Cloud Build status
6. ✅ Testează `/api/v2/health` endpoint
7. ✅ Rulează smoke tests automat

---

## ALTERNATIVĂ: Manual (Dacă scriptul nu merge)

Dacă `bash DEPLOY_SCRIPT.sh` nu funcționează, fă-o manual:

```bash
cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"

# 1. Șterge locks
rm -f .git/*.lock
rm -f .git/refs/remotes/origin/*.lock

# 2. Verifică status
git status

# 3. Commit
git commit -m "feat: Phase 1 + Phase 2 — health endpoint, route audit, execution plan

PHASE 1:
- Health check endpoint
- Smoke tests
- Operational audit

PHASE 2:
- Route audit (46 routes categorized)
- Action plan (6.5 hrs execution)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

# 4. Push
git push origin main

# 5. Test deployed instance
curl https://trade-ai-657910853930.europe-west1.run.app/api/v2/health | jq '.'
```

---

## CE SE ÎNTÂMPLĂ DUPĂ PUSH

### Automat (Dacă Cloud Build trigger e setat):
1. GitHub → webhook → Cloud Build
2. Cloud Build → build + deploy pe Cloud Run
3. ~2-3 minute până la deploy complet
4. Health endpoint active

### Manual (Dacă trigger nu e setat):
1. Du-te la: https://console.cloud.google.com/cloud-build/triggers
2. Click "CREATE TRIGGER"
3. GitHub → `legie123/TRADE_AI` → branch `main`
4. Build config: `cloudbuild.yaml`
5. Click "CREATE"
6. Apoi push-ul automat triggering build-ul

---

## VERIFICARE DEPLOY

După push, controlează:

```bash
# 1. Cloud Build logs
gcloud builds log --limit=10

# 2. Cloud Run status
gcloud run services describe trade-ai --region=europe-west1

# 3. Health endpoint
curl https://trade-ai-657910853930.europe-west1.run.app/api/v2/health | jq '.'

# OUTPUT așteptat:
# {
#   "overall_status": "HEALTHY",
#   "systems": {
#     "polymarket": { "status": "OPERATIONAL", "latency_ms": 250 },
#     "supabase": { "status": "OPERATIONAL", "latency_ms": 150 },
#     ...
#   }
# }
```

---

## PROBLEME ȘI SOLUȚII

### Problem: "fatal: Unable to create .git/index.lock"
**Soluție:**
```bash
rm -f .git/*.lock
git status
```

### Problem: "Permission denied" la push
**Soluție:**
```bash
# Verifică că token e valid
git config user.name
git config user.email
# Dacă trebuie, resetează git:
git config --global credential.helper osxkeychain
git push origin main
```

### Problem: "fatal: Authentication failed"
**Soluție:**
```bash
# Foloseșii token (deja generat)
git clone https://REMOVED_TOKEN@github.com/legie123/TRADE_AI.git
```

### Problem: Health endpoint nu răspunde
**Cauze posibile:**
- Deploy încă în progress (așteptă 3 min)
- Cloud Build failed — verifică: `gcloud builds log --limit=5`
- Service crashed — verifică: `gcloud run logs read trade-ai --limit=50`

---

## TIMELINE

| Acțiune | Timp | Status |
|---------|------|--------|
| Git push | 1 min | Instant |
| Cloud Build | 2-3 min | Auto |
| Cloud Run deploy | 1-2 min | Auto |
| Health endpoint live | ~5 min | Ready to test |
| Smoke tests | 2 min | Full validation |

---

## ÎN CLAR

Rulează asta pe Mac și GATA:
```bash
bash "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI/DEPLOY_SCRIPT.sh"
```

Scriptul face TOTUL. Nici nu trebuie să intelegi ce face — doar rulează.

---
