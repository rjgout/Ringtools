import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { watchKeyboardWith, type KeyboardSource } from "../src/lib/native";

function fakeSource() {
  const show = new Set<() => void>();
  const hide = new Set<() => void>();
  const source: KeyboardSource = {
    onShow: (cb) => (show.add(cb), () => void show.delete(cb)),
    onHide: (cb) => (hide.add(cb), () => void hide.delete(cb)),
  };
  return { source, show: () => show.forEach((f) => f()), hide: () => hide.forEach((f) => f()), counts: () => [show.size, hide.size] };
}

describe("Toetsenbord: tabbalk verdwijnt zolang het toetsenbord open is", () => {
  it("meldt open bij tonen en gesloten bij verbergen", () => {
    const f = fakeSource();
    const apply = vi.fn();
    watchKeyboardWith(f.source, apply);
    f.show();
    f.hide();
    expect(apply.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
  it("opruimen verwijdert alleen de eigen luisteraars en zet de staat terug op gesloten", () => {
    const f = fakeSource();
    const apply = vi.fn();
    const off = watchKeyboardWith(f.source, apply);
    expect(f.counts()).toEqual([1, 1]);
    off();
    expect(f.counts()).toEqual([0, 0]);
    expect(apply).toHaveBeenLastCalledWith(false);
  });
  it("de stijlen verbergen de tabbalk wanneer data-keyboard=open", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
    expect(css).toMatch(/:root\[data-keyboard="open"\]\s+\.tabbar\s*\{\s*display:\s*none/);
  });
});
