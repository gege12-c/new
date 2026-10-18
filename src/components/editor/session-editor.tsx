"use client";

import { ArrowLeft, BookmarkPlus, CircleSlash, Ellipsis, EyeOff, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  changeSessionState,
  deleteSession,
  discardPendingChanges,
  keepPublishedOnConflict,
  publishSession,
  saveSession,
  saveSessionAsTemplate,
  saveTemplate,
  type SaveSessionResult,
} from "@/app/(app)/planning-actions";
import { SPORT_ICONS, SPORT_STYLES } from "@/components/sport";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses, Select } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { snapshotToValues, type EditorValues } from "@/lib/planning/editor-values";
import { FIELD_LABELS, SessionValuesSchema, stableJson, type EditableField, type SessionSnapshot } from "@/lib/planning/snapshot";
import type { SessionState } from "@/lib/planning/status";
import { addSegment, setSegmentSport } from "@/lib/workout/edit";
import {
  OBJECTIVE_LABELS,
  SESSION_OBJECTIVES,
  SESSION_SPORTS,
  SPORT_LABELS,
  SPORT_TARGETS,
  WorkoutSchema,
  sessionSportOf,
  type SessionObjective,
  type SessionSport,
  type Workout,
  type WorkoutNode,
} from "@/lib/workout/schema";
import { analyzeWorkout, type WorkoutIssue } from "@/lib/workout/warnings";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";
import { WorkoutPreview } from "./preview";
import { StructureEditor } from "./structure-editor";

export interface SessionEditorProps {
  mode: "session" | "template";
  athlete?: { id: string; name: string; thresholds: AthleteThresholds };
  sessionId: string | null;
  templateId: string | null;
  state: SessionState | null;
  /**
   * État enregistré dont part l’édition (séance, ou modifications en attente d’une séance publiée) :
   * la base de données fusionne les changements de l’éditeur par rapport à lui.
   */
  base: Partial<SessionSnapshot> | null;
  values: EditorValues;
  pendingSince: string | null;
  lastSavedAt: string | null;
  backHref: string;
  backLabel: string;
  /** Chemin de l’éditeur une fois la séance créée (« {id} » est remplacé). */
  editHrefPattern: string;
}

type Status =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "pending"; at: string }
  | { kind: "invalid"; message: string }
  /** scope « save » : à l’enregistrement ; « publish » : à la publication des modifications en attente. */
  | { kind: "conflict"; scope: "save" | "publish"; fields: EditableField[]; current: SessionSnapshot | null; pending: boolean }
  | { kind: "error"; message: string };

const VALUE_KEYS = ["scheduled_date", "start_time", "title", "objective", "description", "nutrition_notes", "content"] as const satisfies readonly (keyof EditorValues)[];

const AUTOSAVE_DELAY = 1200;

const subscribeNothing = () => () => {};

const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const savedAt = (iso: string) => timeFormatter.format(new Date(iso));

function toPayload(values: EditorValues) {
  return {
    scheduled_date: values.scheduled_date,
    start_time: values.start_time || null,
    sport: sessionSportOf(values.content),
    title: values.title,
    objective: (values.objective || null) as SessionObjective | null,
    description: values.description || null,
    nutrition_notes: values.nutrition_notes || null,
    content: values.content,
  };
}

/** Ce que la base enregistre pour ces valeurs (espaces retirés, heure normalisée…), en valeurs d’éditeur. */
function normalizedValues(values: EditorValues): EditorValues {
  const parsed = SessionValuesSchema.safeParse(toPayload(values));
  if (!parsed.success) return values;
  return snapshotToValues({ ...parsed.data, planned_duration_s: null, planned_distance_m: null });
}

/** Rattache chaque erreur de validation au bloc concerné, pour l’afficher sur place. */
function errorsByNode(workout: Workout): { byNode: Map<string, string>; general: string[] } {
  const result = WorkoutSchema.safeParse(workout);
  const byNode = new Map<string, string>();
  const general: string[] = [];
  if (result.success) return { byNode, general };
  for (const issue of result.error.issues) {
    let nodes: WorkoutNode[] | undefined;
    let found: string | undefined;
    const path = issue.path;
    for (let i = 0; i < path.length; i += 1) {
      if (path[i] === "segments" && typeof path[i + 1] === "number") nodes = workout.segments[path[i + 1] as number]?.steps;
      if (path[i] === "steps" && typeof path[i + 1] === "number" && nodes) {
        const node: WorkoutNode | undefined = nodes[path[i + 1] as number];
        if (node) {
          found = node.id;
          nodes = node.kind === "repeat" ? node.steps : undefined;
        }
      }
    }
    if (found && !byNode.has(found)) byNode.set(found, issue.message);
    else if (!found) general.push(issue.message);
  }
  return { byNode, general };
}

