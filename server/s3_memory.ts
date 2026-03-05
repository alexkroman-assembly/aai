import type { S3Client } from "@aws-sdk/client-s3";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

/** In-memory S3-compatible client for local development. */
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
