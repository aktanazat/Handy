import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meeting recording",
};

export default function ConsentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
