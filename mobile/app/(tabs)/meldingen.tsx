import React from "react";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { Badge, Body, Button, Card, Empty, ErrorText, H1, Muted, Row, Screen } from "@/ui/components";

function when(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Meldingen() {
  const { api, ringId, reloadMe } = useAuth();
  const router = useRouter();
  const { data, error, refreshing, refresh, reload } = useLoad(
    () => (ringId ? api.notifications(ringId) : Promise.resolve({ unreadCount: 0, notifications: [] })),
    [ringId]
  );

  async function open(id: string, callingId: string | null, unread: boolean) {
    if (ringId && unread) {
      await api.markRead(ringId, id).catch(() => {});
      void reload();
      void reloadMe();
    }
    if (callingId) router.push(`/roepingen/${callingId}` as never);
  }

  async function markAll() {
    if (!ringId) return;
    await api.markRead(ringId);
    await reload();
    await reloadMe();
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1>Meldingen</H1>
      <ErrorText>{error}</ErrorText>
      {data && data.unreadCount > 0 ? <Button title="Alles als gelezen markeren" variant="ghost" onPress={markAll} /> : null}
      {data && data.notifications.length === 0 ? <Empty>Je bent helemaal bij!</Empty> : null}
      {data?.notifications.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" onPress={() => open(n.id, n.callingId, !n.readAt)}>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Body bold>{n.title}</Body>
              {!n.readAt ? <Badge tone="danger">Nieuw</Badge> : null}
            </Row>
            <Muted>{n.message}</Muted>
            <Muted small>{when(n.createdAt)}</Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
