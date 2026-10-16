import { describe, expect, it } from "vitest";
import { b64uDecode, b64uEncode, creationOptions, credentialJSON, passkeyErrorText, requestOptions } from "./passkey";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("passkey JSON", () => {
  it("round-trips base64url without padding", () => {
    for (const data of [bytes(), bytes(0), bytes(251, 255), bytes(1, 2, 3, 4, 5)]) {
      const text = b64uEncode(data);
      expect(text).not.toMatch(/[+/=]/);
      expect(new Uint8Array(b64uDecode(text))).toEqual(data);
    }
    expect(b64uEncode(bytes(251, 255))).toBe("-_8");
  });

  it("turns the server's options into the browser's", () => {
    const create = creationOptions({
      challenge: b64uEncode(bytes(9, 9)),
      rp: { id: "localhost", name: "Orbit" },
      user: { id: b64uEncode(bytes(7)), name: "a@b.c", displayName: "A" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      excludeCredentials: [{ id: b64uEncode(bytes(1, 2)), type: "public-key", transports: ["internal"] }],
    });
    expect(new Uint8Array(create.challenge as ArrayBuffer)).toEqual(bytes(9, 9));
    expect(new Uint8Array(create.user.id as ArrayBuffer)).toEqual(bytes(7));
    expect(create.user.name).toBe("a@b.c");
    expect(new Uint8Array(create.excludeCredentials![0]!.id as ArrayBuffer)).toEqual(bytes(1, 2));
    expect(create.excludeCredentials![0]!.transports).toEqual(["internal"]);

    const get = requestOptions({ challenge: b64uEncode(bytes(5)), rpId: "localhost", allowCredentials: [], userVerification: "required" });
    expect(new Uint8Array(get.challenge as ArrayBuffer)).toEqual(bytes(5));
    expect("allowCredentials" in get).toBe(false); // empty: let the device offer its own passkeys
    expect(get.userVerification).toBe("required");
  });

  it("turns the browser's answer into JSON", () => {
    const assertion = {
      id: "AQI",
      rawId: bytes(1, 2).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: { clientDataJSON: bytes(123).buffer, authenticatorData: bytes(4).buffer, signature: bytes(5, 6).buffer, userHandle: bytes(7).buffer },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(credentialJSON(assertion)).toEqual({
      id: "AQI",
      rawId: "AQI",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: "ew", authenticatorData: "BA", signature: "BQY", userHandle: "Bw" },
    });
    const attestation = {
      id: "AQI",
      rawId: bytes(1, 2).buffer,
      type: "public-key",
      response: { clientDataJSON: bytes(123).buffer, attestationObject: bytes(8).buffer, getTransports: () => ["internal", "hybrid"] },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(credentialJSON(attestation).response).toEqual({ clientDataJSON: "ew", attestationObject: "CA", transports: ["internal", "hybrid"] });
  });

  it("says nothing for a cancel and something useful otherwise", () => {
    expect(passkeyErrorText(new DOMException("x", "NotAllowedError"))).toBeNull();
    expect(passkeyErrorText(new DOMException("x", "InvalidStateError"))).toMatch(/already has a passkey/);
    expect(passkeyErrorText(new Error("boom"))).toBeNull();
  });
});
