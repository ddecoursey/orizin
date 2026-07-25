import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedMutationRequest } from "../requestOrigin.js";

function request({ method = "POST", origin, fetchSite, host = "orizin.io", protocol = "https" } = {}) {
  const headers = {
    host,
    ...(origin ? { origin } : {}),
    ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}),
  };
  return {
    method,
    protocol,
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

test("same-origin and configured-origin mutations are trusted", () => {
  assert.equal(isTrustedMutationRequest(request({ origin: "https://orizin.io" }), "https://orizin.io"), true);
  assert.equal(
    isTrustedMutationRequest(
      request({ origin: "https://app.orizin.io", host: "railway.internal" }),
      "https://app.orizin.io",
    ),
    true,
  );
});

test("cross-origin browser mutations are rejected", () => {
  assert.equal(isTrustedMutationRequest(request({ origin: "https://attacker.example" }), "https://orizin.io"), false);
  assert.equal(isTrustedMutationRequest(request({ fetchSite: "cross-site" }), "https://orizin.io"), false);
});

test("safe methods and server-to-server mutations remain allowed", () => {
  assert.equal(isTrustedMutationRequest(request({ method: "GET", origin: "https://attacker.example" })), true);
  assert.equal(isTrustedMutationRequest(request(), "https://orizin.io"), true);
});
