import { describe, expect, it } from "vitest";

import { renderTelegramAddressRef } from "../../src/alerts/telegramHtml";
import { telegramAddressRef } from "../../src/telegram/forensicPresentation";

describe("Plan 4 Telegram presentation boundary", () => {
  it("[AC-09][PRESENTATION-CONTRACT] builds canonical references with exact first and last four characters", () => {
    const cases = [
      {
        address: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
        display: "TGyt…ZAZD",
        expectedHtml:
          '<a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>'
      },
      {
        address: "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ",
        display: "TSUY…12sQ",
        expectedHtml:
          '<a href="https://tronscan.org/#/address/TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ">TSUY…12sQ</a>'
      }
    ] as const;

    for (const { address, display, expectedHtml } of cases) {
      const reference = telegramAddressRef(address);
      const url = `https://tronscan.org/#/address/${address}`;

      expect(display).toBe(`${address.slice(0, 4)}…${address.slice(-4)}`);
      expect(reference).toEqual({ address, display, url });
      expect(renderTelegramAddressRef(reference)).toBe(expectedHtml);
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
    expect(rendered).toBe(
      "T&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt;&amp;"
    );
    expect(rendered).not.toContain("<a");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("</script>");
    expect(rendered).not.toContain("https://tronscan.org/#/address/");
  });
});
