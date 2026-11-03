import React, { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { Empty, ErrorText, H1, Muted, Screen } from "@/ui/components";
import { CallingCard } from "@/ui/CallingCard";
import { useTheme } from "@/ui/theme";

const FILTERS: { key: string; label: string; staffOnly?: boolean }[] = [
  { key: "alle", label: "Alle" },
  { key: "presidium", label: "Presidium", staffOnly: true },
  { key: "hogeraad", label: "Hoge raad", staffOnly: true },
  { key: "gepauzeerd", label: "Gepauzeerd", staffOnly: true },
  { key: "goedgekeurd", label: "Goedgekeurd", staffOnly: true },
  { key: "verwerken", label: "Te verwerken", staffOnly: true },
];

export default function Voorstellen() {
  const { api, ringId, me } = useAuth();
  const t = useTheme();
  const [filter, setFilter] = useState("alle");
  const isStaff = me?.rings.find((r) => r.id === ringId)?.role !== "HOGERAAD";
  const { data, error, refreshing, refresh } = useLoad(() => (ringId ? api.callings(ringId, filter) : Promise.resolve({ callings: [] })), [ringId, filter]);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <H1>Voorstellen</H1>
      {isStaff ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              onPress={() => setFilter(f.key)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: filter === f.key ? t.primary : t.chip }}
            >
              <Text style={{ color: filter === f.key ? t.primaryText : t.primary, fontWeight: "600" }}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {data && data.callings.length === 0 ? <Empty>Geen voorstellen gevonden.</Empty> : null}
      {data?.callings.map((c) => <CallingCard key={c.id} item={c} />)}
      {!data && !error ? <Muted>Laden…</Muted> : null}
    </Screen>
  );
}
