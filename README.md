# Khabar Check (খাবার চেক)

AI food-label scanner for Bangladesh. NSU Public Health 101 project.

**Two ways to use it (same backend):**
- 🌐 **Web app (PWA)** — open the link on any phone, take a photo of the label, get a Bangla result. Installable like an app. **Works without Twilio.**
- 💬 **WhatsApp bot** — optional; turns on automatically when Twilio keys are set.

## Deploy online (no installing anything) — GitHub + Render

1. Upload this folder's contents to a **private GitHub repo** (drag the `src`, `public`, `tests`, `scripts` folders too). Never upload a `.env` file.
2. MongoDB Atlas → Network Access → add `0.0.0.0/0`.
3. render.com → sign in with GitHub → **New → Web Service** → pick the repo.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance: **Free**
4. **Environment Variables** (minimum for the web app):

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.8-flash` (check the current name in AI Studio) |
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.../khabar_check?...` |
| `NODE_ENV` | `production` |

5. Create → wait ~5 min → open `https://<your-app>.onrender.com` → the web app opens.
6. On Android Chrome: menu ⋮ → **Add to Home screen** (or tap "অ্যাপ ইনস্টল").

**Free plan sleeps** after ~15 min idle; open `/health` 5 minutes before a demo to wake it.

### Turn on WhatsApp later (optional)
Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `PUBLIC_BASE_URL` (your Render URL), `RATE_LIMIT_HASH_SECRET` (long random text). All five are needed; otherwise the webhook stays off. Then set the Twilio sandbox "When a message comes in" to `<Render URL>/webhook` (POST).

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in real keys
npm test                  # 60 tests, no internet needed
npm run dev
```

Generate the hash secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Before demo day — MUST DO
- [ ] Replace placeholder thresholds in `src/config/rules.json` with WHO SEARO values (currently UK FSA placeholders)
- [ ] Confirm Bangla wording "এত" vs "এতে" in `src/services/explain.js`
- [ ] Decide messages for RED fat / RED sugar outside tiffin mode (currently shows the AMBER message)
- [ ] Check `GEMINI_MODEL` still exists in Google AI Studio

## Connect WhatsApp (local, with ngrok)
1. MongoDB Atlas → Network Access → add your IP.
2. `npm run dev` → open `http://localhost:3000/health` → `{"status":"ok"}`.
3. `ngrok http 3000` → copy the https URL.
4. Put it in `.env` as `PUBLIC_BASE_URL` (no trailing slash) → restart.
5. Twilio Console → Messaging → Try it out → WhatsApp sandbox → "When a message comes in" = `<ngrok-url>/webhook`, POST.
6. From your phone send `join <code>` to the sandbox number.
7. Test: text "hi" → photo request · selfie → "পুষ্টি-তালিকা খুঁজে পাইনি" · clear chips label → red salt message.
8. `curl -X POST <ngrok-url>/webhook` must return **403**.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Every Twilio call is 403 | `PUBLIC_BASE_URL` must exactly match the URL in the Twilio console |
| Worked yesterday, 403 today | Free ngrok URL changed — update `.env` and Twilio |
| No reply at all | Check logs; re-send `join <code>` (sandbox expires ~3 days) |
| Always "এখন সমস্যা হচ্ছে" | Wrong `GEMINI_API_KEY` or retired `GEMINI_MODEL` |
| Media download 401 | Wrong Twilio SID/token |
| Replies stop after many tests | Per-sender limit (20 / 15 min) |

## Test Gemini without WhatsApp
```bash
node scripts/testGemini.js ./samples/chips.jpg
```
Run it on 30–50 snack photos to get your **accuracy %** for the presentation. Watch for `GEMINI_FAILED` (usually 429 rate limit); check limits in Google AI Studio → Rate limits.

## Security & privacy summary
- Twilio signature validation on every webhook (forged → 403)
- Per-sender rate limit (HMAC hash in memory only); IP limit on all other routes
- Images never touch disk; EXIF/GPS stripped; resized ≤1024 px; 5 MB + 40 MP caps
- SSRF guard: only `https://api.twilio.com` media URLs downloaded
- Gemini output schema-forced, then re-validated; image text treated as data only
- Colours decided by fixed rules, never by AI; swaps limited to an approved list
- MongoDB schema `strict: 'throw'` — phone, name, IP or image fields are rejected
- Logs contain error codes only, never phone numbers or content

## Project structure
```
src/
  app.js, server.js
  config/rules.json          thresholds (edit here)
  models/Scan.js             anonymous scan schema
  middleware/                verifyTwilio, senderRateLimit
  routes/webhook.js          WhatsApp (optional)
  routes/scan.js             web app API: POST /api/scan
  services/                  imageService, geminiClient, extractNutrients,
                             nutritionMath, ruleEngine, explain, pipeline,
                             errorMessages, scanRepository, twilioService
tests/                       nutritionMath, pipeline, security, web (60 tests)
public/                      web app: index.html, app.js, styles.css, manifest.json, sw.js, icons/
scripts/testGemini.js
```
