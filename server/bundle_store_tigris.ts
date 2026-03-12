import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AgentMetadata } from "./worker_pool.ts";
import { AgentMetadataSchema } from "./_schemas.ts";
import { type CredentialKey, decryptEnv, encryptEnv } from "./credentials.ts";

export type FileKey = "worker" | "client" | "client_map";

export type NamespaceOwner = {
  account_id: string;
  credential_hashes: string[];
};

export type BundleStore = {
  putAgent(bundle: {
    slug: string;
    env: Record<string, string>;
    transport: ("websocket" | "twilio")[];
    worker: string;
    client: string;
    client_map?: string;
    account_id?: string;
  }): Promise<void>;
  getManifest(slug: string): Promise<AgentMetadata | null>;
  getFile(slug: string, file: FileKey): Promise<string | null>;
  deleteAgent(slug: string): Promise<void>;
  getNamespaceOwner(namespace: string): Promise<NamespaceOwner | null>;
  putNamespaceOwner(
    namespace: string,
    owner: NamespaceOwner,
  ): Promise<void>;
  /** Atomically claim a namespace only if unclaimed. Returns true if claimed, false if already owned. */
  claimIfUnclaimed(
    namespace: string,
    owner: NamespaceOwner,
  ): Promise<boolean>;
  close(): void;
  [Symbol.dispose](): void;
};

type CacheEntry = {
  data: string;
  etag: string;
};

const FILE_NAMES: Record<FileKey, string> = {
  worker: "worker.js",
  client: "client.js",
  client_map: "client.js.map",
};

function objectKey(slug: string, file: string): string {
  return `agents/${slug}/${file}`;
}

export function createS3Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: Deno.env.get("AWS_ENDPOINT_URL_S3"),
    credentials: {
      accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "",
    },
  });
}

function isS3Error(err: unknown, codeOrStatus: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e.name === codeOrStatus ||
    e.Code === codeOrStatus ||
    String(
        e.$metadata && (e.$metadata as Record<string, unknown>).httpStatusCode,
      ) === codeOrStatus
  );
}

export function createBundleStore(
  s3: S3Client,
  bucket: string,
  credentialKey?: CredentialKey,
): BundleStore {
  const cache = new Map<string, CacheEntry>();

  async function put(
    key: string,
    body: string,
    contentType: string,
  ): Promise<void> {
    const result = await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    if (result.ETag) {
      cache.set(key, { data: body, etag: result.ETag });
    }
  }

  async function get(key: string): Promise<string | null> {
    const cached = cache.get(key);

    try {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(cached ? { IfNoneMatch: cached.etag } : {}),
        }),
      );

      const data = await result.Body!.transformToString();
      if (result.ETag) {
        cache.set(key, { data, etag: result.ETag });
      }
      return data;
    } catch (err: unknown) {
      if (isS3Error(err, "304") || isS3Error(err, "NotModified")) {
        return cached!.data;
      }
      if (isS3Error(err, "NoSuchKey") || isS3Error(err, "404")) {
        return null;
      }
      throw err;
    }
  }

  async function deleteAgent(slug: string): Promise<void> {
    const prefix = `agents/${slug}/`;
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      }),
    );

    const objects = listed.Contents;
    if (!objects || objects.length === 0) return;

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key })),
        },
      }),
    );

    for (const o of objects) {
      if (o.Key) cache.delete(o.Key);
    }
  }

  return {
    async putAgent(bundle) {
      await deleteAgent(bundle.slug);

      const envValue = credentialKey
        ? await encryptEnv(credentialKey, bundle.env)
        : bundle.env;

      const manifest = {
        slug: bundle.slug,
        env: envValue,
        transport: bundle.transport,
        ...(bundle.account_id ? { account_id: bundle.account_id } : {}),
        ...(credentialKey ? { envEncrypted: true } : {}),
      };
      await put(
        objectKey(bundle.slug, "manifest.json"),
        JSON.stringify(manifest),
        "application/json",
      );

      await put(
        objectKey(bundle.slug, "worker.js"),
        bundle.worker,
        "application/javascript",
      );

      await put(
        objectKey(bundle.slug, "client.js"),
        bundle.client,
        "application/javascript",
      );

      if (bundle.client_map) {
        await put(
          objectKey(bundle.slug, "client.js.map"),
          bundle.client_map,
          "application/json",
        );
      }
    },

    async getManifest(slug) {
      const data = await get(objectKey(slug, "manifest.json"));
      if (data === null) return null;
      const raw = JSON.parse(data);

      // Decrypt env if it was stored encrypted
      if (raw.envEncrypted && credentialKey && typeof raw.env === "string") {
        raw.env = await decryptEnv(credentialKey, raw.env);
        delete raw.envEncrypted;
      }

      const parsed = AgentMetadataSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data as AgentMetadata;
    },

    async getFile(slug, file) {
      const fileName = FILE_NAMES[file];
      return await get(objectKey(slug, fileName));
    },

    deleteAgent,

    async getNamespaceOwner(namespace: string): Promise<NamespaceOwner | null> {
      const data = await get(`namespaces/${namespace}/owner.json`);
      if (!data) return null;
      try {
        const parsed = JSON.parse(data);
        // Migrate legacy format: { owner_hash } → { account_id, credential_hashes }
        if (parsed.owner_hash && !parsed.account_id) {
          return {
            account_id: parsed.owner_hash,
            credential_hashes: [parsed.owner_hash],
          };
        }
        if (!parsed.account_id || !Array.isArray(parsed.credential_hashes)) {
          return null;
        }
        return parsed as NamespaceOwner;
      } catch {
        return null;
      }
    },

    async putNamespaceOwner(
      namespace: string,
      owner: NamespaceOwner,
    ): Promise<void> {
      await put(
        `namespaces/${namespace}/owner.json`,
        JSON.stringify(owner),
        "application/json",
      );
    },

    async claimIfUnclaimed(
      namespace: string,
      owner: NamespaceOwner,
    ): Promise<boolean> {
      const key = `namespaces/${namespace}/owner.json`;
      const body = JSON.stringify(owner);
      try {
        const result = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: "application/json",
            IfNoneMatch: "*",
          }),
        );
        if (result.ETag) {
          cache.set(key, { data: body, etag: result.ETag });
        }
        return true;
      } catch (err: unknown) {
        if (isS3Error(err, "PreconditionFailed") || isS3Error(err, "412")) {
          return false;
        }
        throw err;
      }
    },

    close() {
      // S3 client has no close
    },

    [Symbol.dispose]() {
      // no-op
    },
  };
}
