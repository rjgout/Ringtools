import React, { useState } from "react";
import { Alert, Linking, Pressable } from "react-native";
import Constants from "expo-constants";
import { API_URL, useAuth } from "@/lib/auth";
import { Badge, Body, Button, Card, H1, H2, Muted, Row, Screen } from "@/ui/components";
import { useTheme } from "@/ui/theme";

const ROLE_LABELS: Record<string, string> = {
  RINGPRESIDIUM: "Ringpresidium",
  RINGSECRETARIS: "Ringsecretaris",
  RINGADMINISTRATEUR: "Ringadministrateur",
  HOGERAAD: "Hoge raad",
};

export default function Profiel() {
  const { me, ringId, selectRing, signOut, enablePush } = useAuth();
  const t = useTheme();
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  async function push() {
    const result = await enablePush();
    setPushMsg(
      {
        registered: "Meldingen staan aan voor dit toestel.",
        denied: "Meldingen zijn geweigerd. Zet ze aan via de instellingen van je toestel.",
        unsupported: "Meldingen werken alleen op een fysiek toestel met een app uit de store of een EAS-build.",
        failed: "Meldingen aanzetten is niet gelukt. Probeer het later opnieuw.",
      }[result]
    );
  }

  function confirmLogout() {
    Alert.alert("Uitloggen", "Weet je zeker dat je wilt uitloggen op dit toestel?", [
      { text: "Annuleren", style: "cancel" },
      { text: "Uitloggen", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen>
      <H1>Profiel</H1>
      <Card>
        <Body bold>{me?.user.name}</Body>
        <Muted>{me?.user.email}</Muted>
      </Card>

      <H2>Ringen</H2>
      {me?.rings.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => void selectRing(r.id)}>
          <Card style={{ borderColor: r.id === ringId ? t.primary : undefined, borderWidth: r.id === ringId ? 2 : undefined }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Body bold>{r.name}</Body>
              {r.id === ringId ? <Badge>Actief</Badge> : null}
            </Row>
            <Muted>
              {ROLE_LABELS[r.role]}
              {r.churchFunction ? ` (${r.churchFunction})` : ""}
              {r.isRingManager ? " · ringbeheerder" : ""}
            </Muted>
          </Card>
        </Pressable>
      ))}

      <H2>Meldingen</H2>
      <Card>
        <Muted>Ontvang een melding zodra er een ondersteuningsverzoek of taak voor je klaarstaat. De melding bevat geen namen of functies.</Muted>
        <Button title="Meldingen aanzetten" onPress={push} variant="ghost" />
        {pushMsg ? <Muted>{pushMsg}</Muted> : null}
      </Card>

      <H2>Beheer</H2>
      <Card>
        <Muted>Ringbeheer, gebruikersbeheer en beveiligingsinstellingen doe je in de webapp.</Muted>
        <Button title="Webapp openen" variant="ghost" onPress={() => void Linking.openURL(API_URL)} />
      </Card>

      <Button title="Uitloggen" variant="danger" onPress={confirmLogout} testID="logout" />
      <Muted small>Ringtools {Constants.expoConfig?.version ?? ""}</Muted>
    </Screen>
  );
}
