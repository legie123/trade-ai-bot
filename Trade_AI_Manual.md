# Blueprint & Manual de Utilizare: TRADE AI (Phoenix V2 — GTC)

## 1. Prezentare Generală
Acest document reprezintă schema arhitecturală (blueprint) și manualul complet de operare a proiectului **TRADE AI**, evoluat în versiunea **Phoenix V2**. Sistemul funcționează după principiile **GTC (Grounded-Technical-Compliant)**, asigurând autonomie totală, reziliență prin fallback și securitate prin Sentinele.

---

## 2. Arhitectura Phoenix V2: Ierarhia Puterii

Sistemul este structurat pe patru niveluri de competență și siguranță:

### 2.1. Sindicatul Maeștrilor (Oracolele V2) — `syndicate.ts`
Nucleul decizional bazat pe un consens de 70%.
- **Maestru Principal**: Gemini 2.0 Pro (Google).
- **Elite Fallback**: Claude 3.5 Sonnet (Anthropic via OpenRouter) — preia automat dacă Gemini eșuează.
- **Maeștri Specializați**: DeepSeek-R1 (Matematică), Llama 3.1 (Audit), Qwen 2.5 (Pattern).
- **Combat Audit**: Toate raționamentele Maeștrilor sunt salvate în Supabase pentru transparență totală.

### 2.2. Manager Vizionar — `managerVizionar.ts`
Gatekeeper-ul tehnic. Nu permite nicio execuție fără biletul de ordine (Consensus) de la Sindicat și fără aprobarea finală de la Sentinele.

### 2.3. Alpha Scouts (Ochii Sistemului) — `alphaScout.ts`
Redefiniți pentru **Compliance**. Aceștia colectează exclusiv date publice (OSINT):
- Feed-uri de preț în timp real.
- Sentiment public de pe rețelele sociale.
- Știri financiare licențiate.
- *Zero MNPI Policy*: Sistemul nu procesează informații private/neautorizate.

### 2.4. 🛡️ Sentinel Plane & Kill Switch — `sentinelGuard.ts`
Scutul protector (The Shield). Monitorizează constant:
- **Max Drawdown (MDD)**: Dacă pierderea depășește 15%, activează **Kill Switch**.
- **Daily Loss Limit**: Max 5 pierderi pe zi.
- **Emergency Exit**: Închide instant toate ordinele și vinde activele în USDT în caz de breșă de risc.

---

## 3. Sistemul de Audit și Învățare
Fiecare decizie a Maeștrilor este stocată în `syndicate_audit`. Acest "jurnal de luptă" permite utilizatorului să vadă exact *de ce* DeepSeek sau Claude au votat într-un anumit fel, transformând algoritmul dintr-o "cutie neagră" într-un sistem transparent.

---

## 4. Administrare și Lansare (Deploy)
Platforma rulează pe **Google Cloud Antigravity (Cloud Run)**.
- **Deploy Rapid**: `gcloud run deploy trade-ai --source .`
- **Audit Logs**: `gcloud run services logs read trade-ai`

---
> [!IMPORTANT]
> **Phoenix V2** nu este doar un bot de trading; este un sindicat de inteligențe artificiale care se verifică reciproc sub supravegherea unei Sentinele neînduplecate.
