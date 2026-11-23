import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";
import { hydrateLanguages } from "./languages.js";

// jsdom does not implement viewport scrolling; browser checks cover positioning.
window.scrollTo = vi.fn();

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

beforeEach(() => hydrateLanguages(REGISTRY_PAYLOAD));
afterEach(() => cleanup());
