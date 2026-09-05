import React from "react";
import { Microlabel } from "../rows";

/* The receipt's two named-column tables, at inspector density: row header
 * left, value right, one hairline per pair. Both callers hand it the same
 * shape, so the markup is stated once. */
export const HistoryReceiptTable: React.FC<{
  columns: [string, string];
  rows: Array<{ id: string; header: string; value: string }>;
}> = ({ columns, rows }) => (
  <table className="w-full table-fixed border-collapse text-left">
    <thead>
      <tr>
        {columns.map((column) => (
          <th
            key={column}
            scope="col"
            /* `font-normal` stays on the cell: a <th> is bold by default and
             * the label voice inside it inherits that weight. */
            className="py-1.5 pr-3 font-normal"
          >
            <Microlabel>{column}</Microlabel>
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr
          key={row.id}
          className="not-last:border-b not-last:border-gray-alpha-400"
        >
          <th
            scope="row"
            className="py-1.5 pr-3 text-[13px] leading-[18px] font-normal text-gray-900"
          >
            {row.header}
          </th>
          <td className="py-1.5 pr-3 text-[13px] leading-[18px] text-gray-900 tabular-nums">
            {row.value}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
