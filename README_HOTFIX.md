# Verum Omnis — Repo Hotfix Pack

This modifies your existing repo (no new scaffold). It adds:
- `.github/workflows/android.yml` → Cloud APK/AAB build (GitHub Actions)
- `src/services/forensicSeal.ts` → Sealed PDF helper (top logo, bottom-left tick, QR + SHA-512)
- `src/services/assets.ts` → Small asset helpers
- `src/hooks/useJurisdiction.ts` → Geolocation → Jurisdiction mapping (no dropdown)
- `src/components/HeaderLogo.tsx` → Minimal header logo component

## Apply (Termux)
```bash
# from your repo root (the one with package.json)
cp ~/storage/downloads/repo_hotfix_pack.zip .    # or move the file here
unzip -o repo_hotfix_pack.zip

git add -A
git commit -m "hotfix: actions + sealed PDF + geolocation jurisdiction + header logo"

# Push and run cloud build
git push -u origin main
```

## Wire into your app
- Use sealed PDF:
  ```ts
  import { generateSealedPdf } from './src/services/forensicSeal';
  ```
- Use geolocation jurisdiction at startup:
  ```ts
  import { getJurisdictionFromGeolocation } from './src/hooks/useJurisdiction';
  const J = await getJurisdictionFromGeolocation();
  ```
- Header logo:
  ```tsx
  import HeaderLogo from './src/components/HeaderLogo';
  ```

## Notes
- Put your **VO PNG** at: `public/vo-logo.png`. If missing, the PDF falls back to text.
- The Android CI expects `android/` for the app and `www/` for the built web. Adjust paths if your repo differs.
