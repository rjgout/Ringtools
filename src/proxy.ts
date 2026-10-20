import { NextResponse, type NextRequest } from "next/server";

/**
 * Geeft het opgevraagde pad door aan de applicatie (alleen als request-header),
 * zodat requireUser() een niet-ingelogde bezoeker naar /login?next=<pad> kan sturen
 * en de bestemming (bijv. een voorstel uit een e-mail) na het inloggen behouden blijft.
 * De header wordt hier altijd overschreven, dus een meegestuurde waarde van buiten telt niet.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-ringtools-path", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|offline\\.html).*)"],
};
