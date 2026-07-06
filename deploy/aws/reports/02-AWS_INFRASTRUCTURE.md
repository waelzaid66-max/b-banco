# 02 — AWS Infrastructure Report

## Recommended strategy (safest + lowest cost for this repo)

**Single EC2 host running Docker Compose (API + Nginx), backed by managed RDS +
S3.** This is the cheapest topology that is still production-safe (managed DB
backups, IAM-scoped storage, health-gated deploys). It scales up to ECS/Fargate
+ ALB later **without any code change** — the same containers.

```
                 Route 53  (DNS)
                    │
              CloudFront (optional, CDN + TLS)  ──┐   ACM cert
                    │                              │
                 EC2 (t4g.small, ARM)  ── Nginx :80/443
                    ├── /            landing (static)
                    ├── /market/     dealer-os (static)
                    ├── /admin/      admin-os (static)
                    └── /api/  ─────► API container :8080  ──► RDS PostgreSQL 16
                                             │                    (pg_trgm)
                                             └──► S3  (media: uploads, images, video)
                    logs ─────────────────────────────────► CloudWatch Logs
```

## Resources actually required by this project

| Resource | Needed? | Why / sizing (lowest cost) |
|---|---|---|
| **EC2** | ✅ | 1× `t4g.small` (ARM, 2 vCPU/2 GB) runs API + Nginx. `t4g.micro` for staging. |
| **RDS PostgreSQL 16** | ✅ | `db.t4g.micro`, 20 GB gp3, single-AZ to start. **Enable `pg_trgm`.** Automated backups + PITR = the reason to use RDS over a DB container. |
| **S3** | ✅ | 1 bucket for media (uploads/images/video). Replaces the Replit object store. Block public access; serve via presigned URLs / CloudFront. |
| **IAM role (instance profile)** | ✅ | EC2 role granting S3 (scoped to the bucket) + SSM (read params, receive deploy commands) + CloudWatch Logs. **No static AWS keys.** |
| **SSM Parameter Store** | ✅ | Store all secrets (`/banco/prod/*`, SecureString). Free tier covers standard params. Cheaper than Secrets Manager. |
| **CloudWatch Logs** | ✅ | Container logs via the compose `awslogs` driver (`/banco/api`, `/banco/web`) + host metrics via the CW agent. |
| **Security Groups** | ✅ | SG-web: 80/443 from anywhere; SG-app: 8080 only from SG-web; SG-db: 5432 only from SG-app. |
| **VPC** | ✅ (default OK to start) | Public subnet for EC2, private subnet for RDS. Default VPC is acceptable for launch. |
| **ACM** | ✅ | Free TLS cert (with ALB/CloudFront). Without them (EC2-only), use certbot/Let's Encrypt on Nginx. |
| **Route 53** | ✅ | DNS + records for `banco.` / `api.`. |
| **ECR** | ✅ (if using CD) | Private registry for the `banco-api` / `banco-web` images. |
| **ALB + Auto Scaling** | ⏭️ later | Not needed at launch. Add when one box isn't enough — same containers, no code change. |
| **CloudFront** | ⏭️ recommended | CDN for static + media; also gives managed TLS. Optional at launch. |
| **SES** | ⏭️ optional | Only if you move email off Resend. Not required (Resend is wired). |
| **SQS / SNS / EventBridge** | ❌ | **Not needed** — jobs are in-process cron + Postgres advisory locks. |
| **ElastiCache / Redis** | ❌ | Not used (rate limiting + locks are in Postgres/in-memory). |

## Rough monthly cost (eu-central-1, launch scale, USD, on-demand)

| Item | Est. |
|---|---|
| EC2 `t4g.small` | ~$12 |
| RDS `db.t4g.micro` 20 GB gp3 | ~$13 |
| S3 (few GB + requests) | ~$1–3 |
| CloudWatch (logs/metrics, modest) | ~$3–5 |
| Route 53 hosted zone | ~$0.50 |
| Data transfer (light) | ~$2–5 |
| **≈ total** | **~$35–40 / month** |

Reserved/Savings Plans on EC2+RDS cut ~30–40% once traffic is steady. CloudFront
adds cost but offloads bandwidth. Fargate/ALB would roughly double the base.

## Scale-up path (no code change)

1. Put the API container on **ECS Fargate** behind an **ALB** (health check `/api/readyz`); run ≥2 tasks. Cron stays correct — advisory locks already guard multi-instance.
2. Move static + media to **CloudFront + S3**.
3. RDS → Multi-AZ + a read replica if read volume grows.
