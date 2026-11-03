import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ApiRequestError } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { Badge, Body, Button, Card, ErrorText, H2, Muted, Row, Screen } from "@/ui/components";
import type { CallingDetail, Participant, Round, TaskView } from "@/lib/types";

const DELETE_TEXT =
  "Weet je zeker dat je dit roepingsvoorstel definitief wilt verwijderen? Alle bijbehorende ondersteuningsreacties en openstaande taken worden ook verwijderd. Dit kan niet ongedaan worden gemaakt.";

function when(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function VoorstelDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, reloadMe } = useAuth();
  const router = useRouter();
  const { data, error, refreshing, refresh, reload } = useLoad<CallingDetail>(() => api.calling(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Voert een actie uit, toont server-meldingen en laadt het voorstel opnieuw. */
  async function run<T>(key: string, fn: () => Promise<T>, done?: (r: T) => string | null) {
    setBusy(key);
    setActionError(null);
    setNotice(null);
    try {
      const result = await fn();
      setNotice(done ? done(result) : null);
      await reload();
      void reloadMe();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert("Voorstel verwijderen", DELETE_TEXT, [
      { text: "Annuleren", style: "cancel" },
      {
        text: "Definitief verwijderen",
        style: "destructive",
        onPress: async () => {
          setBusy("delete");
          try {
            await api.deleteCalling(id);
            void reloadMe();
            router.replace("/" as never);
          } catch (err) {
            setActionError(err instanceof ApiRequestError ? err.message : "Verwijderen is niet gelukt.");
            setBusy(null);
          }
        },
      },
    ]);
  }

  // Een voorstel waar je geen toegang toe hebt (of dat is verwijderd) toont niets vertrouwelijks.
  if (error && !data) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <Card>
          <Body bold>Dit voorstel is niet beschikbaar</Body>
          <Muted>{error}</Muted>
          <Button title="Naar overzicht" variant="ghost" onPress={() => router.replace("/" as never)} />
        </Card>
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <Muted>Laden…</Muted>
      </Screen>
    );
  }

  const staff = data.me.isStaff;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ gap: 4 }}>
        <H2>{data.personName}</H2>
        <Muted>{data.functionTitle}</Muted>
        <Muted small>
          {data.ring.name} · aangemaakt {when(data.createdAt)} door {data.createdBy}
        </Muted>
        <Badge tone={data.status.endsWith("PAUSED") ? "warning" : data.status === "APPROVED" || data.status === "PROCESSED" ? "success" : "neutral"}>
          {data.phase}
        </Badge>
      </View>

      {notice ? <Muted>{notice}</Muted> : null}
      <ErrorText>{actionError}</ErrorText>

      {data.rounds.map((round) => (
        <RoundCard key={round.stage} round={round} staff={staff} busy={busy} callingId={id} run={run} api={api} />
      ))}

      {data.tasks.length > 0 ? (
        <>
          <H2>Uitvoering</H2>
          {data.tasks.map((task) => (
            <TaskCard key={task.task} task={task} data={data} busy={busy} run={run} api={api} />
          ))}
        </>
      ) : null}

      {data.readyToProcess ? (
        <Card>
          <Muted>Alle stappen zijn afgerond. Na verwerken verdwijnt dit voorstel uit de werklijsten en wordt het na 30 dagen automatisch verwijderd.</Muted>
          <Button title="Markeren als verwerkt" onPress={() => void run("process", () => api.process(id))} busy={busy === "process"} />
        </Card>
      ) : null}

      {data.canDelete ? (
        <Card>
          <Body bold>Voorstel verwijderen</Body>
          <Muted>Bijvoorbeeld voor een per ongeluk aangemaakt of dubbel voorstel. Dit verwijdert alles wat erbij hoort.</Muted>
          <Button title="Voorstel verwijderen" variant="danger" onPress={confirmDelete} busy={busy === "delete"} testID="delete-calling" />
        </Card>
      ) : null}
    </Screen>
  );
}

type Run = <T>(key: string, fn: () => Promise<T>, done?: (r: T) => string | null) => Promise<void>;
type Api = ReturnType<typeof useAuth>["api"];

function RoundCard({ round, staff, busy, callingId, run, api }: { round: Round; staff: boolean; busy: string | null; callingId: string; run: Run; api: Api }) {
  const waiting = round.participants.filter((p) => p.support === null && p.stillInvolved);
  const stateLabel = { open: "Loopt", paused: "Gepauzeerd", done: "Afgerond", upcoming: "Nog niet gestart" }[round.state];

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <H2>{round.title}</H2>
        <Badge tone={round.state === "paused" ? "warning" : round.state === "done" ? "success" : "neutral"}>{stateLabel}</Badge>
      </Row>

      {round.canRespond ? (
        <View style={{ gap: 10 }}>
          <Muted>
            {round.myResponse === null ? "Wil je dit voorstel ondersteunen?" : round.myResponse ? "Je hebt ondersteund. Je kunt je reactie wijzigen." : "Je ondersteunt niet. Je kunt je reactie wijzigen."}
          </Muted>
          <Button title="👍 Ondersteunen" variant="success" busy={busy === `vote-${round.stage}-yes`} onPress={() => void run(`vote-${round.stage}-yes`, () => api.vote(callingId, true))} testID="support-yes" />
          <Button title="👎 Niet ondersteunen" variant="danger" busy={busy === `vote-${round.stage}-no`} onPress={() => void run(`vote-${round.stage}-no`, () => api.vote(callingId, false))} testID="support-no" />
        </View>
      ) : null}

      {round.participants.map((p) => (
        <ParticipantRow key={p.userId} p={p} round={round} staff={staff} busy={busy} callingId={callingId} run={run} api={api} />
      ))}

      {staff && round.state !== "done" && waiting.length > 0 ? (
        <Button
          title={`Iedereen herinneren (${waiting.length})`}
          variant="ghost"
          busy={busy === "remind-all"}
          onPress={() => void run("remind-all", () => api.remind(callingId), (r) => reminderMessage(r.sent, r.skippedRecent))}
          testID="remind-all"
        />
      ) : null}
    </Card>
  );
}

