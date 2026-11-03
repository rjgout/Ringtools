import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { ApiRequestError } from "@/lib/api";
import { Button, Card, ErrorText, H1, Muted } from "@/ui/components";
import { useTheme } from "@/ui/theme";

export default function Login() {
  const { api, signIn } = useAuth();
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const input = {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    color: t.text,
    backgroundColor: t.card,
  } as const;

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestCode(email.trim().toLowerCase());
      setInfo(res.message);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim().toLowerCase(), code.replace(/\s+/g, ""));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Card>
          <H1>Ringtools</H1>
          <Muted>Ring Apeldoorn</Muted>
          {step === "email" ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: t.text }}>Vul je e-mailadres in. Je krijgt een e-mail met een inlogcode van 8 cijfers.</Text>
              <TextInput
                testID="email"
                value={email}
                onChangeText={setEmail}
                placeholder="naam@ringapeldoorn.nl"
                placeholderTextColor={t.muted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                style={input}
              />
              <ErrorText>{error}</ErrorText>
              <Button title="Stuur inlogcode" onPress={requestCode} busy={busy} disabled={!email.includes("@")} testID="request-code" />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ color: t.text }}>{info}</Text>
              <Muted small>De code is 15 minuten geldig en kan maar één keer worden gebruikt. Negeer de link in de e-mail; die opent in de browser.</Muted>
              <TextInput
                testID="code"
                value={code}
                onChangeText={setCode}
                placeholder="12345678"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={12}
                style={{ ...input, letterSpacing: 4, textAlign: "center" }}
              />
              <ErrorText>{error}</ErrorText>
              <Button title="Inloggen" onPress={submitCode} busy={busy} disabled={code.replace(/\s+/g, "").length !== 8} testID="login" />
              <Button
                title="Andere gegevens of nieuwe code"
                variant="ghost"
                onPress={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              />
            </View>
          )}
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
