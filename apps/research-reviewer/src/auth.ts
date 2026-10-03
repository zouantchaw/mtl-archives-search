import { createRemoteJWKSet, jwtVerify } from "jose";
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function sha(value: string | ArrayBuffer) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function authenticate(
  request: Request,
  env: { ACCESS_ISSUER: string; ACCESS_AUD: string },
) {
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) ||
    !env.ACCESS_AUD
  )
    throw Error("Sign-in is not configured.");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw Error("Sign in to review this collection.");
  let jwks = keys.get(env.ACCESS_ISSUER);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", env.ACCESS_ISSUER),
    );
    keys.set(env.ACCESS_ISSUER, jwks);
  }
  const result = await jwtVerify(token, jwks, {
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUD,
    algorithms: ["RS256"],
  });
  if (
    typeof result.payload.sub !== "string" ||
    typeof result.payload.email !== "string"
  )
    throw Error("Reviewer identity is missing.");
  return {
    id: await sha(env.ACCESS_ISSUER + "|" + result.payload.sub),
    email: result.payload.email,
  };
}
