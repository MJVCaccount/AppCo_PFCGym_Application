// Redirects `next/headers` to an in-memory cookie store so session code runs outside a request scope,
// and swaps the network-facing packages ("resend", "@vercel/blob") for in-memory stubs so no test can
// send an email or touch a real store.
const Module = require("node:module");
const path = require("node:path");

const stubs = {
  "next/headers": path.join(__dirname, "next-headers.ts"),
  "next/navigation": path.join(__dirname, "next-navigation.ts"),
  "next/cache": path.join(__dirname, "next-cache.ts"),
  resend: path.join(__dirname, "resend-stub.ts"),
  "@vercel/blob": path.join(__dirname, "vercel-blob-stub.ts"),
};
const resolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, stubs[request] ?? request, ...rest);
};
