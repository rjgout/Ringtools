import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LoginForm next={params.next} linkError={params.error === "link-ongeldig"} />
    </main>
  );
}
