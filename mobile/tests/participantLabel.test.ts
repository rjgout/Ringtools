import { describe, expect, it } from "vitest";
import { participantLabel } from "../src/screens/CallingDetail";

describe("Status van een deelnemer", () => {
  it("eigen reactie gaat voor; daarna de uitkomst van het vergaderbesluit; anders nog niet", () => {
    expect(participantLabel({ support: true, meeting: "AFWEZIG" })).toBe("Ondersteunt");
    expect(participantLabel({ support: false, meeting: "AKKOORD" })).toBe("Niet");
    expect(participantLabel({ support: null, meeting: "AKKOORD" })).toBe("Akkoord in vergadering");
    expect(participantLabel({ support: null, meeting: "AFWEZIG" })).toBe("Afwezig bij vergadering");
    expect(participantLabel({ support: null })).toBe("Nog niet");
  });
});
