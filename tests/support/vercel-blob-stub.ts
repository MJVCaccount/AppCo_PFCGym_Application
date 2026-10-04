/**
 * Stands in for "@vercel/blob" in tests (see register.cjs): an in-memory store
 * that records every call's options, so tests can check which store, access
 * level and pathname the app used. The state lives on globalThis.
 */
interface StoredBlob {
  body: Buffer;
  contentType: string;
  access: string;
  options: Record<string, unknown>;
}

type Store = {
  blobs: Map<string, StoredBlob>;
  calls: { fn: string; pathname: string; options: Record<string, unknown> }[];
  failDelete: boolean;
};

const store: Store = ((globalThis as unknown as { __blob?: Store }).__blob ??= {
  blobs: new Map(),
  calls: [],
  failDelete: false,
});

export async function put(
  pathname: string,
  body: Buffer | Uint8Array | string,
  options: { access: string; contentType?: string } & Record<string, unknown>,
) {
  store.calls.push({ fn: "put", pathname, options });
  store.blobs.set(pathname, {
    body: Buffer.from(body),
    contentType: options.contentType ?? "application/octet-stream",
    access: options.access,
    options,
  });

  return {
    url: `https://${String(options.storeId ?? "stub").toLowerCase()}.${options.access}.blob.vercel-storage.com/${pathname}`,
    downloadUrl: "",
    pathname,
    contentType: options.contentType ?? "application/octet-stream",
    contentDisposition: "",
    etag: "stub",
  };
}

export async function get(pathname: string, options: { access: string } & Record<string, unknown>) {
  store.calls.push({ fn: "get", pathname, options });
  const blob = store.blobs.get(pathname);
  if (!blob || blob.access !== options.access) return null;

  const bytes = blob.body;
  return {
    statusCode: 200 as const,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
    headers: new Headers(),
    blob: {
      url: "",
      downloadUrl: "",
      pathname,
      contentDisposition: "",
      cacheControl: "",
      uploadedAt: new Date(),
      etag: "stub",
      contentType: blob.contentType,
      size: bytes.length,
    },
  };
}

export async function del(pathname: string | string[], options: Record<string, unknown>) {
  const names = Array.isArray(pathname) ? pathname : [pathname];
  for (const name of names) store.calls.push({ fn: "del", pathname: name, options });
  if (store.failDelete) throw new Error("stub delete failure");
  for (const name of names) store.blobs.delete(name);
}
