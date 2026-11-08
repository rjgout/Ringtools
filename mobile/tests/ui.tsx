import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { ConfirmProvider } from "../src/components/Dialog";

/** Rendert een scherm met de app-eigen bevestigingsdialoog (zoals in App.tsx). */
export const renderUi = (ui: ReactElement, options?: RenderOptions) => render(<ConfirmProvider>{ui}</ConfirmProvider>, options);

import { fireEvent, screen, within } from "@testing-library/react";

/** Opent het contextmenu (⋯) met deze toegankelijke naam en kiest het item. De keuze wordt na het sluiten van het menu uitgevoerd. */
export function pickMenuItem(menuLabel: string, itemName: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: menuLabel }));
  fireEvent.click(within(screen.getByRole("menu", { name: menuLabel })).getByRole("menuitem", { name: itemName }));
}

/** Bevestigt of annuleert de app-eigen bevestigingsdialoog. */
export function answerDialog(button: string | RegExp) {
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: button }));
}
