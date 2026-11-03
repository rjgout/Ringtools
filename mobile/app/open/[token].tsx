import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Button, Card, Muted, Screen, Body } from "@/ui/components";

/**
 * Universele link uit een e-mail (https://<server>/open/<token>) opent direct de app. De server
 * controleert het token; daarna opent het voorstel, waarvoor de ingelogde gebruiker zelf bevoegd moet zijn.
 */
export default function OpenLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { api } = useAuth();
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .resolveOpenLink(token)
      .then((r) => {
        if (cancelled) return;
        if (r.valid && r.callingId) router.replace(`/roepingen/${r.callingId}` as never);
        else setInvalid(true);
      })
      .catch(() => !cancelled && setInvalid(true));
    return () => {
      cancelled = true;
    };
  }, [api, token, router]);

  return (
    <Screen>
      <Card>
        {invalid ? (
          <>
            <Body bold>Deze koppeling is ongeldig of verlopen</Body>
            <Muted>Open het voorstel via het overzicht in de app.</Muted>
            <Button title="Naar overzicht" onPress={() => router.replace("/" as never)} />
          </>
        ) : (
          <Muted>Voorstel openen…</Muted>
        )}
      </Card>
    </Screen>
  );
}
