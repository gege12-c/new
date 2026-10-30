import { describe, expect, it } from "vitest";
import { bikeThreshold, swimCss } from "@/lib/workout/fixtures";
import { parseWorkout, type Segment } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { SuuntoApi, SuuntoError } from "./api";
import { buildGuide, buildGuidePackage, targetField, type GuideStep } from "./guide";
import { buildIconPng, buildZip, readZip } from "./zip";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 255, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};

const options = {
  title: "Seuil 4 × 8 min",
  date: "2026-11-05",
  owner: "TriCoach",
  url: "https://tricoach.test/s/1",
  externalId: "s1:0",
  thresholds,
};

const segment = (fixture = bikeThreshold): Segment => {
  const parsed = parseWorkout(fixture);
  if (!parsed.success) throw new Error("fixture invalide");
  return parsed.data.segments[0];
};

const runSegment = (): Segment => ({
  id: "seg-run",
  sport: "run",
  steps: [
    {
      kind: "step",
      id: "wu",
      type: "warmup",
      length: { unit: "time", seconds: 600 },
      targets: [{ metric: "heart_rate", unit: "bpm", min: 130, max: 145 }],
    },
    {
      kind: "repeat",
      id: "main",
      count: 6,
      steps: [
        {
          kind: "step",
          id: "w",
          type: "active",
          length: { unit: "distance", meters: 400 },
          targets: [{ metric: "pace", unit: "sec_per_km", min: 225, max: 235 }],
          notes: "Relâché, bras souples",
        },
        {
          kind: "step",
          id: "r",
          type: "recovery",
          length: { unit: "time", seconds: 90 },
          targets: [],
        },
      ],
    },
    {
      kind: "step",
      id: "cd",
      type: "cooldown",
      length: { unit: "open" },
      targets: [{ metric: "rpe", unit: "scale", min: 2, max: 3 }],
    },
  ],
});

describe("cibles Suunto", () => {
  it("convertit dans les unités de la montre", () => {
    // 3:45/km (225 s) est la borne rapide : 4,444 m/s = max ; 3:55/km → 4,255 m/s = min
    expect(targetField({ metric: "pace", unit: "sec_per_km", min: 225, max: 235 })).toEqual({ type: "targetPace", value: 4.35, min: 4.255, max: 4.444 });
    expect(targetField({ metric: "pace", unit: "sec_per_100m", min: 100, max: 100 })).toEqual({ type: "targetPace", value: 1, min: 1, max: 1 });
    expect(targetField({ metric: "speed", unit: "kmh", min: 36, max: 36 })).toEqual({ type: "targetSpeed", value: 10, min: 10, max: 10 });
    expect(targetField({ metric: "cadence", unit: "rpm", min: 90, max: 90 })).toEqual({ type: "targetCadence", value: 1.5, min: 1.5, max: 1.5 });
    expect(targetField({ metric: "heart_rate", unit: "bpm", min: 130, max: 145 })).toEqual({ type: "targetHeartRate", value: 138, min: 130, max: 145 });
    expect(targetField({ metric: "power", unit: "watts", min: 237.5, max: 250 })).toEqual({ type: "targetPower", value: 243.75, min: 237.5, max: 250 });
    expect(targetField({ metric: "rpe", unit: "scale", min: 3, max: 3 })).toBeNull();
  });
});

