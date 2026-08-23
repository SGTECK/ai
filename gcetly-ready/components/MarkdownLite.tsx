"use client";

import React from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length >= 4 ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
    )
  );
}

/**
 * Minimal markdown renderer: bold, lists, simple tables.
 * No raw HTML, no links-as-HTML (citations are separate safe <a> with isSafeUrl).
 */
export default function MarkdownLite({ text }: { text: string }) {
  const lines = (typeof text === "string" ? text : "").slice(0, 50_000).split("\n");
  const blocks: React.ReactNode[] = [];
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length >= 2) {
      const header = tableRows[0];
      const body = tableRows.slice(2);
      blocks.push(
        <table key={`t-${blocks.length}`} className="text-xs my-2 border-collapse w-full">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} className="border border-slate-300 dark:border-slate-600 px-2 py-1 text-left">
                  {renderInline(h, `th-${blocks.length}-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => (
                  <td key={ci} className="border border-slate-300 dark:border-slate-600 px-2 py-1">
                    {renderInline(c, `td-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    tableRows = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""));
      tableRows.push(cells);
      return;
    }
    flushTable();

    if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push(
        <li key={idx} className="ml-4 list-decimal">
          {renderInline(trimmed.replace(/^\d+\.\s+/, ""), `li-${idx}`)}
        </li>
      );
    } else if (/^-\s+/.test(trimmed)) {
      blocks.push(
        <li key={idx} className="ml-4 list-disc">
          {renderInline(trimmed.replace(/^-\s+/, ""), `li-${idx}`)}
        </li>
      );
    } else if (trimmed === "") {
      blocks.push(<div key={idx} className="h-1.5" />);
    } else {
      blocks.push(
        <p key={idx} className="my-0.5">
          {renderInline(trimmed, `p-${idx}`)}
        </p>
      );
    }
  });
  flushTable();

  return <>{blocks}</>;
}
