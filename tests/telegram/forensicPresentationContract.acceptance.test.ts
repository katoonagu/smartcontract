import { describe, expect, it } from "vitest";

import { escapeHtml, renderTelegramAddressRef } from "../../src/alerts/telegramHtml";
import { telegramAddressRef } from "../../src/telegram/forensicPresentation";

describe("Plan 4 Telegram presentation boundary", () => {
  it("[AC-09][PRESENTATION-CONTRACT] builds canonical references with exact first and last four characters", () => {
    const cases = [
      {
        address: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
        display: "TGyt…ZAZD"
      },
      {
        address: "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ",
        display: "TSUY…12sQ"
      }
    ] as const;

    for (const { address, display } of cases) {
      const reference = telegramAddressRef(address);
      const url = `https://tronscan.org/#/address/${address}`;

      expect(display).toBe(`${address.slice(0, 4)}…${address.slice(-4)}`);
      expect(reference).toEqual({ address, display, url });
      expect(renderTelegramAddressRef(reference)).toBe(
        `<a href="${url}">${escapeHtml(display)}</a>`
      );
    }
  });

  it("[REQ-38][PRESENTATION-CONTRACT] leaves invalid TRON addresses unlinked and safely escaped", () => {
    const address = 'T<script>alert("owned")</script>&';
    const reference = telegramAddressRef(address);

    expect(reference).toEqual({
      address,
      display: address,
      url: null
    });

    const rendered = renderTelegramAddressRef(reference);
    expect(rendered).toBe(escapeHtml(address));
    expect(rendered).not.toContain("<a");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("</script>");
  });
});
