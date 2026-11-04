import { describe, expect, it } from "vitest";
import { parseTarget, routeFor } from "../src/lib/links";

const HOST = "ringapeldoorn.nl";
const ID = "cm0abcdefghijklmnop";

describe("parseTarget (universele links, app-links en pushmeldingen)", () => {
  it("herkent een voorstel en een e-maillink op de eigen host", () => {
    expect(parseTarget(`https://${HOST}/roepingen/${ID}`, HOST)).toEqual({ kind: "calling", id: ID });
    expect(parseTarget(`https://${HOST.toUpperCase()}/open/${ID}?x=1#y`, HOST)).toEqual({ kind: "open", token: ID });
  });
  it("herkent een intern pad uit een pushmelding", () => {
    expect(parseTarget(`/roepingen/${ID}`, HOST)).toEqual({ kind: "calling", id: ID });
  });
  it("weigert een andere host, ander schema en lookalikes (geen open redirect)", () => {
    for (const bad of [
      `https://evil.example/roepingen/${ID}`,
      `https://${HOST}.evil.example/roepingen/${ID}`,
      `https://evil.example/@${HOST}/open/${ID}`,
      `http://${HOST}/open/${ID}`,
      `javascript://${HOST}/open/${ID}`,
      `ringtools://open/${ID}`,
      `//evil.example/roepingen/${ID}`,
      `/\\evil.example/roepingen/${ID}`,
    ]) expect(parseTarget(bad, HOST), bad).toBeNull();
  });
  it("weigert onbekende paden, te korte ID's en ongeldige invoer", () => {
    for (const bad of ["/dashboard", "/roepingen/", "/roepingen/kort", `/roepingen/${ID}/extra`, `/open/${ID}/x`, "", "   "]) expect(parseTarget(bad, HOST), bad).toBeNull();
    expect(parseTarget(null, HOST)).toBeNull();
    expect(parseTarget(undefined, HOST)).toBeNull();
  });
  it("routeFor geeft een interne route", () => {
    expect(routeFor({ kind: "calling", id: ID })).toBe(`/roepingen/${ID}`);
    expect(routeFor({ kind: "open", token: ID })).toBe(`/open/${ID}`);
  });
});