export function SessionEditor(props: SessionEditorProps) {
  const router = useRouter();
  const { mode, athlete } = props;
  const [values, setValues] = useState<EditorValues>(props.values);
  const [state, setState] = useState<SessionState | null>(props.state);
  const [pending, setPending] = useState(Boolean(props.pendingSince));
  const [status, setStatus] = useState<Status>(
    props.pendingSince ? { kind: "pending", at: props.pendingSince } : props.lastSavedAt ? { kind: "saved", at: props.lastSavedAt } : { kind: "clean" },
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(mode === "template" ? props.templateId : props.sessionId);
  const [confirm, setConfirm] = useState<null | "delete" | "discard">(null);
  const [busy, startBusy] = useTransition();
  // Marqueur d'hydratation : l'éditeur ne prend la main sur la saisie qu'une fois monté (tests de bout en bout).
  const ready = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const valuesRef = useRef(values);
  const savedJson = useRef(stableJson(props.values));
  const baseRef = useRef(props.base);
  const idRef = useRef(mode === "template" ? props.templateId : props.sessionId);
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const sport = sessionSportOf(values.content);
  const thresholds = athlete?.thresholds;
  const issues = useMemo(() => analyzeWorkout(values.content, thresholds), [values.content, thresholds]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, WorkoutIssue[]>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const validation = useMemo(() => errorsByNode(values.content), [values.content]);
  const globalIssues = issues.filter((issue) => !issue.nodeId);

  const notify = useCallback((message: string) => {
    setNotice(message);
  }, []);

  /**
   * Après un enregistrement fusionné : reprend les changements faits ailleurs sur les champs que
   * l’éditeur n’a pas touchés (ni avant l’envoi, ni depuis). Les écarts de simple mise en forme
   * (espaces retirés par la base…) ne comptent pas comme des changements.
   */
  const adoptMerged = useCallback(
    (snapshot: SessionSnapshot, sent: EditorValues, sentJson: string, prefix = "") => {
      baseRef.current = snapshot;
      savedJson.current = sentJson;
      const merged = snapshotToValues(snapshot);
      const expected = normalizedValues(sent);
      const adopted = VALUE_KEYS.filter(
        (key) => stableJson(merged[key]) !== stableJson(expected[key]) && stableJson(valuesRef.current[key]) === stableJson(sent[key]),
      );
      if (!adopted.length) return false;
      const taken = Object.fromEntries(adopted.map((key) => [key, merged[key]])) as Partial<EditorValues>;
      savedJson.current = stableJson({ ...sent, ...taken });
      setValues({ ...valuesRef.current, ...taken });
      notify(`${prefix}Cette séance avait été modifiée ailleurs (par exemple déplacée) : ces changements ont été repris.`);
      return true;
    },
    [notify],
  );

  const applyResult = useCallback(
    (result: SaveSessionResult, sentJson: string, sent: EditorValues) => {
      switch (result.status) {
        case "saved": {
          const created = !idRef.current;
          idRef.current = result.sessionId;
          setSavedId(result.sessionId);
          setState(result.state);
          setPending(false);
          setStatus({ kind: "saved", at: result.savedAt });
          adoptMerged(result.snapshot, sent, sentJson);
          if (created) window.history.replaceState(null, "", props.editHrefPattern.replace("{id}", result.sessionId));
          break;
        }
        case "pending":
          setPending(true);
          setStatus({ kind: "pending", at: result.savedAt });
          adoptMerged(result.snapshot, sent, sentJson);
          break;
        case "conflict":
          setStatus({ kind: "conflict", scope: "save", fields: result.fields, current: result.current, pending: result.pending });
          break;
        default:
          setStatus({ kind: "error", message: result.message });
      }
    },
    [adoptMerged, props.editHrefPattern],
  );

  const save = useCallback((): Promise<void> => {
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    if (timer.current) clearTimeout(timer.current);
    const sent = valuesRef.current;
    const sentJson = stableJson(sent);
    if (sentJson === savedJson.current && idRef.current) return Promise.resolve();

    const payload = toPayload(sent);
    if (mode === "session") {
      const check = SessionValuesSchema.safeParse(payload);
      if (!check.success) {
        setStatus({ kind: "invalid", message: check.error.issues[0]?.message ?? "Séance incomplète." });
        return Promise.resolve();
      }
    } else if (!payload.title.trim() || !WorkoutSchema.safeParse(payload.content).success) {
      setStatus({ kind: "invalid", message: payload.title.trim() ? "Corrigez les erreurs signalées." : "Donnez un nom au modèle." });
      return Promise.resolve();
    }

    setStatus({ kind: "saving" });
    const run = async () => {
      try {
        if (mode === "template") {
          const result = await saveTemplate({
            templateId: idRef.current,
            name: payload.title,
            sport: payload.sport,
            objective: payload.objective,
            description: payload.description,
            content: payload.content,
          });
          if (result.status === "saved") {
            const created = !idRef.current;
            idRef.current = result.templateId;
            setSavedId(result.templateId);
            savedJson.current = sentJson;
            setStatus({ kind: "saved", at: result.savedAt });
            if (created) window.history.replaceState(null, "", props.editHrefPattern.replace("{id}", result.templateId));
          } else {
            setStatus({ kind: "error", message: result.message });
          }
          return;
        }
        const result = await saveSession({
          sessionId: idRef.current,
          athleteId: athlete!.id,
          templateId: props.templateId,
          base: baseRef.current,
          values: payload,
        });
        applyResult(result, sentJson, sent);
      } catch {
        setStatus({ kind: "error", message: "Connexion perdue : vos modifications sont gardées ici, nouvel essai à la prochaine modification." });
      }
    };
    const promise = run().finally(() => {
      inFlight.current = null;
      if (queued.current) {
        queued.current = false;
        if (stableJson(valuesRef.current) !== savedJson.current) void saveRef.current();
      }
    });
    inFlight.current = promise;
    return promise;
  }, [applyResult, athlete, mode, props.editHrefPattern, props.templateId]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Enregistrement automatique, après une courte pause de saisie.
  useEffect(() => {
    if (stableJson(values) === savedJson.current) return;
    setStatus((current) => (current.kind === "conflict" ? current : { kind: "dirty" }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [values, save]);

  // Ne jamais quitter la page avec des modifications non enregistrées sans prévenir.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (stableJson(valuesRef.current) !== savedJson.current || inFlight.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Cmd/Ctrl + S : enregistrement immédiat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const flush = async () => {
    await inFlight.current;
    if (stableJson(valuesRef.current) !== savedJson.current || !idRef.current) await save();
    await inFlight.current;
    return stableJson(valuesRef.current) === savedJson.current && Boolean(idRef.current);
  };

  const update = (patch: Partial<EditorValues>) => setValues((current) => ({ ...current, ...patch }));
  const updateContent = (change: (workout: Workout) => Workout) => setValues((current) => ({ ...current, content: change(current.content) }));

  const changeSport = (next: SessionSport) => {
    if (next === sport) return;
    setValues((current) => {
      let content = current.content;
      let removed = 0;
      if (next === "brick") {
        if (content.segments.length === 1) {
          const first = content.segments[0].sport;
          if (first !== "bike" && first !== "run") {
            const converted = setSegmentSport(content, 0, "bike", (s, key) => SPORT_TARGETS[s].includes(key));
            content = converted.workout;
            removed += converted.removedTargets;
          }
          content = addSegment(content, content.segments[0].sport === "run" ? "bike" : "run");
        }
      } else {
        for (let i = 0; i < content.segments.length; i += 1) {
          const converted = setSegmentSport(content, i, next, (s, key) => SPORT_TARGETS[s].includes(key));
          content = converted.workout;
          removed += converted.removedTargets;
        }
      }
      if (removed > 0) {
        setNotice(`${removed} cible${removed > 1 ? "s" : ""} retirée${removed > 1 ? "s" : ""} : impossible${removed > 1 ? "s" : ""} en ${SPORT_LABELS[next].toLowerCase()}.`);
      }
      return { ...current, content };
    });
  };

  const goBack = async () => {
    const ok = await flush().catch(() => false);
    if (!ok && stableJson(valuesRef.current) !== savedJson.current) {
      setNotice("Les dernières modifications ne sont pas enregistrées : corrigez-les ou réessayez avant de quitter.");
      return;
    }
    router.push(props.backHref);
  };

  /** Publie (après flush). La version publiée devient l’état de référence : elle peut inclure un déplacement fait ailleurs. */
  const publishNow = async (prefer?: "mine") => {
    if (!idRef.current) return;
    const wasPending = pending;
    const sent = valuesRef.current;
    const sentJson = savedJson.current;
    const result = await publishSession(idRef.current, { refreshPage: false, prefer });
    if (result.status === "ok") {
      setState((current) => (current === "cancelled" ? current : "published"));
      setPending(false);
      setStatus({ kind: "saved", at: new Date().toISOString() });
      const done = wasPending ? "Modifications publiées : l’athlète les voit maintenant." : "Séance publiée : l’athlète la voit maintenant.";
      if (!result.snapshot || !adoptMerged(result.snapshot, sent, sentJson, `${done} `)) setNotice(done);
    } else if (result.status === "conflict") {
      setStatus({ kind: "conflict", scope: "publish", fields: result.fields, current: result.current, pending: true });
    } else {
      setNotice(result.message);
    }
  };

  const runPublish = () =>
    startBusy(async () => {
      const ok = await flush();
      if (!ok || !idRef.current) {
        setNotice("Enregistrez d’abord une séance valide.");
        return;
      }
      await publishNow();
    });

  const runTransition = (transition: "unpublish" | "cancel" | "restore") =>
    startBusy(async () => {
      if (!idRef.current) return;
      await flush();
      const result = await changeSessionState(idRef.current, transition, { refreshPage: false });
      if (result.status === "ok") {
        setState(transition === "unpublish" ? "draft" : transition === "cancel" ? "cancelled" : "published");
        setNotice(
          transition === "unpublish"
            ? "Séance repassée en brouillon : l’athlète ne la voit plus."
            : transition === "cancel"
              ? "Séance annulée : elle reste visible, barrée, dans le calendrier."
              : "Séance rétablie.",
        );
      } else if (result.status === "error") {
        setNotice(result.message);
      }
    });

  const runDiscard = () =>
    startBusy(async () => {
      if (!idRef.current) return;
      const result = await discardPendingChanges(idRef.current, { refreshPage: false });
      setConfirm(null);
      if (result.status === "ok" && result.snapshot) {
        const published = snapshotToValues(result.snapshot);
        baseRef.current = result.snapshot;
        savedJson.current = stableJson(published);
        setValues(published);
        setPending(false);
        setStatus({ kind: "saved", at: new Date().toISOString() });
        setNotice("Modifications abandonnées : la version publiée est rétablie.");
      } else if (result.status === "error") {
        setNotice(result.message);
      }
    });

  const runDelete = () =>
    startBusy(async () => {
      if (!idRef.current) {
        router.push(props.backHref);
        return;
      }
      const result = await deleteSession(idRef.current);
      if (result.status === "ok") {
        savedJson.current = stableJson(valuesRef.current);
        router.push(props.backHref);
      } else {
        setConfirm(null);
        setNotice(result.message);
      }
    });

  const runSaveAsTemplate = () =>
    startBusy(async () => {
      const ok = await flush();
      if (!ok || !idRef.current) return;
      const result = await saveSessionAsTemplate(idRef.current, { refreshPage: false });
      setNotice(result.status === "ok" ? "Modèle ajouté à votre bibliothèque." : result.message);
    });

  const resolveConflict = (choice: "theirs" | "mine") => {
    if (status.kind !== "conflict") return;
    const { current, scope } = status;
    if (!current) {
      setStatus({ kind: "error", message: "La séance n’est plus accessible." });
      return;
    }

    if (scope === "publish") {
      // Conflit entre les modifications en attente et la version publiée : la base tranche, puis
      // « mine » publie ; « theirs » reprend la valeur publiée et laisse le reste en attente.
      startBusy(async () => {
        if (!idRef.current) return;
        if (choice === "mine") {
          await publishNow("mine");
          return;
        }
        const result = await keepPublishedOnConflict(idRef.current);
        if (result.status !== "ok" || !result.snapshot) {
          setNotice(result.status === "error" ? result.message : "La résolution du conflit a échoué.");
          return;
        }
        const next = snapshotToValues(result.snapshot);
        baseRef.current = result.snapshot;
        savedJson.current = stableJson(next);
        setValues(next);
        setPending(Boolean(result.pending));
        setStatus(result.pending ? { kind: "pending", at: new Date().toISOString() } : { kind: "saved", at: new Date().toISOString() });
        setNotice(
          result.pending
            ? "Version publiée reprise pour les champs en conflit. Vos autres modifications restent à publier."
            : "Version publiée reprise : plus rien n’est en attente.",
        );
      });
      return;
    }

    const synced = baseRef.current ? snapshotToValues({ ...(current as SessionSnapshot), ...baseRef.current }) : null;
    const theirs = snapshotToValues(current);
    baseRef.current = current;
    if (choice === "theirs") {
      savedJson.current = stableJson(theirs);
      setValues(theirs);
      setPending(status.pending);
      setStatus(status.pending ? { kind: "pending", at: new Date().toISOString() } : { kind: "saved", at: new Date().toISOString() });
      return;
    }
    // Garder mes modifications sur les champs que j’ai changés ; reprendre les leurs partout ailleurs.
    const mine = valuesRef.current;
    const touched = normalizedValues(mine);
    const next = { ...mine };
    for (const key of VALUE_KEYS) {
      if (synced && stableJson(touched[key]) === stableJson(synced[key])) (next as Record<string, unknown>)[key] = theirs[key];
    }
    savedJson.current = stableJson(theirs);
    setValues(next);
    setStatus({ kind: "dirty" });
  };

  const menuItems: MenuItem[] =
    mode === "template"
      ? []
      : [
          // Avec des modifications en attente, il faut d’abord les publier ou les abandonner.
          ...(state === "published" && !pending ? [{ key: "unpublish", label: "Repasser en brouillon", icon: <EyeOff /> }] : []),
          ...((state === "published" || state === "draft") && !pending ? [{ key: "cancel", label: "Annuler la séance", icon: <CircleSlash /> }] : []),
          ...(state === "cancelled" && !pending ? [{ key: "restore", label: "Rétablir la séance", icon: <RotateCcw /> }] : []),
          ...(savedId ? [{ key: "template", label: "Enregistrer comme modèle", icon: <BookmarkPlus /> }] : []),
          { key: "delete", label: "Supprimer la séance", icon: <Trash2 />, tone: "danger" as const },
        ];

  const onMenu = (key: string) => {
    if (key === "unpublish" || key === "cancel" || key === "restore") runTransition(key);
    else if (key === "template") runSaveAsTemplate();
    else if (key === "delete") setConfirm("delete");
  };

  return (
    <div className="pb-28 lg:pb-12" data-editor-ready={ready || undefined}>
      <header className="sticky top-14 z-10 border-b border-line bg-canvas/92 backdrop-blur-md lg:top-0">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[14px] font-medium text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {props.backLabel}
          </button>
          <StateBadge mode={mode} state={state} pending={pending} />
          <SaveIndicator status={status} mode={mode} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={() => void save()} disabled={status.kind === "saving"}>
              Enregistrer
            </Button>
            {mode === "session" && (state === null || state === "draft") ? (
              <Button onClick={runPublish} disabled={busy}>
                <Send aria-hidden />
                Publier
              </Button>
            ) : null}
            {mode === "session" && pending && state !== "draft" ? (
              <>
                <Button variant="ghost" onClick={() => setConfirm("discard")} disabled={busy}>
                  <Undo2 aria-hidden />
                  <span className="hidden sm:inline">Abandonner</span>
                </Button>
                <Button onClick={runPublish} disabled={busy}>
                  <Send aria-hidden />
                  Publier les modifications
                </Button>
              </>
            ) : null}
            {menuItems.length ? <Menu label="Autres actions" trigger={<Ellipsis aria-hidden />} items={menuItems} onSelect={onMenu} /> : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 pt-6 sm:px-6 lg:px-8">
        {notice ? (
          <div className="mb-4 flex items-start gap-3">
            <Notice className="flex-1">{notice}</Notice>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              Fermer
            </Button>
          </div>
        ) : null}
        {status.kind === "conflict" ? (
          <ConflictBanner
            scope={status.scope}
            fields={status.fields}
            busy={busy}
            onTheirs={() => resolveConflict("theirs")}
            onMine={() => resolveConflict("mine")}
          />
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-7">
            <div>
              <label htmlFor="session-title" className="sr-only">
                {mode === "template" ? "Nom du modèle" : "Titre de la séance"}
              </label>
              <input
                id="session-title"
                value={values.title}
                onChange={(event) => update({ title: event.target.value })}
                placeholder={mode === "template" ? "Nom du modèle" : "Titre de la séance"}
                maxLength={120}
                className="display w-full border-0 bg-transparent p-0 text-[30px] text-ink outline-none placeholder:text-muted/50 sm:text-[36px]"
              />
              {athlete ? (
                <p className="mt-1 text-[14px] text-muted">
                  Pour <span className="font-semibold text-ink-soft">{athlete.name}</span>
                </p>
              ) : null}
            </div>

            <SportPicker value={sport} onChange={changeSport} />

            <div className="grid gap-4 sm:grid-cols-3">
              {mode === "session" ? (
                <>
                  <MetaField label="Date" htmlFor="session-date">
                    <input
                      id="session-date"
                      type="date"
                      required
                      value={values.scheduled_date}
                      onChange={(event) => event.target.value && update({ scheduled_date: event.target.value })}
                      className={cn(controlClasses, "h-10")}
                    />
                  </MetaField>
                  <MetaField label="Heure (facultative)" htmlFor="session-time">
                    <input
                      id="session-time"
                      type="time"
                      value={values.start_time}
                      onChange={(event) => update({ start_time: event.target.value })}
                      className={cn(controlClasses, "h-10")}
                    />
                  </MetaField>
                </>
              ) : null}
              <MetaField label="Objectif" htmlFor="session-objective">
                <Select id="session-objective" value={values.objective} onChange={(event) => update({ objective: event.target.value })}>
                  <option value="">Sans objectif précis</option>
                  {SESSION_OBJECTIVES.map((objective) => (
                    <option key={objective} value={objective}>
                      {OBJECTIVE_LABELS[objective]}
                    </option>
                  ))}
                </Select>
              </MetaField>
            </div>

            <section aria-labelledby="structure-title">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="structure-title" className="heading text-[18px]">
                  Déroulé
                </h2>
                {sport === "brick" ? (
                  <button
                    type="button"
                    onClick={() => updateContent((w) => addSegment(w, w.segments[w.segments.length - 1]?.sport === "bike" ? "run" : "bike"))}
                    className="text-[13px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"
                  >
                    Ajouter un segment
                  </button>
                ) : null}
              </div>
              {validation.general.length ? (
                <Notice tone="error" className="mb-3">
                  {validation.general[0]}
                </Notice>
              ) : null}
              <StructureEditor
                workout={values.content}
                onChange={updateContent}
                onNotify={notify}
                thresholds={thresholds}
                issues={issuesByNode}
                errors={validation.byNode}
              />
            </section>

            <section aria-labelledby="notes-title" className="grid gap-4 md:grid-cols-2">
              <h2 id="notes-title" className="sr-only">
                Consignes
              </h2>
              <MetaField label="Consignes pour l’athlète" htmlFor="session-description">
                <textarea
                  id="session-description"
                  value={values.description}
                  onChange={(event) => update({ description: event.target.value })}
                  maxLength={4000}
                  rows={4}
                  placeholder="Sensations attendues, terrain, points techniques…"
                  className={cn(controlClasses, "min-h-28 py-2 leading-relaxed")}
                />
              </MetaField>
              {mode === "session" ? (
              <MetaField label="Nutrition et hydratation" htmlFor="session-nutrition">
                <textarea
                  id="session-nutrition"
                  value={values.nutrition_notes}
                  onChange={(event) => update({ nutrition_notes: event.target.value })}
                  maxLength={2000}
                  rows={4}
                  placeholder="Glucides par heure, bidons, gels…"
                  className={cn(controlClasses, "min-h-28 py-2 leading-relaxed")}
                />
              </MetaField>
              ) : null}
            </section>
          </div>

          <aside className="lg:sticky lg:top-[88px] lg:self-start">
            <WorkoutPreview workout={values.content} thresholds={thresholds} issues={globalIssues} athleteName={athlete?.name.split(" ")[0]} />
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "delete"}
        title="Supprimer cette séance ?"
        confirmLabel="Supprimer"
        pending={busy}
        onConfirm={runDelete}
        onCancel={() => setConfirm(null)}
      >
        La séance et ses commentaires seront définitivement supprimés
        {state === "published" ? ", et elle disparaîtra du calendrier de l’athlète" : ""}.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "discard"}
        title="Abandonner les modifications ?"
        confirmLabel="Abandonner"
        pending={busy}
        onConfirm={runDiscard}
        onCancel={() => setConfirm(null)}
      >
        Les modifications non publiées seront perdues. L’athlète garde la version publiée.
      </ConfirmDialog>
    </div>
  );
}

function MetaField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      {children}
    </div>
  );
}

function SportPicker({ value, onChange }: { value: SessionSport; onChange: (sport: SessionSport) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Discipline</legend>
      <div className="flex flex-wrap gap-2">
        {SESSION_SPORTS.map((sport) => {
          const Icon = SPORT_ICONS[sport];
          const active = sport === value;
          return (
            <button
              key={sport}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(sport)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors",
                active ? cn("border-transparent", SPORT_STYLES[sport].soft, SPORT_STYLES[sport].ink, "font-semibold") : "border-line-strong bg-surface text-ink-soft hover:border-ink/40",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={2.2} aria-hidden />
              {SPORT_LABELS[sport]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function StateBadge({ mode, state, pending }: { mode: "session" | "template"; state: SessionState | null; pending: boolean }) {
  if (mode === "template") return <span className="rounded-[6px] bg-surface-3 px-2 py-1 text-[12px] font-semibold text-ink-soft">Modèle</span>;
  if (state === "cancelled") return <span className="rounded-[6px] bg-surface-3 px-2 py-1 text-[12px] font-semibold text-muted line-through">Annulée</span>;
  if (state === "published") {
    return (
      <span className={cn("rounded-[6px] px-2 py-1 text-[12px] font-semibold", pending ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
        {pending ? "Publiée, modifications en attente" : "Publiée"}
      </span>
    );
  }
  return <span className="rounded-[6px] border border-dashed border-line-strong px-2 py-[3px] text-[12px] font-semibold text-ink-soft">Brouillon</span>;
}

function SaveIndicator({ status, mode }: { status: Status; mode: "session" | "template" }) {
  const text = (() => {
    switch (status.kind) {
      case "clean":
        return mode === "template" ? "Nouveau modèle" : "Pas encore enregistrée";
      case "dirty":
        return "Modifications non enregistrées";
      case "saving":
        return "Enregistrement…";
      case "saved":
        return `Enregistré à ${savedAt(status.at)}`;
      case "pending":
        return `Brouillon de modifications enregistré à ${savedAt(status.at)}`;
      case "invalid":
        return status.message;
      case "conflict":
        return "Conflit : modifiée ailleurs";
      case "error":
        return status.message;
    }
  })();
  const tone =
    status.kind === "invalid" || status.kind === "error" || status.kind === "conflict"
      ? "text-danger"
      : status.kind === "dirty" || status.kind === "saving"
        ? "text-muted"
        : "text-muted";
  return (
    <p role="status" aria-live="polite" className={cn("flex min-w-0 items-center gap-2 text-[13px]", tone)}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          status.kind === "saved" && "bg-success",
          status.kind === "pending" && "bg-warning",
          (status.kind === "dirty" || status.kind === "clean") && "bg-line-strong",
          status.kind === "saving" && "animate-pulse bg-ink-soft",
          (status.kind === "invalid" || status.kind === "error" || status.kind === "conflict") && "bg-danger",
        )}
      />
      <span className="truncate">{text}</span>
    </p>
  );
}

function ConflictBanner({
  scope,
  fields,
  busy,
  onTheirs,
  onMine,
}: {
  scope: "save" | "publish";
  fields: EditableField[];
  busy: boolean;
  onTheirs: () => void;
  onMine: () => void;
}) {
  const list = fields.map((f) => FIELD_LABELS[f]).join(", ");
  return (
    <div role="alert" className="mb-5 rounded-[14px] border border-danger/30 bg-danger-soft p-4 text-danger">
      <p className="font-semibold">
        {scope === "publish"
          ? "La version publiée a changé pendant que vous la modifiiez (par exemple déplacée par l’athlète)."
          : "Cette séance a été modifiée ailleurs pendant que vous l’éditiez."}
      </p>
      <p className="mt-1 text-[14px]">
        {list ? `Champs concernés : ${list}. ` : ""}Rien n’a été écrasé. Choisissez la version à garder pour ces champs ; vos autres modifications sont conservées.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onTheirs} disabled={busy}>
          {scope === "publish" ? "Garder la version publiée" : "Reprendre la version enregistrée"}
        </Button>
        <Button onClick={onMine} disabled={busy}>
          {scope === "publish" ? "Garder mes modifications et publier" : "Garder mes modifications"}
        </Button>
      </div>
    </div>
  );
}
