import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ApiRequestError } from "@/lib/api";
import { Button, Card, ErrorText, Muted, Screen } from "@/ui/components";
import { useTheme } from "@/ui/theme";

export default function NieuwVoorstel() {
  const { api, ringId, reloadMe } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const [personName, setPersonName] = useState("");
  const [functionTitle, setFunctionTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = { borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 14, fontSize: 17, color: t.text, backgroundColor: t.card } as const;

  async function submit() {
    if (!ringId) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createCalling(ringId, personName.trim(), functionTitle.trim());
      void reloadMe();
      router.replace(`/roepingen/${id}` as never);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Muted>Het ringpresidium krijgt direct een ondersteuningsverzoek. Verantwoordelijken voor roepen, ondersteunen en aanstellen wijs je daarna op het voorstel aan.</Muted>
        <View style={{ gap: 12 }}>
          <TextInput testID="person" value={personName} onChangeText={setPersonName} placeholder="Naam van de persoon" placeholderTextColor={t.muted} style={input} />
          <TextInput testID="function" value={functionTitle} onChangeText={setFunctionTitle} placeholder="Roeping/functie" placeholderTextColor={t.muted} style={input} />
          <ErrorText>{error}</ErrorText>
          <Button title="Voorstel aanmaken" onPress={submit} busy={busy} disabled={personName.trim().length < 2 || functionTitle.trim().length < 2} testID="create" />
        </View>
      </Card>
    </Screen>
  );
}