describe("guide SuuntoPlus", () => {
  it("écrit la séance vélo avec les seuils : jauges en watts, répétition, cadence en texte", () => {
    const { guide, issues, steps } = buildGuide(segment(), options);
    expect(guide).toMatchObject({
      type: "sequence",
      usage: "workout",
      owner: "TriCoach",
      localDate: "2026-11-05",
      externalId: "s1:0",
      name: "Seuil 4 × 8 min",
    });
    expect(guide.shortDescription.length).toBeLessThanOrEqual(23);
    expect(guide.steps).toHaveLength(4); // échauffement, répétition, retour au calme, FIN
    expect(steps).toBe(5);

    const warmup = guide.steps[0] as GuideStep;
    expect(warmup.fields[0]).toMatchObject({
      type: "targetPower",
      min: 138,
      max: 175,
    }); // 55–70 % de 250 W, arrondis par resolveTarget
    expect(warmup.fields[1]).toMatchObject({ type: "power" });
    expect(warmup.fields.find((f) => f.type === "stepDurationCountdown")).toMatchObject({ value: 900 });
    expect(warmup.transitions).toEqual([{ condition: { type: "stepDuration", value: 900 } }]);
    expect(warmup.createManualLap).toBeUndefined();

    const repeat = guide.steps[1];
    expect(repeat.type).toBe("repeat");
    if (repeat.type !== "repeat") return;
    expect(repeat.times).toBe(4);
    const [work, rec] = repeat.steps;
    expect(work.title).toBe("TRAVAIL 1/2");
    expect(work.fields[0]).toMatchObject({
      type: "targetPower",
      min: 238,
      max: 250,
    });
    expect(work.createManualLap).toBe(true); // suit un passage automatique (échauffement ou récup)
    expect(work.fields.find((f) => f.type === "text")?.value).toMatch(/85–95 rpm|85-95 rpm/);
    expect(rec.fields[0]).toMatchObject({ type: "targetPower" });
    expect(issues.some((i) => i.severity === "loss" && /Une seule cible/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.severity === "blocking")).toBe(false);

    expect(guide.steps[3]).toMatchObject({ type: "fields", title: "FIN" });
  });

  it("sans seuil : la cible relative est écrite en texte et signalée, rien n'est inventé", () => {
    const { guide, issues } = buildGuide(segment(), {
      ...options,
      thresholds: undefined,
    });
    const warmup = guide.steps[0] as GuideStep;
    expect(warmup.fields.some((f) => f.type === "targetPower")).toBe(false);
    expect(warmup.fields.find((f) => f.type === "text")?.value).toMatch(/55–70 % FTP|55-70 % FTP/);
    expect(issues.some((i) => /FTP vélo non renseignée/.test(i.message))).toBe(true);
  });

  it("course : distance, allure, bouton tour, effort ressenti en texte, limites de longueur", () => {
    const { guide, issues } = buildGuide(runSegment(), {
      ...options,
      title: "VMA 6×400, une séance au titre très long pour la montre",
    });
    expect(guide.name.length).toBeLessThanOrEqual(60);
    expect(guide.shortDescription).toBe("VMA 6×400, une séance a");
    const repeat = guide.steps[1];
    if (repeat.type !== "repeat") throw new Error("répétition attendue");
    const work = repeat.steps[0];
    expect(work.fields[0]).toMatchObject({
      type: "targetPace",
      min: 4.255,
      max: 4.444,
    });
    expect(work.fields[1]).toMatchObject({ type: "pace" });
    expect(work.transitions).toEqual([{ condition: { type: "stepDistance", value: 400 } }]);
    expect(work.notification?.text.length).toBeLessThanOrEqual(54);
    expect(work.fields.find((f) => f.type === "text")?.value).toBe("Relâché, bras souples");
    const cooldown = guide.steps[2] as GuideStep;
    expect(cooldown.transitions).toEqual([{ condition: { type: "manualLap" } }]);
    expect(cooldown.fields.find((f) => f.type === "text")?.value).toBe("Effort 2-3/10");
    expect(issues.some((i) => /Effort ressenti/.test(i.message))).toBe(true);
    const walk = (node: (typeof guide.steps)[number]) => {
      if (node.type === "repeat") return node.steps.forEach(walk);
      expect(node.title.length).toBeLessThanOrEqual(13);
      expect(node.fields.length).toBeLessThanOrEqual(5);
      for (const f of node.fields) if (f.type === "text") expect(String(f.value).length).toBeLessThanOrEqual(54);
    };
    guide.steps.forEach(walk);
  });

  it("pas de tour créé après un appui sur le bouton tour, un tour après un passage automatique", () => {
    const seg: Segment = {
      id: "s",
      sport: "run",
      steps: [
        {
          kind: "step",
          id: "a",
          type: "warmup",
          length: { unit: "open" },
          targets: [],
        },
        {
          kind: "step",
          id: "b",
          type: "active",
          length: { unit: "time", seconds: 60 },
          targets: [],
        },
        {
          kind: "step",
          id: "c",
          type: "active",
          length: { unit: "time", seconds: 60 },
          targets: [],
        },
      ],
    };
    const { guide } = buildGuide(seg, options);
    expect((guide.steps[1] as GuideStep).createManualLap).toBeUndefined();
    expect((guide.steps[2] as GuideStep).createManualLap).toBe(true);
  });

  it("natation : allure CSS en m/s, départ toutes les N secondes écrit en texte", () => {
    const { guide, issues } = buildGuide(segment(swimCss), options);
    const repeat = guide.steps.find((s) => s.type === "repeat");
    expect(repeat).toBeDefined();
    if (!repeat || repeat.type !== "repeat") return;
    expect(repeat.steps[0].fields[0]).toMatchObject({ type: "targetPace" });
    expect(issues.some((i) => /send-off/.test(i.message))).toBe(true);
  });

  it("répétition imbriquée déroulée, plus de 100 répétitions plafonnées", () => {
    const seg: Segment = {
      id: "s",
      sport: "bike",
      steps: [
        {
          kind: "repeat",
          id: "outer",
          count: 120,
          steps: [
            {
              kind: "repeat",
              id: "inner",
              count: 2,
              steps: [
                {
                  kind: "step",
                  id: "x",
                  type: "active",
                  length: { unit: "time", seconds: 30 },
                  targets: [],
                },
              ],
            },
            {
              kind: "step",
              id: "y",
              type: "rest",
              length: { unit: "time", seconds: 30 },
              targets: [],
            },
          ],
        },
      ],
    };
    const { guide, issues } = buildGuide(seg, options);
    const repeat = guide.steps[0];
    if (repeat.type !== "repeat") throw new Error("répétition attendue");
    expect(repeat.times).toBe(100);
    expect(repeat.steps).toHaveLength(3);
    expect(issues.some((i) => /déroulée/.test(i.message))).toBe(true);
    expect(issues.some((i) => /s'arrête à 100/.test(i.message))).toBe(true);
  });

  it("le paquet contient les trois fichiers attendus, avec une icône 300 × 300", () => {
    const { zip, guide } = buildGuidePackage(segment(), {
      ...options,
      activities: [1, 2],
    });
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "guide.json", "icon.png"]);
    const decoded = JSON.parse(new TextDecoder().decode(entries[1].data));
    expect(decoded).toEqual(guide);
    expect(decoded.activities).toEqual([1, 2]);
    expect(JSON.parse(new TextDecoder().decode(entries[0].data))).toMatchObject({ owner: "TriCoach", type: "sequence", name: guide.name });
    const png = Buffer.from(entries[2].data);
    expect(png.readUInt32BE(16)).toBe(300);
    expect(png.readUInt32BE(20)).toBe(300);
    expect(Buffer.from(buildZip([])).length).toBe(22);
    expect(buildIconPng().subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("client API Suunto", () => {
  const endpoints = {
    apiBaseUrl: "https://api.test",
    oauthBaseUrl: "https://api.test/oauth",
    clientId: "id",
    clientSecret: "secret",
    subscriptionKey: "key",
  };

  it("envoie le jeton, la clé d'abonnement et le ZIP, lit l'identifiant du guide", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const api = new SuuntoApi(endpoints, async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: 42 }), { status: 200 });
    });
    const result = await api.createGuide("tok", new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ id: "42" });
    const headers = new Headers(seen[0].init?.headers);
    expect(seen[0].url).toBe("https://api.test/v2/guides/files");
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("ocp-apim-subscription-key")).toBe("key");
    expect(headers.get("content-type")).toBe("application/zip");
    expect(api.authorizeUrl("https://site/cb", "st")).toBe(
      "https://api.test/oauth/authorize?response_type=code&client_id=id&redirect_uri=https%3A%2F%2Fsite%2Fcb&state=st",
    );
  });

  it("classe les erreurs et lit Retry-After", async () => {
    const api = new SuuntoApi(
      endpoints,
      async () => new Response("owner mismatch", { status: 400 }),
      () => new Date(0),
    );
    await expect(api.deleteGuide("t", "g")).rejects.toMatchObject({
      kind: "bad_request",
      message: expect.stringMatching(/owner/),
    });
    const limited = new SuuntoApi(
      endpoints,
      async () => new Response("", { status: 429, headers: { "Retry-After": "30" } }),
      () => new Date(0),
    );
    await expect(limited.listGuides("t")).rejects.toMatchObject({
      kind: "rate_limited",
      retryAt: new Date(30_000),
    });
    const down = new SuuntoApi(endpoints, async () => {
      throw new Error("ECONNRESET");
    });
    await expect(down.listGuides("t")).rejects.toBeInstanceOf(SuuntoError);
    const list = new SuuntoApi(endpoints, async () => new Response(JSON.stringify({ items: [{ id: 1, name: "A" }, { nope: true }] }), { status: 200 }));
    expect(await list.listGuides("t")).toEqual([{ id: "1", name: "A" }]);
  });
});
