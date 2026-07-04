# Upload Audit (RC)

Pipeline: Replit Object Storage via presigned URLs (`lib/objectStorage`), with byte‑path verification (`lib/mediaVerify`, `MEDIA_VERIFY_RETRYABLE`).

| Upload type | Pick | Preview | Upload | Retry | Progress | Verify | Persist | Render | Delete/Replace |
|---|---|---|---|---|---|---|---|---|---|
| Avatar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cover | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Listing images | ✅ | ✅ | ✅ | ✅ (retryable classes) | ✅ | ✅ (byte‑path) | ✅ | ✅ | ✅ |
| Business / KYC docs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chat images | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Code‑verified behaviours
- Media is only attached after a successful verified write; a photo‑less buyer **request** skips the media insert instead of crashing (guarded `.values([])`).
- Publish never blocks on media ACL promotion (best‑effort, post‑commit).

## Needs on‑device QA (📱, cannot certify from repo)
- Real byte upload against production Object Storage credentials.
- Camera vs library permission prompts on Android/iOS.
- Slow‑network retry + progress UX on a physical device.
- Offline recovery (queue/resume) behaviour.
