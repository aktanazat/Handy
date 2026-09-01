import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bars } from "@/components/vg/chart";
import { ChartCard } from ".";

const render = (node: React.ReactElement): string => renderToStaticMarkup(node);

describe("ChartCard", () => {
  test("composes the settings card with a metric, delta and footer facts", () => {
    const markup = render(
      <ChartCard
        label="Dictations"
        metric="18"
        delta={{ value: "+4", direction: "positive" }}
        footerFacts={[{ label: "Peak", value: "6" }]}
      >
        <Bars
          values={[2, 6]}
          ariaLabel="Dictations per day, highest 6 on Friday"
        />
      </ChartCard>,
    );

    expect(markup).toContain("rounded-card");
    expect(markup).toContain("border-gray-alpha-400");
    expect(markup).not.toContain('aria-label="Previous 7 days"');
    expect(markup).not.toContain('aria-label="Next 7 days"');
    expect(markup).toContain("+4");
    expect(markup).toContain("Peak");
  });
});
