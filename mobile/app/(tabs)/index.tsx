import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { Button, Card, Empty, ErrorText, H1, H2, Muted, Screen, Body, Row } from "@/ui/components";
import { CallingCard } from "@/ui/CallingCard";
import type { Dashboard } from "@/lib/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ flex: 1, minWidth: "45%" }}>
      <H1>{String(value)}</H1>
      <Muted small>{label}</Muted>
    </Card>
  );
}

export default function Overzicht() {
  const { api, ringId, me } = useAuth();
  const router = useRouter();
  const { data, error, refreshing, refresh } = useLoad<Dashboard | null>(() => (ringId ? api.dashboard(ringId) : Promise.resolve(null)), [ringId]);
  const ring = me?.rings.find((r) => r.id === ringId);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View>
        <H1>Overzicht</H1>
        <Muted>{ring ? `${ring.name} · ${data?.isStaff ? "Presidium/secretariaat" : "Hoge raad"}` : ""}</Muted>
      </View>
      <ErrorText>{error}</ErrorText>

      {data?.isStaff ? <Button title="Nieuw voorstel" onPress={() => router.push("/nieuw" as never)} testID="new-calling" /> : null}

      <H2>Wacht op jouw reactie</H2>
      {data && data.pendingSupport.length === 0 ? <Empty>Je bent helemaal bij. Er staat niets voor je open.</Empty> : null}
      {data?.pendingSupport.map((c) => <CallingCard key={c.id} item={c} />)}

      {data?.counts ? (
        <>
          <H2>Stand van zaken</H2>
          <Row style={{ flexWrap: "wrap" }}>
            <Stat label="Ondersteuningsronde presidium" value={data.counts.presidium} />
            <Stat label="Ondersteuningsronde hoge raad" value={data.counts.hogeraad} />
            <Stat label="Gepauzeerd" value={data.counts.paused} />
            <Stat label="Te verwerken" value={data.counts.readyToProcess} />
          </Row>
          {data.attention.length > 0 ? <H2>Aandacht nodig</H2> : null}
          {data.attention.map((c) => <CallingCard key={c.id} item={c} />)}
        </>
      ) : null}

      {data && data.myTasks.length > 0 ? (
        <>
          <H2>Jouw taken</H2>
          {data.myTasks.map((c) => <CallingCard key={c.id} item={c} extra={`Taak: ${c.tasks.join(", ")}`} />)}
        </>
      ) : null}
      {!data && !error ? <Body>Laden…</Body> : null}
    </Screen>
  );
}