function reminderMessage(sent: number, skipped: number): string {
  if (sent === 0 && skipped > 0) return "Er is minder dan een uur geleden al een uitnodiging of herinnering verstuurd; probeer het later opnieuw.";
  if (sent === 0) return "Er was niemand om te herinneren.";
  const base = `Herinnering verstuurd naar ${sent} ${sent === 1 ? "persoon" : "personen"}.`;
  return skipped > 0 ? `${base} ${skipped} overgeslagen (minder dan een uur geleden uitgenodigd of herinnerd).` : base;
}

function ParticipantRow({ p, round, staff, busy, callingId, run, api }: { p: Participant; round: Round; staff: boolean; busy: string | null; callingId: string; run: Run; api: Api }) {
  const status = p.support === true ? { label: "Ondersteunt", tone: "success" as const } : p.support === false ? { label: "Ondersteunt niet", tone: "danger" as const } : { label: "Nog niet gereageerd", tone: "warning" as const };
  return (
    <View style={{ gap: 6, paddingTop: 6 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Body bold>{p.name}</Body>
        <Badge tone={status.tone}>{status.label}</Badge>
      </Row>
      {staff ? <Muted small>Laatst uitgenodigd {when(p.lastInvitedAt)}</Muted> : null}
      {staff && !p.stillInvolved ? <Muted small>Niet meer betrokken bij deze ronde (gedeactiveerd of andere rol).</Muted> : null}
      {staff && round.state !== "done" ? (
        <Row style={{ flexWrap: "wrap" }}>
          {p.support === null && p.stillInvolved ? (
            <Button small variant="ghost" title="Herinnering versturen" busy={busy === `remind-${p.userId}`} onPress={() => void run(`remind-${p.userId}`, () => api.remind(callingId, p.userId), (r) => reminderMessage(r.sent, r.skippedRecent))} />
          ) : null}
          {p.support === false && round.state === "paused" ? (
            <Button small variant="ghost" title="Opnieuw ondersteuning vragen" busy={busy === `reinvite-${p.userId}`} onPress={() => void run(`reinvite-${p.userId}`, () => api.reinvite(callingId, p.userId), () => "Er is opnieuw om ondersteuning gevraagd.")} />
          ) : null}
          {!p.stillInvolved ? (
            <Button
              small
              variant="ghost"
              title="Uit ronde verwijderen"
              busy={busy === `remove-${p.userId}`}
              onPress={() =>
                Alert.alert("Uit ronde verwijderen", `${p.name} wordt uit deze ondersteuningsronde verwijderd.`, [
                  { text: "Annuleren", style: "cancel" },
                  { text: "Verwijderen", style: "destructive", onPress: () => void run(`remove-${p.userId}`, () => api.removeParticipant(callingId, p.userId), () => "De deelnemer is uit de ronde verwijderd.") },
                ])
              }
            />
          ) : null}
        </Row>
      ) : null}
    </View>
  );
}

function TaskCard({ task, data, busy, run, api }: { task: TaskView; data: CallingDetail; busy: string | null; run: Run; api: Api }) {
  const [choosing, setChoosing] = useState(false);
  const done = !!task.doneAt;
  const complete = (context?: string) => void run(`task-${task.task}`, () => api.completeTask(data.id, task.task, context));

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Body bold>{task.label}</Body>
        <Badge tone={done ? "success" : "neutral"}>{done ? "Afgerond" : "Open"}</Badge>
      </Row>
      <Muted>
        {task.assignee ? `Verantwoordelijke: ${task.assignee.name}` : "Nog geen verantwoordelijke"}
        {done ? ` · afgerond op ${when(task.doneAt!)}${task.doneBy ? ` door ${task.doneBy}` : ""}` : ""}
        {task.ondersteunenContext ? ` · ${task.ondersteunenContext === "RINGCONFERENTIE" ? "ringconferentie" : "avondmaalsvergadering"}` : ""}
      </Muted>

      {task.canAssign ? (
        <Row style={{ flexWrap: "wrap" }}>
          {data.assignableUsers.map((u) => (
            <Button
              key={u.id}
              small
              variant={task.assignee?.id === u.id ? "primary" : "ghost"}
              title={u.name}
              onPress={() => void run(`assign-${task.task}`, () => api.assignTask(data.id, task.task, task.assignee?.id === u.id ? null : u.id))}
            />
          ))}
        </Row>
      ) : null}

      {task.canComplete && !done ? (
        task.task === "ONDERSTEUNEN" ? (
          choosing ? (
            <Row style={{ flexWrap: "wrap" }}>
              <Button small title="Avondmaalsvergadering" onPress={() => complete("AVONDMAALSVERGADERING")} busy={busy === `task-${task.task}`} />
              <Button small title="Ringconferentie" onPress={() => complete("RINGCONFERENTIE")} busy={busy === `task-${task.task}`} />
            </Row>
          ) : (
            <Button title="Afronden" onPress={() => setChoosing(true)} />
          )
        ) : (
          <Button title="Afronden" onPress={() => complete()} busy={busy === `task-${task.task}`} />
        )
      ) : null}
    </Card>
  );
}
