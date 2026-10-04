// Redirects `next/headers` to an in-memory cookie store so session code runs outside a request scope.
const Module = require("node:module");
const path = require("node:path");

const stub = path.join(__dirname, "next-headers.ts");
const resolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request === "next/headers" ? stub : request, ...rest);
};
