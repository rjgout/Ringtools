import React from "react";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { CallingItem } from "@/lib/types";
import { Badge, Body, Card, Muted, Row } from "./components";

export function CallingCard({ item, extra }: { item: CallingItem; extra?: string }) {
  const router = useRouter();
  const tone = item.status.endsWith("PAUSED") ? "warning" : item.status === "APPROVED" || item.status === "PROCESSED" ? "success" : "neutral";
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/roepingen/${item.id}` as never)} testID={`calling-${item.id}`}>
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Body bold>{item.personName}</Body>
          {item.needsMyResponse ? <Badge tone="danger">Jouw reactie gevraagd</Badge> : null}
        </Row>
        <Muted>{item.functionTitle}</Muted>
        <Badge tone={tone}>{item.phase}</Badge>
        {extra ? <Muted small>{extra}</Muted> : null}
      </Card>
    </Pressable>
  );
}
