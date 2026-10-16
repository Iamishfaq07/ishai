/**
 * Passkeys in the browser (WebAuthn). The server sends options as JSON with binary fields in base64url; the browser
 * wants ArrayBuffers, and its answer goes back as JSON again. Done by hand: a few lines, no dependency.
 */

export function b64uEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(text: string): ArrayBuffer {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Whether this browser can use passkeys at all (it may still have none for Orbit). */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials?.create);
}

type Json = Record<string, unknown>;
type Descriptor = { id: string; type?: string; transports?: string[] };

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return (list as Descriptor[]).map((d) => ({
    id: b64uDecode(d.id),
    type: "public-key",
    ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
  }));
}

/** Server JSON → what navigator.credentials.create() takes. */
export function creationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const user = json.user as { id: string; name: string; displayName: string };
  return {
    ...(json as unknown as PublicKeyCredentialCreationOptions),
    challenge: b64uDecode(json.challenge as string),
    user: { ...user, id: b64uDecode(user.id) },
    excludeCredentials: descriptors(json.excludeCredentials) ?? [],
  };
}

/** Server JSON → what navigator.credentials.get() takes. */
export function requestOptions(json: Json): PublicKeyCredentialRequestOptions {
  const allow = descriptors(json.allowCredentials);
  const out: PublicKeyCredentialRequestOptions = {
    ...(json as unknown as PublicKeyCredentialRequestOptions),
    challenge: b64uDecode(json.challenge as string),
  };
  if (allow?.length) out.allowCredentials = allow;
  else delete out.allowCredentials;
  return out;
}

/** The browser's answer → JSON for the server. */
export function credentialJSON(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: b64uEncode(r.clientDataJSON) };
  if ("attestationObject" in r && r.attestationObject) {
    response.attestationObject = b64uEncode(r.attestationObject);
    if (typeof r.getTransports === "function") response.transports = r.getTransports();
  } else {
    response.authenticatorData = b64uEncode(r.authenticatorData);
    response.signature = b64uEncode(r.signature);
    if (r.userHandle) response.userHandle = b64uEncode(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment ? { authenticatorAttachment: cred.authenticatorAttachment } : {}),
  };
}

export async function createPasskey(options: Json): Promise<Json> {
  const cred = (await navigator.credentials.create({ publicKey: creationOptions(options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was made.");
  return credentialJSON(cred);
}

export async function getPasskey(options: Json): Promise<Json> {
  const cred = (await navigator.credentials.get({ publicKey: requestOptions(options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was chosen.");
  return credentialJSON(cred);
}

/** A browser error from create()/get() in plain words; null for a cancel (nothing to say). */
export function passkeyErrorText(err: unknown): string | null {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return null; // cancelled, or the prompt timed out
  if (name === "InvalidStateError") return "This device already has a passkey for your Orbit account.";
  if (name === "SecurityError") return "Passkeys only work on Orbit's own site address.";
  if (name === "NotSupportedError") return "This browser or device can't make a passkey.";
  return null;
}
