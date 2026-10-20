import { redirect } from "next/navigation";
import { getCurrentUser, safeInternalPath } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  // Al ingelogd: ga naar de oorspronkelijke bestemming (bijv. een voorstel uit een e-mail).
  if (user) redirect(safeInternalPath(params.next) ?? "/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LoginForm next={params.next} linkError={params.error === "link-ongeldig"} />
    </main>
  );
}
