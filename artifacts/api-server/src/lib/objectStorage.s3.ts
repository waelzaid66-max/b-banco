import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { ObjectAclPolicy, ObjectPermission } from "./objectAcl";
import { ObjectNotFoundError } from "./objectStorage";
import { logger } from "./logger";
import { readWithRetry } from "./mediaVerify";

/**
 * AWS S3 backend for object storage — the production-on-AWS counterpart to the
 * Replit/GCS `ObjectStorageService`. It implements the SAME caller-facing surface
 * (see objectStorageProvider.ts → interface ObjectStorage) so nothing above it
 * changes; selection is by `OBJECT_STORAGE_PROVIDER=s3`.
 *
 * Mapping GCS → S3:
 *  - One bucket: `S3_BUCKET`. `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS`
 *    become KEY PREFIXES within that bucket (leading/trailing slashes ignored).
 *  - The internal handle is `{ key }` (bucket is always S3_BUCKET) — opaque to
 *    callers, produced + consumed only inside this service.
 *  - ACL policy is stored as S3 object user-metadata `x-amz-meta-acl-policy`
 *    (JSON). S3 metadata is immutable, so updates are a self-CopyObject with
 *    MetadataDirective=REPLACE (content-type preserved).
 *  - Credentials come from the default AWS provider chain — an EC2/ECS IAM role
 *    in production (no static keys). Region from `AWS_REGION`.
 */

const ACL_METADATA_KEY = "acl-policy"; // becomes x-amz-meta-acl-policy

export interface S3ObjectRef {
  key: string;
}

function stripSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

export class S3ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const region = process.env.AWS_REGION;
    this.bucket = process.env.S3_BUCKET || "";
    if (!region || !this.bucket) {
      throw new Error(
        "OBJECT_STORAGE_PROVIDER=s3 requires AWS_REGION and S3_BUCKET to be set.",
      );
    }
    this.client = new S3Client({ region });
  }

  getPublicObjectSearchPaths(): string[] {
    const paths = Array.from(
      new Set(
        (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
          .split(",")
          .map((p) => stripSlashes(p.trim()))
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set it to comma-separated key prefixes within S3_BUCKET.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = stripSlashes(process.env.PRIVATE_OBJECT_DIR || "");
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set it to a key prefix within S3_BUCKET.",
      );
    }
    return dir;
  }

  private async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status === 404 || (err as { name?: string })?.name === "NotFound") {
        return false;
      }
      throw err;
    }
  }

  async searchPublicObject(filePath: string): Promise<S3ObjectRef | null> {
    for (const prefix of this.getPublicObjectSearchPaths()) {
      const key = `${prefix}/${stripSlashes(filePath)}`;
      if (await this.exists(key)) return { key };
    }
    return null;
  }

  async downloadObject(file: S3ObjectRef, cacheTtlSec = 3600): Promise<Response> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: file.key }),
    );
    const policy = await this.getAclPolicy(file);
    const isPublic = policy?.visibility === "public";

    const body = res.Body as Readable;
    const webStream = Readable.toWeb(body) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": res.ContentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (res.ContentLength != null) {
      headers["Content-Length"] = String(res.ContentLength);
    }
    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const key = `${this.getPrivateObjectDir()}/uploads/${randomUUID()}`;
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 900 },
    );
  }

  async getObjectEntityFile(objectPath: string): Promise<S3ObjectRef> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join("/");
    const key = `${this.getPrivateObjectDir()}/${entityId}`;
    if (!(await this.exists(key))) throw new ObjectNotFoundError();
    return { key };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    let pathname: string;
    try {
      // A presigned S3 URL (virtual-host or path-style). Non-URLs pass through.
      pathname = new URL(rawPath).pathname;
    } catch {
      return rawPath;
    }
    // Path-style URLs include the bucket as the first segment — drop it.
    let key = stripSlashes(pathname);
    if (key.startsWith(`${this.bucket}/`)) key = key.slice(this.bucket.length + 1);

    const prefix = `${this.getPrivateObjectDir()}/`;
    if (!key.startsWith(prefix)) return `/${key}`;
    return `/objects/${key.slice(prefix.length)}`;
  }

  private async getAclPolicy(ref: S3ObjectRef): Promise<ObjectAclPolicy | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: ref.key }),
      );
      const raw = head.Metadata?.[ACL_METADATA_KEY];
      return raw ? (JSON.parse(raw) as ObjectAclPolicy) : null;
    } catch {
      return null;
    }
  }

  private async setAclPolicy(ref: S3ObjectRef, policy: ObjectAclPolicy): Promise<void> {
    // S3 metadata is immutable → self-copy with REPLACE, preserving content-type.
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: ref.key }),
    );
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: ref.key,
        CopySource: `${this.bucket}/${ref.key}`,
        MetadataDirective: "REPLACE",
        ContentType: head.ContentType,
        Metadata: { [ACL_METADATA_KEY]: JSON.stringify(policy) },
      }),
    );
  }

  async promoteServingUrlToPublic(servingUrl: string, ownerId: string): Promise<void> {
    const wildcardPath = parseServingWildcard(servingUrl);
    if (!wildcardPath) return;
    try {
      const ref = await this.getObjectEntityFile(`/objects/${wildcardPath}`);
      const existing = await this.getAclPolicy(ref);
      if (existing && existing.owner !== ownerId) return;
      await this.setAclPolicy(ref, { owner: ownerId, visibility: "public" });
    } catch (err) {
      logger.warn({ err, wildcardPath, ownerId }, "promoteServingUrlToPublic(s3): failed to set ACL");
    }
  }

  async getServingObjectMetadata(
    servingUrl: string,
  ): Promise<{ contentType: string | null; size: number | null } | null> {
    const wildcardPath = parseServingWildcard(servingUrl);
    if (!wildcardPath) return null;
    return readWithRetry(
      async () => {
        const ref = await this.getObjectEntityFile(`/objects/${wildcardPath}`);
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: ref.key }),
        );
        return {
          contentType: head.ContentType ?? null,
          size: head.ContentLength != null ? Number(head.ContentLength) : null,
        };
      },
      { isPermanent: (err) => err instanceof ObjectNotFoundError },
    );
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/objects/")) return normalizedPath;
    const ref = await this.getObjectEntityFile(normalizedPath);
    await this.setAclPolicy(ref, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3ObjectRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const policy = await this.getAclPolicy(objectFile);
    if (!policy) return false;
    const permission = requestedPermission ?? ObjectPermission.READ;
    // Mirrors canAccessObject(): public reads are open; the owner has full
    // access. No access-group types are implemented (same as the GCS path).
    if (policy.visibility === "public" && permission === ObjectPermission.READ) {
      return true;
    }
    if (!userId) return false;
    return policy.owner === userId;
  }
}

/** Shared serving-URL parser: /api/v1/uploads/objects/<wildcard> → <wildcard>. */
function parseServingWildcard(servingUrl: string): string | null {
  try {
    const parsed = new URL(servingUrl);
    const PREFIX = "/api/v1/uploads/objects/";
    if (!parsed.pathname.startsWith(PREFIX)) return null;
    const w = parsed.pathname.slice(PREFIX.length);
    return w || null;
  } catch {
    return null;
  }
}
