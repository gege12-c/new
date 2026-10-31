import { describe, expect, it } from "vitest";
import { authorizeUrl, cookieValue, matchingVerifier, newOAuthRequest, pkceChallenge } from "./oauth";

describe("connexion à intervals.icu par « Autoriser »", () => {
  it("adresse d'autorisation documentée, avec PKCE (S256)", () => {
    const url = new URL(authorizeUrl("https://intervals.icu", { clientId: "77", redirectUri: "https://site.test/api/intervals/callback", scope: "ACTIVITY:READ,CALENDAR:WRITE", state: "s1", challenge: "c1" }));
    expect(url.origin + url.pathname).toBe("https://intervals.icu/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "77",
      redirect_uri: "https://site.test/api/intervals/callback",
      scope: "ACTIVITY:READ,CALENDAR:WRITE",
      state: "s1",
      code_challenge: "c1",
      code_challenge_method: "S256",
    });
    // Exemple de la RFC 7636 (annexe B).
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("le retour n'est accepté que pour la demande de cet utilisateur", () => {
    const request = newOAuthRequest();
    expect(request.challenge).toBe(pkceChallenge(request.verifier));
    const stored = cookieValue(request, "user-1");
    expect(matchingVerifier(stored, request.state, "user-1")).toBe(request.verifier);
    expect(matchingVerifier(stored, request.state, "user-2")).toBeNull();
    expect(matchingVerifier(stored, "autre", "user-1")).toBeNull();
    expect(matchingVerifier(undefined, request.state, "user-1")).toBeNull();
    expect(matchingVerifier(stored, null, "user-1")).toBeNull();
  });
});
