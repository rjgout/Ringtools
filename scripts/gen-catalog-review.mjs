// Genereert docs/CATALOGUS-CONTROLE.md uit de catalogus (Node 22 kan TypeScript direct laden).
import { writeFileSync } from "node:fs";
import { renderReviewMarkdown } from "../src/lib/catalog/callings.ts";

writeFileSync(new URL("../docs/CATALOGUS-CONTROLE.md", import.meta.url), renderReviewMarkdown());
console.log("docs/CATALOGUS-CONTROLE.md bijgewerkt");
