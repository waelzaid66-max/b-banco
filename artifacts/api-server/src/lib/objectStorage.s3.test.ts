import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AWS SDK so the unit test verifies OUR logic (path mapping, ACL
// evaluation, presign invocation, self-copy-on-ACL) without hitting real S3.
const send = vi.fn();
const getSignedUrl = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = send;
  }
  // Commands just capture their input for assertions.
  class HeadObjectCommand {
    constructor(public input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class CopyObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, CopyObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));

import { S3ObjectStorageService } from "./objectStorage.s3";
import { ObjectPermission } from "./objectAcl";
import { ObjectNotFoundError } from "./objectStorage";

function svc() {
  process.env.AWS_REGION = "eu-central-1";
  process.env.S3_BUCKET = "banco-media";
  process.env.PRIVATE_OBJECT_DIR = "/private";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/public";
  return new S3ObjectStorageService();
}

describe("S3ObjectStorageService", () => {
  beforeEach(() => {
    send.mockReset();
    getSignedUrl.mockReset();
  });

  it("requires AWS_REGION + S3_BUCKET", () => {
    delete process.env.AWS_REGION;
    process.env.S3_BUCKET = "";
    expect(() => new S3ObjectStorageService()).toThrow(/AWS_REGION and S3_BUCKET/);
  });

  it("presigns an upload URL under the private uploads prefix", async () => {
    getSignedUrl.mockResolvedValue("https://s3.example/presigned-put");
    const url = await svc().getObjectEntityUploadURL();
    expect(url).toBe("https://s3.example/presigned-put");
    // The command it signed targets banco-media/private/uploads/<uuid>.
    const cmd = getSignedUrl.mock.calls[0][1] as { input: { Bucket: string; Key: string } };
    expect(cmd.input.Bucket).toBe("banco-media");
    expect(cmd.input.Key).toMatch(/^private\/uploads\/[0-9a-f-]{36}$/);
  });

  it("normalizes a presigned S3 URL to the internal /objects/ path", () => {
    const s = svc();
    const raw =
      "https://banco-media.s3.eu-central-1.amazonaws.com/private/uploads/abc123?X-Amz-Signature=x";
    expect(s.normalizeObjectEntityPath(raw)).toBe("/objects/uploads/abc123");
    // Path-style URL (bucket as first segment) maps identically.
    const pathStyle =
      "https://s3.eu-central-1.amazonaws.com/banco-media/private/uploads/abc123?x=1";
    expect(s.normalizeObjectEntityPath(pathStyle)).toBe("/objects/uploads/abc123");
    // A non-URL passes through untouched.
    expect(s.normalizeObjectEntityPath("/objects/uploads/abc123")).toBe(
      "/objects/uploads/abc123",
    );
  });

  it("getObjectEntityFile throws ObjectNotFoundError when the key is missing", async () => {
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(svc().getObjectEntityFile("/objects/uploads/missing")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it("canAccessObjectEntity: public read allowed; private only for the owner", async () => {
    const s = svc();
    // Public policy → any reader.
    send.mockResolvedValueOnce({ Metadata: { "acl-policy": JSON.stringify({ owner: "u1", visibility: "public" }) } });
    expect(
      await s.canAccessObjectEntity({ objectFile: { key: "k" }, requestedPermission: ObjectPermission.READ }),
    ).toBe(true);
    // Private policy → non-owner denied.
    send.mockResolvedValueOnce({ Metadata: { "acl-policy": JSON.stringify({ owner: "u1", visibility: "private" }) } });
    expect(
      await s.canAccessObjectEntity({ userId: "u2", objectFile: { key: "k" }, requestedPermission: ObjectPermission.READ }),
    ).toBe(false);
    // Private policy → owner allowed.
    send.mockResolvedValueOnce({ Metadata: { "acl-policy": JSON.stringify({ owner: "u1", visibility: "private" }) } });
    expect(
      await s.canAccessObjectEntity({ userId: "u1", objectFile: { key: "k" }, requestedPermission: ObjectPermission.READ }),
    ).toBe(true);
  });

  it("promoteServingUrlToPublic self-copies with a public ACL (owner match)", async () => {
    const s = svc();
    send
      .mockResolvedValueOnce({}) // HeadObject (getObjectEntityFile existence)
      .mockResolvedValueOnce({ Metadata: {} }) // getAclPolicy → no existing policy
      .mockResolvedValueOnce({ ContentType: "image/jpeg" }) // HeadObject in setAclPolicy
      .mockResolvedValueOnce({}); // CopyObject
    await s.promoteServingUrlToPublic(
      "https://banco.example/api/v1/uploads/objects/uploads/xyz",
      "owner-1",
    );
    const copy = send.mock.calls[3][0] as { input: { Metadata: Record<string, string>; MetadataDirective: string } };
    expect(copy.input.MetadataDirective).toBe("REPLACE");
    expect(JSON.parse(copy.input.Metadata["acl-policy"])).toEqual({
      owner: "owner-1",
      visibility: "public",
    });
  });

  it("promoteServingUrlToPublic no-ops for a non-first-party URL", async () => {
    await svc().promoteServingUrlToPublic("https://cdn.other.com/x.jpg", "owner-1");
    expect(send).not.toHaveBeenCalled();
  });
});
