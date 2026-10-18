import { describe, expect, it } from "vitest";
import { nextQuarterHour, nextUtcMidnight, parseRateLimits, quotaWaitUntil, StravaApi, StravaError } from "./api";
import { normalizeStravaActivity, stravaSport, stravaTimeZone } from "./normalize";
import { canReadActivities, parseScopes, WebhookEventSchema } from "./schemas";

const sample = {
  id: 16_123_456_789,
  name: "Sortie du matin",
  sport_type: "VirtualRide",
  start_date: "2026-10-20T05:31:02Z",
  start_date_local: "2026-10-20T07:31:02Z",
  timezone: "(GMT+01:00) Europe/Paris",
  elapsed_time: 3720.4,
  moving_time: 3600,
  distance: 30123.47,
  total_elevation_gain: 12.3,
  average_heartrate: 141.6,
  max_heartrate: 900,
  average_watts: 205.2,
  weighted_average_watts: 214,
  trainer: true,
};

describe("activités Strava", () => {
  it("normalise une activité : discipline, heure locale, bornes", () => {
    const activity = normalizeStravaActivity(sample);
    expect(activity).toMatchObject({
      external_id: "16123456789",
      sport: "bike",
      sport_detail: "VirtualRide",
      start_time: "2026-10-20T05:31:02.000Z",
      local_date: "2026-10-20",
      local_start_time: "07:31:02",
      timezone: "Europe/Paris",
      elapsed_s: 3720,
      moving_s: 3600,
      distance_m: 30123.5,
      avg_hr: 142,
      // Valeur aberrante écartée plutôt que d'empêcher l'enregistrement.
      max_hr: null,
      weighted_power: 214,
      trainer: true,
    });
  });

  it("classe les types d'activité Strava", () => {
    expect(stravaSport("TrailRun")).toBe("run");
    expect(stravaSport("GravelRide")).toBe("bike");
    expect(stravaSport("Swim")).toBe("swim");
    expect(stravaSport("WeightTraining")).toBe("strength");
    expect(stravaSport("Yoga")).toBe("other");
    expect(stravaSport(null, "Run")).toBe("run");
    expect(stravaTimeZone("(GMT-08:00) America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(stravaTimeZone("(GMT+00:00) Nowhere/Land")).toBeNull();
  });

  it("lit les autorisations accordées, quel que soit le séparateur", () => {
    expect(parseScopes("read,activity:read_all")).toEqual(["read", "activity:read_all"]);
    expect(parseScopes("read activity:read")).toEqual(["read", "activity:read"]);
    expect(canReadActivities(parseScopes("read"))).toBe(false);
    expect(canReadActivities(parseScopes("read,activity:read"))).toBe(true);
  });

  it("valide les évènements de webhook", () => {
    const event = { object_type: "activity", object_id: 1, aspect_type: "create", owner_id: 2, subscription_id: 3, event_time: 1_700_000_000, updates: {} };
    expect(WebhookEventSchema.safeParse(event).success).toBe(true);
    expect(WebhookEventSchema.safeParse({ ...event, aspect_type: "explode" }).success).toBe(false);
    expect(WebhookEventSchema.safeParse({ ...event, owner_id: "2" }).success).toBe(false);
  });
});

describe("quotas Strava", () => {
  const headers = (limit: string, usage: string, read?: [string, string]) =>
    new Headers({
      "X-RateLimit-Limit": limit,
      "X-RateLimit-Usage": usage,
      ...(read ? { "X-ReadRateLimit-Limit": read[0], "X-ReadRateLimit-Usage": read[1] } : {}),
    });

  it("lit les en-têtes de quota", () => {
    expect(parseRateLimits(headers("400,4000", "12,300", ["200,2000", "10,250"]))).toEqual({
      limit15: 400,
      limitDay: 4000,
      usage15: 12,
      usageDay: 300,
      readLimit15: 200,
      readLimitDay: 2000,
      readUsage15: 10,
      readUsageDay: 250,
    });
    expect(parseRateLimits(new Headers())).toBeNull();
  });

  it("s'arrête avant la limite et reprend à la fenêtre suivante", () => {
    const now = new Date("2026-10-20T10:07:30Z");
    const snapshot = parseRateLimits(headers("400,4000", "12,300", ["200,2000", "185,250"]));
    expect(quotaWaitUntil(snapshot, now)?.toISOString()).toBe("2026-10-20T10:15:00.000Z");
    const daily = parseRateLimits(headers("400,4000", "12,3900", ["200,2000", "1,1"]));
    expect(quotaWaitUntil(daily, now)?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(quotaWaitUntil(parseRateLimits(headers("400,4000", "12,300")), now)).toBeNull();
    expect(nextQuarterHour(new Date("2026-10-20T10:59:59Z")).toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("transmet chaque quota lu et classe les erreurs", async () => {
    const seen: number[] = [];
    const api = new StravaApi(
      { apiBaseUrl: "https://strava.test/api/v3", oauthBaseUrl: "https://strava.test/oauth", clientId: "1", clientSecret: "s" },
      async (url, init) => {
        expect(init?.headers).toMatchObject({ authorization: "Bearer jeton" });
        if (url.endsWith("/activities/404")) return new Response("{}", { status: 404, headers: headers("400,4000", "2,2") });
        if (url.endsWith("/activities/429")) return new Response("{}", { status: 429, headers: headers("400,4000", "401,401") });
        return new Response(JSON.stringify(sample), { status: 200, headers: headers("400,4000", "1,1") });
      },
      (snapshot) => {
        seen.push(snapshot.usage15);
      },
      () => new Date("2026-10-20T10:07:30Z"),
    );
    await expect(api.getActivity("jeton", "1")).resolves.toMatchObject({ id: sample.id });
    await expect(api.getActivity("jeton", "404")).rejects.toMatchObject({ kind: "not_found" });
    const limited = await api.getActivity("jeton", "429").catch((e: StravaError) => e);
    expect(limited).toBeInstanceOf(StravaError);
    expect((limited as StravaError).kind).toBe("rate_limited");
    expect((limited as StravaError).retryAt?.toISOString()).toBe("2026-10-20T10:15:00.000Z");
    expect(seen).toEqual([1, 2, 401]);
  });

  it("révoque l'accès par /oauth/revoke, identifié par le client", async () => {
    let seen: { url: string; auth: string; body: string } | null = null;
    const api = new StravaApi(
      { apiBaseUrl: "https://strava.test/api/v3", oauthBaseUrl: "https://strava.test/oauth", clientId: "123", clientSecret: "secret" },
      async (url, init) => {
        seen = { url, auth: (init?.headers as Record<string, string>).authorization, body: String(init?.body) };
        return new Response("", { status: 200 });
      },
    );
    await api.revoke("jeton-de-rafraichissement", "refresh_token");
    expect(seen).toEqual({
      url: "https://strava.test/oauth/revoke",
      auth: `Basic ${Buffer.from("123:secret").toString("base64")}`,
      body: "token=jeton-de-rafraichissement&token_type_hint=refresh_token",
    });
  });
});
