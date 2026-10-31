"use client";

import { type CSSProperties, type ComponentProps, useMemo } from "react";
import { cn } from "@/lib/utils";
import { take } from "../utils/range";

export interface Segment {
  text: string;
  mono?: boolean;
  // Added for the recorder: highlight a segment (e.g. a name) as a chip.
  className?: string;
  style?: CSSProperties;
}

export function StreamingText({
  segments,
  count,
  streaming,
  className,
  ...props
}: Omit<
  ComponentProps<"p">,
  "children" | "segments" | "count" | "streaming"
> & {
  segments: Segment[];
  count: number;
  streaming: boolean;
}) {
  const words = useMemo(
    () =>
      segments.flatMap((segment) =>
        // A highlighted phrase ("next week") stays one chip, not one per word.
        (segment.className ? segment.text.replaceAll(" ", "\u00a0") : segment.text)
          .split(" ")
          .filter(Boolean)
          .map((word) => ({ word, mono: segment.mono ?? false, className: segment.className, style: segment.style })),
      ),
    [segments],
  );
  const shown = take(words, count);

  return (
    <p
      data-slot="streaming-text"
      className={cn(
        "min-h-[8.5rem] max-w-sm text-sm leading-relaxed text-pretty",
        className,
      )}

      {...props}
    >
      {shown.map(({ word, mono: isMono, className: wordClass, style }, i) => {
        const fresh = streaming && shown.length - 1 - i < 2;
        return (
          <span
            key={i}
            className="fade-in animate-in fill-mode-both duration-500 motion-reduce:animate-none"
          >
            <span
              className={cn(
                "transition-colors duration-700 motion-reduce:transition-none",
                fresh && "text-blue-500 dark:text-blue-400",
                isMono &&
                  "bg-foreground/[0.06] rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
                wordClass,
              )}
              style={style}
            >
              {word}
            </span>{" "}
          </span>
        );
      })}
      {streaming && shown.length > 0 && (
        <span
          aria-hidden
          className="-mb-0.5 ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400"
        />
      )}
    </p>
  );
}
