import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AgentMetadata } from "./worker_pool.ts";
import { AgentMetadataSchema } from "../core/_rpc_schema.ts";

export type FileKey = "worker" | "client" | "client_map";

export type BundleStore = {
  putAgent(bundle: {
    slug: string;
    env: Record<string, string>;
    transport: ("websocket" | "twilio")[];
    worker: string;
    client: string;
    client_map?: string;
    owner_hash?: string;
    config?: {
      name?: string;
      instructions: string;
      greeting: string;
      voice: string;
      prompt?: string;
      builtinTools?: string[];
    };
    toolSchemas?: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
  }): Promise<void>;
  getManifest(slug: string): Promise<AgentMetadata | null>;
  getFile(slug: string, file: FileKey): Promise<string | null>;
  deleteAgent(slug: string): Promise<void>;
  getNamespaceOwner(namespace: string): Promise<string | null>;
  putNamespaceOwner(namespace: string, ownerHash: string): Promise<void>;
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

      const manifest = {
        slug: bundle.slug,
        env: bundle.env,
        transport: bundle.transport,
        ...(bundle.owner_hash ? { owner_hash: bundle.owner_hash } : {}),
        ...(bundle.config ? { config: bundle.config } : {}),
        ...(bundle.toolSchemas ? { toolSchemas: bundle.toolSchemas } : {}),
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
      const parsed = AgentMetadataSchema.safeParse(JSON.parse(data));
      if (!parsed.success) return null;
      return parsed.data as AgentMetadata;
    },

    async getFile(slug, file) {
      const fileName = FILE_NAMES[file];
      return await get(objectKey(slug, fileName));
    },

    deleteAgent,

    async getNamespaceOwner(namespace: string): Promise<string | null> {
      const data = await get(`namespaces/${namespace}/owner.json`);
      if (!data) return null;
      try {
        const parsed = JSON.parse(data);
        return parsed.owner_hash ?? null;
      } catch {
        return null;
      }
    },

    async putNamespaceOwner(
      namespace: string,
      ownerHash: string,
    ): Promise<void> {
      await put(
        `namespaces/${namespace}/owner.json`,
        JSON.stringify({ owner_hash: ownerHash }),
        "application/json",
      );
    },

    close() {
      // S3 client has no close
    },

    [Symbol.dispose]() {
      // no-op
    },
  };
}

export function createMemoryS3Client(): S3Client {
  const store = new Map<string, { body: string; etag: string }>();

  return {
    send(command: unknown): Promise<unknown> {
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key!;
        const body = command.input.Body as string;
        const etag = `"${Date.now()}"`;
        store.set(key, { body, etag });
        return Promise.resolve({ ETag: etag });
      }

      if (command instanceof GetObjectCommand) {
        const key = command.input.Key!;
        const entry = store.get(key);
        if (!entry) {
          return Promise.reject({ name: "NoSuchKey" });
        }
        if (
          command.input.IfNoneMatch &&
          command.input.IfNoneMatch === entry.etag
        ) {
          return Promise.reject({ name: "304" });
        }
        return Promise.resolve({
          Body: { transformToString: () => Promise.resolve(entry.body) },
          ETag: entry.etag,
        });
      }

      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? "";
        const contents = [...store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ Key: k }));
        return Promise.resolve({ Contents: contents });
      }

      if (command instanceof DeleteObjectsCommand) {
        const objects = command.input.Delete?.Objects ?? [];
        for (const obj of objects) {
          if (obj.Key) store.delete(obj.Key);
        }
        return Promise.resolve({});
      }

      return Promise.reject(new Error(`Unsupported S3 command`));
    },
    destroy() {},
    config: {} as S3Client["config"],
    middlewareStack: {} as S3Client["middlewareStack"],
  } as unknown as S3Client;
}
